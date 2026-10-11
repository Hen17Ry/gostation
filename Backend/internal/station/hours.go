package station

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"gostation/backend/internal/apperr"
)

// Horaires (D12) : jusqu'à 2 plages par jour, dans le fuseau de l'application (Africa/Porto-Novo).
//   - Une plage est [Opens, Closes[ en minutes depuis minuit, 0 ≤ Opens < 1440, 0 < Closes ≤ 1440.
//   - Closes ≤ Opens : la plage passe minuit et se termine le lendemain à Closes.
//   - 24 h/24 un jour donné : la plage 00:00 → 24:00.
//   - Une plage appartient au jour où elle commence.
//   - Une fermeture exceptionnelle couvre la journée civile entière : elle ferme les plages de ce
//     jour (y compris leur fin après minuit) et la fin, ce jour-là, d'une plage commencée la veille.

const (
	minutesPerDay = 24 * 60
	// MaxRangesPerDay est le nombre maximal de plages par jour.
	MaxRangesPerDay = 2
)

// Range est une plage d'ouverture d'un jour ISO (1 = lundi … 7 = dimanche).
type Range struct {
	Weekday int
	Opens   int // minutes depuis minuit
	Closes  int // minutes depuis minuit ; 1440 = 24:00
}

// overnight indique que la plage se termine le lendemain.
func (r Range) overnight() bool { return r.Closes <= r.Opens }

// end renvoie la fin de la plage en minutes depuis le début de son jour (> 1440 si elle passe minuit).
func (r Range) end() int {
	if r.overnight() {
		return r.Closes + minutesPerDay
	}
	return r.Closes
}

// Is24h indique une journée entière.
func (r Range) Is24h() bool { return r.Opens == 0 && r.Closes == minutesPerDay }

// Schedule est l'emploi du temps d'une station.
type Schedule struct {
	Ranges []Range
	// Closures contient les dates fermées, au format 2006-01-02 (date civile locale).
	Closures map[string]bool
	Loc      *time.Location
}

func isoWeekday(t time.Time) int {
	if wd := int(t.Weekday()); wd != 0 {
		return wd
	}
	return 7
}

func dateKey(t time.Time) string { return t.Format(time.DateOnly) }

// IsOpen indique si la station est ouverte à l'instant t.
func (s Schedule) IsOpen(t time.Time) bool {
	local := t.In(s.Loc)
	today := dateKey(local)
	if s.Closures[today] {
		return false
	}
	minute := local.Hour()*60 + local.Minute()
	weekday := isoWeekday(local)
	yesterday := local.AddDate(0, 0, -1)
	yesterdayClosed := s.Closures[dateKey(yesterday)]
	prevWeekday := isoWeekday(yesterday)

	for _, r := range s.Ranges {
		switch {
		case r.Weekday == weekday && minute >= r.Opens && minute < r.end():
			return true
		case r.Weekday == prevWeekday && r.overnight() && !yesterdayClosed && minute < r.Closes:
			return true
		}
	}
	return false
}

// NextOpening renvoie le prochain instant d'ouverture strictement après t (dans l'année qui vient),
// ou false si la station n'a pas d'horaires ou reste fermée. Si la station est ouverte à t, c'est
// la prochaine réouverture après la fermeture en cours qui est renvoyée.
func (s Schedule) NextOpening(t time.Time) (time.Time, bool) {
	if len(s.Ranges) == 0 {
		return time.Time{}, false
	}
	local := t.In(s.Loc)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, s.Loc)
	for i := 0; i <= 366; i++ {
		d := day.AddDate(0, 0, i)
		if s.Closures[dateKey(d)] {
			continue
		}
		var starts []time.Time
		for _, r := range s.Ranges {
			if r.Weekday != isoWeekday(d) {
				continue
			}
			start := d.Add(time.Duration(r.Opens) * time.Minute)
			// Une plage 00:00 qui prolonge sans interruption la plage de la veille n'est pas une réouverture.
			if r.Opens == 0 && s.IsOpen(start.Add(-time.Minute)) {
				continue
			}
			if start.After(t) && !s.IsOpen(start.Add(-time.Minute)) {
				starts = append(starts, start)
			}
		}
		if len(starts) > 0 {
			sort.Slice(starts, func(a, b int) bool { return starts[a].Before(starts[b]) })
			return starts[0], true
		}
	}
	return time.Time{}, false
}

// ── Saisie des horaires ─────────────────────────────────────────────────────

// DayInput est la saisie d'un jour : 24 h/24, ou jusqu'à 2 plages « HH:MM ».
type DayInput struct {
	Weekday int
	Is24h   bool
	Ranges  []RangeInput
}

