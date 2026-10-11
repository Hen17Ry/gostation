package export

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// table est un jeu de données à écrire : colonnes (clés camelCase, identiques en CSV et en JSON)
// et lignes de valeurs Go (string, *string, int, int32, int64, *int32, *int64, float64, *float64,
// bool, time.Time, *time.Time, json.RawMessage ou nil).
type table struct {
	columns []string
	rows    [][]any
}

// utf8BOM permet à Excel de reconnaître l'UTF-8 (accents des noms de stations).
const utf8BOM = "\xEF\xBB\xBF"

// formulaPrefixes déclenchent une formule dans un tableur (injection CSV, OWASP) : une cellule de
// texte qui commence ainsi est préfixée d'une apostrophe.
const formulaPrefixes = "=+-@\t\r"

// csvText neutralise une valeur de texte saisie par un utilisateur (nom, commentaire…).
func csvText(s string) string {
	if s != "" && strings.ContainsRune(formulaPrefixes, rune(s[0])) {
		return "'" + s
	}
	return s
}

// csvNumber écrit un décimal avec une virgule (Excel en français).
func csvNumber(f float64) string {
	return strings.Replace(strconv.FormatFloat(f, 'f', -1, 64), ".", ",", 1)
}

func csvCell(v any, loc *time.Location) (string, error) {
	switch x := v.(type) {
	case nil:
		return "", nil
	case string:
		return csvText(x), nil
	case *string:
		if x == nil {
			return "", nil
		}
		return csvText(*x), nil
	case int:
		return strconv.Itoa(x), nil
	case int32:
		return strconv.FormatInt(int64(x), 10), nil
	case int64:
		return strconv.FormatInt(x, 10), nil
	case *int32:
		if x == nil {
			return "", nil
		}
		return strconv.FormatInt(int64(*x), 10), nil
	case *int64:
		if x == nil {
			return "", nil
		}
		return strconv.FormatInt(*x, 10), nil
	case float64:
		return csvNumber(x), nil
	case *float64:
		if x == nil {
			return "", nil
		}
		return csvNumber(*x), nil
	case bool:
		if x {
			return "true", nil
		}
		return "false", nil
	case time.Time:
		return x.In(loc).Format(time.DateTime), nil // heure locale, reconnue par Excel
	case *time.Time:
		if x == nil {
			return "", nil
		}
		return x.In(loc).Format(time.DateTime), nil
	case json.RawMessage:
		return csvText(string(x)), nil
	default:
		return "", fmt.Errorf("export: unsupported value %T", v)
	}
}

// writeCSV écrit le jeu en CSV UTF-8 avec BOM, séparateur « ; », fins de ligne CRLF (Excel en
// français). Les dates sont en heure locale (loc), les décimaux à virgule.
func writeCSV(t table, loc *time.Location) ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteString(utf8BOM)
	w := csv.NewWriter(&buf)
	w.Comma, w.UseCRLF = ';', true
	if err := w.Write(t.columns); err != nil {
		return nil, err
	}
	record := make([]string, len(t.columns))
	for _, row := range t.rows {
		for i, v := range row {
			cell, err := csvCell(v, loc)
			if err != nil {
				return nil, err
			}
			record[i] = cell
		}
		if err := w.Write(record); err != nil {
			return nil, err
		}
	}
	w.Flush()
	return buf.Bytes(), w.Error()
}

// writeJSON écrit { dataset, generatedAt, params, items: [{ colonne: valeur }] } ; dates en RFC 3339
// UTC, nombres natifs.
func writeJSON(dataset string, params Params, generatedAt time.Time, t table) ([]byte, error) {
	items := make([]map[string]any, 0, len(t.rows))
	for _, row := range t.rows {
		item := make(map[string]any, len(t.columns))
		for i, v := range row {
			switch x := v.(type) {
			case time.Time:
				v = x.UTC()
			case *time.Time:
				if x != nil {
					v = x.UTC()
				}
			}
			item[t.columns[i]] = v
		}
		items = append(items, item)
	}
	return json.Marshal(map[string]any{
		"dataset": dataset, "generatedAt": generatedAt.UTC(), "params": params, "items": items,
	})
}
