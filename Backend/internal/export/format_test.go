package export

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestWriteCSVForFrenchExcel(t *testing.T) {
	loc, _ := time.LoadLocation("Africa/Porto-Novo")
	at := time.Date(2026, 10, 11, 9, 30, 0, 0, time.UTC)
	name := "Station « Akpakpa » ; nord"
	tb := table{
		columns: []string{"name", "lat", "quantity", "at", "comment", "missing", "metadata"},
		rows: [][]any{
			{name, 6.3601, int32(14), at, "=1+1", (*string)(nil), json.RawMessage(`{"a":1}`)},
			{"-5 bouteilles", -0.5, int64(0), &at, "@SUM(A1)", nil, json.RawMessage(`{}`)},
		},
	}
	out, err := writeCSV(tb, loc)
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)
	if !strings.HasPrefix(s, "\xEF\xBB\xBF") {
		t.Fatal("missing UTF-8 BOM")
	}
	lines := strings.Split(strings.TrimPrefix(s, "\xEF\xBB\xBF"), "\r\n")
	if lines[0] != "name;lat;quantity;at;comment;missing;metadata" {
		t.Fatalf("header = %q", lines[0])
	}
	want1 := `"Station « Akpakpa » ; nord";6,3601;14;2026-10-11 10:30:00;'=1+1;;"{""a"":1}"`
	want2 := `'-5 bouteilles;-0,5;0;2026-10-11 10:30:00;'@SUM(A1);;{}`
	if lines[1] != want1 || lines[2] != want2 {
		t.Fatalf("rows =\n%q\n%q\nwant\n%q\n%q", lines[1], lines[2], want1, want2)
	}
	if _, err := writeCSV(table{columns: []string{"x"}, rows: [][]any{{struct{}{}}}}, loc); err == nil {
		t.Error("unsupported value accepted")
	}
}

func TestWriteJSON(t *testing.T) {
	local := time.Date(2026, 10, 11, 10, 30, 0, 0, time.FixedZone("WAT", 3600))
	out, err := writeJSON("stocks", Params{From: "2026-10-01"}, local, table{columns: []string{"quantity", "at"}, rows: [][]any{{int32(3), local}}})
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Dataset     string           `json:"dataset"`
		GeneratedAt string           `json:"generatedAt"`
		Params      Params           `json:"params"`
		Items       []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(out, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Dataset != "stocks" || doc.GeneratedAt != "2026-10-11T09:30:00Z" || doc.Params.From != "2026-10-01" ||
		doc.Items[0]["quantity"] != float64(3) || doc.Items[0]["at"] != "2026-10-11T09:30:00Z" {
		t.Fatalf("json export = %s", out)
	}
}

func TestPseudonymIsStableAndOpaque(t *testing.T) {
	s := &Service{Deps: Deps{PseudonymKey: []byte("0123456789abcdef0123456789abcdef")}}
	id := uuid.MustParse("01920000-0000-7000-8000-000000000001")
	a, b := s.pseudonym(&id, nil), s.pseudonym(&id, nil)
	if a == nil || *a != *b || !strings.HasPrefix(*a, "u_") || len(*a) != 18 {
		t.Fatalf("pseudonym = %v", a)
	}
	if s.pseudonym(nil, nil) != nil {
		t.Error("deleted reporter must stay null")
	}
	// Passé 90 jours, le pseudonyme est en base : même clé, même valeur.
	if got := s.pseudonym(nil, a); got != a {
		t.Errorf("stored pseudonym = %v, want %v", got, a)
	}
}