// RangeInput est une plage saisie (« 06:00 » → « 22:00 », « 24:00 » ou « 00:00 » pour minuit).
type RangeInput struct {
	Opens  string
	Closes string
}

// HoursInput est la saisie complète de la semaine. AllWeek24h remplace tout le reste.
// Un jour absent est un jour fermé.
type HoursInput struct {
	AllWeek24h bool
	Days       []DayInput
}

func parseClock(s string) (int, bool) {
	if len(s) != 5 || s[2] != ':' {
		return 0, false
	}
	var h, m int
	if _, err := fmt.Sscanf(s, "%02d:%02d", &h, &m); err != nil {
		return 0, false
	}
	if m < 0 || m > 59 || h < 0 || h > 24 || (h == 24 && m != 0) {
		return 0, false
	}
	return h*60 + m, true
}

// FormatClock formate des minutes en « HH:MM » (1440 → « 24:00 »).
func FormatClock(minutes int) string { return fmt.Sprintf("%02d:%02d", minutes/60, minutes%60) }

// ParseHours valide la saisie et renvoie les plages normalisées, triées par jour puis ouverture.
// Erreurs de validation : jour invalide ou en double, plus de 2 plages, heure mal formée, plage
// vide, chevauchement dans la journée ou avec la fin d'une plage de la veille.
func ParseHours(in HoursInput) ([]Range, error) {
	if in.AllWeek24h {
		if len(in.Days) > 0 {
			return nil, apperr.Validation(apperr.FieldError{Field: "days", Code: "conflict", Message: "must be empty when allWeek24h is true"})
		}
		out := make([]Range, 7)
		for i := range out {
			out[i] = Range{Weekday: i + 1, Opens: 0, Closes: minutesPerDay}
		}
		return out, nil
	}

	var fields []apperr.FieldError
	fail := func(field, code, msg string) {
		fields = append(fields, apperr.FieldError{Field: field, Code: code, Message: msg})
	}
	seen := map[int]bool{}
	var out []Range
	for i, d := range in.Days {
		prefix := fmt.Sprintf("days[%d]", i)
		if d.Weekday < 1 || d.Weekday > 7 {
			fail(prefix+".weekday", "invalid", "must be between 1 (Monday) and 7 (Sunday)")
			continue
		}
		if seen[d.Weekday] {
			fail(prefix+".weekday", "duplicate", "each weekday must appear once")
			continue
		}
		seen[d.Weekday] = true
		if d.Is24h {
			if len(d.Ranges) > 0 {
				fail(prefix+".ranges", "conflict", "must be empty when is24h is true")
				continue
			}
			out = append(out, Range{Weekday: d.Weekday, Opens: 0, Closes: minutesPerDay})
			continue
		}
		switch {
		case len(d.Ranges) == 0:
			fail(prefix+".ranges", "required", "a day needs is24h or at least one range (omit the day if closed)")
			continue
		case len(d.Ranges) > MaxRangesPerDay:
			fail(prefix+".ranges", "too_many", fmt.Sprintf("at most %d ranges per day", MaxRangesPerDay))
			continue
		}
		for j, ri := range d.Ranges {
			field := fmt.Sprintf("%s.ranges[%d]", prefix, j)
			opens, ok1 := parseClock(ri.Opens)
			closes, ok2 := parseClock(ri.Closes)
			if !ok1 || !ok2 || opens == minutesPerDay {
				fail(field, "invalid", "times must be HH:MM (00:00 to 23:59, closes may be 24:00)")
				continue
			}
			if closes == 0 {
				closes = minutesPerDay // « jusqu'à minuit »
			}
			if opens == closes {
				fail(field, "empty", "opens and closes must differ (use is24h for a full day)")
				continue
			}
			out = append(out, Range{Weekday: d.Weekday, Opens: opens, Closes: closes})
		}
	}
	if len(fields) > 0 {
		return nil, apperr.Validation(fields...)
	}
	sort.Slice(out, func(a, b int) bool {
		if out[a].Weekday != out[b].Weekday {
			return out[a].Weekday < out[b].Weekday
		}
		return out[a].Opens < out[b].Opens
	})
	if err := checkOverlaps(out); err != nil {
		return nil, err
	}
	return out, nil
}

