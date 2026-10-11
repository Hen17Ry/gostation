package analytics

import (
	"fmt"
	"time"

	"gostation/backend/internal/apperr"
)

// Périodes des stats et du tableau de bord.
const (
	Period24h    = "24h"
	Period7d     = "7d" // défaut
	Period30d    = "30d"
	PeriodCustom = "custom"

	// MaxCustomDays borne une plage personnalisée.
	MaxCustomDays = 366
)

// Granularités des séries.
const (
	GranularityHour = "hour"
	GranularityDay  = "day"
)

// Period est une fenêtre de stats [From, To) et la fenêtre précédente de même durée.
//
//   - 24h : les 24 dernières heures entières, heure en cours comprise ; séries par heure.
//   - 7d, 30d : les 7 (30) derniers jours locaux, aujourd'hui compris jusqu'à maintenant ; la période
//     précédente s'arrête à la même heure, 7 (30) jours plus tôt (comparaison à durée égale).
//   - custom : jours locaux from à to inclus (to ≤ aujourd'hui, 366 jours au plus).
//
// Les cellules (pénuries, top des zones) se lisent sur les jours locaux FirstDay à LastDay
// (agrégats journaliers), ou sur la fenêtre horaire pour 24h (Hourly).
type Period struct {
	Key         string
	From, To    time.Time
	PrevFrom    time.Time
	PrevTo      time.Time
	FirstDay    time.Time // minuit local du premier jour (périodes en jours)
	LastDay     time.Time // minuit local du dernier jour inclus
	Hourly      bool      // cellules lues heure par heure (24h)
	Granularity string
}

func midnight(t time.Time, loc *time.Location) time.Time {
	l := t.In(loc)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, loc)
}

func invalidPeriod(field, msg string) error {
	return apperr.Validation(apperr.FieldError{Field: field, Code: "invalid", Message: msg})
}

// ParsePeriod lit ?period=24h|7d|30d|custom (défaut 7d) et, pour custom, ?from=&to= (dates
// YYYY-MM-DD, jours locaux inclus).
func ParsePeriod(key, from, to string, now time.Time, loc *time.Location) (Period, error) {
	hourEnd := now.Truncate(time.Hour).Add(time.Hour) // fin de l'heure en cours
	if key == "" {
		key = Period7d
	}
	if key != PeriodCustom && (from != "" || to != "") {
		return Period{}, invalidPeriod("period", "from and to are only allowed with period=custom")
	}
	today := midnight(now, loc)
	p := Period{Key: key, Granularity: GranularityDay}
	switch key {
	case Period24h:
		p.From, p.To = hourEnd.Add(-24*time.Hour), hourEnd
		p.PrevFrom, p.PrevTo = p.From.Add(-24*time.Hour), p.From
		p.Hourly, p.Granularity = true, GranularityHour
		return p, nil
	case Period7d, Period30d:
		days := 7
		if key == Period30d {
			days = 30
		}
		p.FirstDay, p.LastDay = today.AddDate(0, 0, -(days-1)), today
		p.From, p.To = p.FirstDay, hourEnd
		p.PrevFrom, p.PrevTo = p.From.AddDate(0, 0, -days), p.To.AddDate(0, 0, -days)
		return p, nil
	case PeriodCustom:
		if from == "" || to == "" {
			return Period{}, invalidPeriod("from", "from and to (YYYY-MM-DD) are required with period=custom")
		}
		first, err := time.ParseInLocation(time.DateOnly, from, loc)
		if err != nil {
			return Period{}, invalidPeriod("from", "must be a date such as 2026-10-01")
		}
		last, err := time.ParseInLocation(time.DateOnly, to, loc)
		if err != nil {
			return Period{}, invalidPeriod("to", "must be a date such as 2026-10-07")
		}
		switch {
		case last.Before(first):
			return Period{}, invalidPeriod("to", "must be on or after from")
		case last.After(today):
			return Period{}, invalidPeriod("to", "must not be in the future")
		}
		days := 1
		for d := first; d.Before(last); d = d.AddDate(0, 0, 1) {
			if days++; days > MaxCustomDays {
				return Period{}, invalidPeriod("from", fmt.Sprintf("the range must not exceed %d days", MaxCustomDays))
			}
		}
		p.FirstDay, p.LastDay = first, last
		p.From, p.To = first, last.AddDate(0, 0, 1)
		if p.To.After(hourEnd) {
			p.To = hourEnd
		}
		p.PrevFrom, p.PrevTo = p.From.AddDate(0, 0, -days), p.To.AddDate(0, 0, -days)
		if days <= 2 {
			p.Granularity = GranularityHour
		}
		return p, nil
	default:
		return Period{}, invalidPeriod("period", "must be 24h, 7d, 30d or custom")
	}
}

// buckets énumère les débuts de tranche de [From, To) (heures, ou jours locaux).
func (p Period) buckets(loc *time.Location) []time.Time {
	var out []time.Time
	if p.Granularity == GranularityHour {
		for t := p.From.Truncate(time.Hour); t.Before(p.To); t = t.Add(time.Hour) {
			out = append(out, t)
		}
		return out
	}
	for d := midnight(p.From, loc); d.Before(p.To); d = d.AddDate(0, 0, 1) {
		out = append(out, d)
	}
	return out
}