// checkOverlaps refuse deux plages qui se chevauchent, dans un jour ou entre la fin d'une plage
// qui passe minuit et les plages du lendemain (y compris de dimanche à lundi).
func checkOverlaps(ranges []Range) error {
	type span struct{ from, to int }
	week := 7 * minutesPerDay
	var spans []span
	for _, r := range ranges {
		start := (r.Weekday-1)*minutesPerDay + r.Opens
		end := start + (r.end() - r.Opens)
		if end > week { // dimanche soir → lundi matin : on replie sur le début de semaine
			spans = append(spans, span{start, week}, span{0, end - week})
			continue
		}
		spans = append(spans, span{start, end})
	}
	sort.Slice(spans, func(a, b int) bool { return spans[a].from < spans[b].from })
	for i := 1; i < len(spans); i++ {
		if spans[i].from < spans[i-1].to {
			day := spans[i].from/minutesPerDay + 1
			return apperr.Validation(apperr.FieldError{
				Field: "days", Code: "overlap",
				Message: fmt.Sprintf("ranges overlap on weekday %d", day),
			})
		}
	}
	return nil
}

// ParseClosureDate valide une date de fermeture « 2006-01-02 » : aujourd'hui ou plus tard (heure
// locale), dans l'année qui vient.
func ParseClosureDate(s string, now time.Time, loc *time.Location) (time.Time, error) {
	d, err := time.ParseInLocation(time.DateOnly, strings.TrimSpace(s), loc)
	if err != nil {
		return time.Time{}, apperr.Validation(apperr.FieldError{Field: "date", Code: "invalid", Message: "must be a date such as 2026-12-25"})
	}
	local := now.In(loc)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	switch {
	case d.Before(today):
		return time.Time{}, apperr.Validation(apperr.FieldError{Field: "date", Code: "in_past", Message: "must be today or later"})
	case d.After(today.AddDate(1, 0, 0)):
		return time.Time{}, apperr.Validation(apperr.FieldError{Field: "date", Code: "too_far", Message: "must be within one year"})
	}
	return d, nil
}

// DayEnd renvoie la « fermeture du jour » vue depuis t : la fin de la dernière plage qui commence
// le jour local de t (y compris après minuit pour une plage de nuit), sinon la fin de la plage de
// nuit commencée la veille, si elle est encore à venir ; à défaut (jour fermé, ou plus aucune
// ouverture), minuit à la fin du jour local. Sert à la sourdine des rappels « pour la journée ».
func (s Schedule) DayEnd(t time.Time) time.Time {
	local := t.In(s.Loc)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, s.Loc)
	midnight := day.AddDate(0, 0, 1)
	if s.Closures[dateKey(day)] {
		return midnight
	}
	weekday := isoWeekday(day)
	yesterday := day.AddDate(0, 0, -1)
	var end time.Time
	for _, r := range s.Ranges {
		var e time.Time
		switch {
		case r.Weekday == weekday:
			e = day.Add(time.Duration(r.end()) * time.Minute)
		case r.Weekday == isoWeekday(yesterday) && r.overnight() && !s.Closures[dateKey(yesterday)]:
			e = day.Add(time.Duration(r.Closes) * time.Minute)
		default:
			continue
		}
		if e.After(end) {
			end = e
		}
	}
	if end.After(t) {
		return end
	}
	return midnight
}

// LocalClock porte les paramètres « ouverte maintenant » des requêtes SQL (search.sql,
// reminders.sql) : dates, jours ISO et heure locales, calculés en Go dans le fuseau de l'app.
type LocalClock struct {
	Date, PrevDate     pgtype.Date
	ISODow, PrevISODow int16
	Time               pgtype.Time
}

// ClockAt calcule les paramètres « ouverte maintenant » de l'instant t.
func ClockAt(t time.Time, loc *time.Location) LocalClock {
	now := t.In(loc)
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	minutes := int64(now.Hour()*60 + now.Minute())
	return LocalClock{
		Date:       pgtype.Date{Time: day, Valid: true},
		PrevDate:   pgtype.Date{Time: day.AddDate(0, 0, -1), Valid: true},
		ISODow:     int16(isoWeekday(now)),                   //nolint:gosec // 1 à 7
		PrevISODow: int16(isoWeekday(now.AddDate(0, 0, -1))), //nolint:gosec // 1 à 7
		Time:       pgtype.Time{Microseconds: minutes * int64(time.Minute/time.Microsecond), Valid: true},
	}
}

// LocalDate renvoie la date civile locale de t (minuit UTC, format des colonnes date).
func LocalDate(t time.Time, loc *time.Location) pgtype.Date {
	return ClockAt(t, loc).Date
}

// DayStart renvoie minuit, heure locale, du jour de t.
func DayStart(t time.Time, loc *time.Location) time.Time {
	local := t.In(loc)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
}
