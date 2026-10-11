package station

import (
	"testing"
	"time"

	"gostation/backend/internal/apperr"
)

var benin = func() *time.Location {
	loc, err := time.LoadLocation("Africa/Porto-Novo")
	if err != nil {
		panic(err)
	}
	return loc
}()

// at construit un instant local ; le 2026-10-12 est un lundi.
func at(day, hour, minute int) time.Time {
	return time.Date(2026, 10, day, hour, minute, 0, 0, benin)
}

func mustParse(t *testing.T, in HoursInput) []Range {
	t.Helper()
	ranges, err := ParseHours(in)
	if err != nil {
		t.Fatalf("ParseHours: %v", err)
	}
	return ranges
}

func TestIsOpenEdgeCases(t *testing.T) {
	ranges := mustParse(t, HoursInput{Days: []DayInput{
		{Weekday: 1, Ranges: []RangeInput{{"06:00", "12:00"}, {"14:00", "20:00"}}}, // lundi, deux plages
		{Weekday: 5, Ranges: []RangeInput{{"18:00", "02:00"}}},                     // vendredi soir → samedi 2 h
		{Weekday: 6, Ranges: []RangeInput{{"08:00", "00:00"}}},                     // samedi jusqu'à minuit
		{Weekday: 7, Is24h: true},                                                  // dimanche 24 h/24
	}})
	s := Schedule{Ranges: ranges, Loc: benin, Closures: map[string]bool{}}

	tests := []struct {
		name string
		t    time.Time
		want bool
	}{
		{"monday before opening", at(12, 5, 59), false},
		{"monday opening minute (inclusive)", at(12, 6, 0), true},
		{"monday closing minute (exclusive)", at(12, 12, 0), false},
		{"monday lunch break", at(12, 13, 0), false},
		{"monday second range", at(12, 19, 59), true},
		{"tuesday closed", at(13, 10, 0), false},
		{"friday evening", at(16, 23, 30), true},
		{"saturday 1 am, tail of friday's overnight range", at(17, 1, 0), true},
		{"saturday 2 am, overnight range ended", at(17, 2, 0), false},
		{"saturday 23:59, open until midnight", at(17, 23, 59), true},
		{"sunday 00:00 (24h day)", at(18, 0, 0), true},
		{"sunday 23:59 (24h day)", at(18, 23, 59), true},
		{"instant expressed in UTC", time.Date(2026, 10, 12, 5, 30, 0, 0, time.UTC), true}, // 06:30 au Bénin
	}
	for _, tt := range tests {
		if got := s.IsOpen(tt.t); got != tt.want {
			t.Errorf("%s: IsOpen(%s) = %v, want %v", tt.name, tt.t.Format(time.RFC3339), got, tt.want)
		}
	}
}

func TestIsOpenWithClosures(t *testing.T) {
	ranges := mustParse(t, HoursInput{Days: []DayInput{
		{Weekday: 5, Ranges: []RangeInput{{"18:00", "02:00"}}}, // vendredi → samedi 2 h
		{Weekday: 6, Ranges: []RangeInput{{"18:00", "02:00"}}}, // samedi → dimanche 2 h
		{Weekday: 7, Ranges: []RangeInput{{"06:00", "12:00"}}}, // dimanche matin
	}})

	// Fermeture le samedi : la journée civile entière est fermée (y compris la fin, samedi à 1 h,
	// de la plage du vendredi), et la plage du samedi est annulée jusqu'à sa fin, dimanche à 1 h.
	s := Schedule{Ranges: ranges, Loc: benin, Closures: map[string]bool{"2026-10-17": true}}
	for _, c := range []struct {
		name string
		t    time.Time
		want bool
	}{
		{"friday evening, not closed", at(16, 20, 0), true},
		{"saturday 1 am, closure day", at(17, 1, 0), false},
		{"saturday evening, closure day", at(17, 20, 0), false},
		{"sunday 1 am, tail of the cancelled saturday range", at(18, 1, 0), false},
		{"sunday morning, not closed", at(18, 7, 0), true},
	} {
		if got := s.IsOpen(c.t); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}

	// Fermeture le dimanche : la fin de la plage du samedi (dimanche à 1 h) est fermée aussi.
	sunday := Schedule{Ranges: ranges, Loc: benin, Closures: map[string]bool{"2026-10-18": true}}
	if sunday.IsOpen(at(18, 0, 30)) || sunday.IsOpen(at(18, 7, 0)) {
		t.Error("a closure must close the whole civil day, including the tail of the previous night")
	}
	if !sunday.IsOpen(at(17, 23, 0)) {
		t.Error("saturday evening must stay open when only sunday is closed")
	}

	// Jour férié sur une station 24 h/24.
	always := Schedule{Ranges: mustParse(t, HoursInput{AllWeek24h: true}), Loc: benin, Closures: map[string]bool{"2026-12-25": true}}
	if always.IsOpen(time.Date(2026, 12, 25, 12, 0, 0, 0, benin)) || !always.IsOpen(time.Date(2026, 12, 26, 0, 0, 0, 0, benin)) {
		t.Error("a holiday must close a 24/7 station for that civil day only")
	}
}

func TestAllWeek24hAndNextOpening(t *testing.T) {
	always := Schedule{Ranges: mustParse(t, HoursInput{AllWeek24h: true}), Loc: benin}
	for _, tt := range []time.Time{at(12, 0, 0), at(14, 3, 17), at(18, 23, 59)} {
		if !always.IsOpen(tt) {
			t.Errorf("24/7 station closed at %s", tt)
		}
	}
	if _, ok := always.NextOpening(at(12, 10, 0)); ok {
		t.Error("a station that never closes has no next opening")
	}

	s := Schedule{
		Ranges: mustParse(t, HoursInput{Days: []DayInput{
			{Weekday: 1, Ranges: []RangeInput{{"06:00", "12:00"}, {"14:00", "20:00"}}},
			{Weekday: 3, Ranges: []RangeInput{{"07:00", "19:00"}}},
		}}),
		Loc:      benin,
		Closures: map[string]bool{"2026-10-14": true}, // mercredi fermé
	}
	cases := []struct {
		from time.Time
		want time.Time
	}{
		{at(12, 5, 0), at(12, 6, 0)},   // avant l'ouverture du lundi
		{at(12, 13, 0), at(12, 14, 0)}, // pause de midi
		{at(12, 10, 0), at(12, 14, 0)}, // ouvert : prochaine réouverture
		{at(12, 21, 0), at(19, 6, 0)},  // mercredi fermé → lundi suivant
	}
	for _, c := range cases {
		got, ok := s.NextOpening(c.from)
		if !ok || !got.Equal(c.want) {
			t.Errorf("NextOpening(%s) = %s %v, want %s", c.from, got, ok, c.want)
		}
	}
	if _, ok := (Schedule{Loc: benin}).NextOpening(at(12, 0, 0)); ok {
		t.Error("a station without hours has no next opening")
	}
}

func TestParseHoursValidation(t *testing.T) {
	tests := []struct {
		name string
		in   HoursInput
		code string
	}{
		{"three ranges", HoursInput{Days: []DayInput{{Weekday: 1, Ranges: []RangeInput{{"06:00", "08:00"}, {"09:00", "10:00"}, {"11:00", "12:00"}}}}}, "too_many"},
		{"bad weekday", HoursInput{Days: []DayInput{{Weekday: 8, Is24h: true}}}, "invalid"},
		{"duplicate weekday", HoursInput{Days: []DayInput{{Weekday: 2, Is24h: true}, {Weekday: 2, Is24h: true}}}, "duplicate"},
		{"bad clock", HoursInput{Days: []DayInput{{Weekday: 1, Ranges: []RangeInput{{"6h", "12:00"}}}}}, "invalid"},
		{"24:30", HoursInput{Days: []DayInput{{Weekday: 1, Ranges: []RangeInput{{"06:00", "24:30"}}}}}, "invalid"},
		{"empty range", HoursInput{Days: []DayInput{{Weekday: 1, Ranges: []RangeInput{{"06:00", "06:00"}}}}}, "empty"},
		{"same-day overlap", HoursInput{Days: []DayInput{{Weekday: 1, Ranges: []RangeInput{{"06:00", "13:00"}, {"12:00", "18:00"}}}}}, "overlap"},
		{"overnight overlaps next morning", HoursInput{Days: []DayInput{
			{Weekday: 1, Ranges: []RangeInput{{"20:00", "03:00"}}},
			{Weekday: 2, Ranges: []RangeInput{{"02:00", "10:00"}}},
		}}, "overlap"},
		{"sunday night overlaps monday morning", HoursInput{Days: []DayInput{
			{Weekday: 7, Ranges: []RangeInput{{"22:00", "06:00"}}},
			{Weekday: 1, Ranges: []RangeInput{{"05:00", "12:00"}}},
		}}, "overlap"},
		{"24h with ranges", HoursInput{Days: []DayInput{{Weekday: 1, Is24h: true, Ranges: []RangeInput{{"06:00", "12:00"}}}}}, "conflict"},
		{"day without ranges", HoursInput{Days: []DayInput{{Weekday: 1}}}, "required"},
		{"allWeek24h with days", HoursInput{AllWeek24h: true, Days: []DayInput{{Weekday: 1, Is24h: true}}}, "conflict"},
	}
	for _, tt := range tests {
		_, err := ParseHours(tt.in)
		e, ok := apperr.As(err)
		if !ok || len(e.Fields) == 0 || e.Fields[0].Code != tt.code {
			t.Errorf("%s: ParseHours error = %v, want field code %s", tt.name, err, tt.code)
		}
	}

	// Plages adjacentes sur deux jours (24 h/24 lundi et mardi) : pas de chevauchement.
	if _, err := ParseHours(HoursInput{Days: []DayInput{{Weekday: 1, Is24h: true}, {Weekday: 2, Is24h: true}}}); err != nil {
		t.Errorf("adjacent 24h days rejected: %v", err)
	}
	ranges := mustParse(t, HoursInput{Days: []DayInput{{Weekday: 3, Ranges: []RangeInput{{"14:00", "20:00"}, {"06:00", "12:00"}}}}})
	if ranges[0].Opens != 6*60 || FormatClock(ranges[1].Closes) != "20:00" {
		t.Errorf("ranges not sorted: %+v", ranges)
	}
}

func TestParseClosureDate(t *testing.T) {
	now := at(12, 10, 0)
	if _, err := ParseClosureDate("2026-10-12", now, benin); err != nil {
		t.Errorf("today rejected: %v", err)
	}
	for in, code := range map[string]string{"2026-10-11": "in_past", "2027-10-13": "too_far", "25/12/2026": "invalid"} {
		_, err := ParseClosureDate(in, now, benin)
		if e, ok := apperr.As(err); !ok || e.Fields[0].Code != code {
			t.Errorf("ParseClosureDate(%q) = %v, want %s", in, err, code)
		}
	}
}

func TestDayEnd(t *testing.T) {
	split := mustParse(t, HoursInput{Days: []DayInput{
		{Weekday: 1, Ranges: []RangeInput{{"06:00", "12:00"}, {"14:00", "22:00"}}}, // lundi, deux plages
		{Weekday: 5, Ranges: []RangeInput{{"18:00", "02:00"}}},                     // vendredi soir → samedi 2 h
	}})
	allDay := mustParse(t, HoursInput{AllWeek24h: true})
	cases := []struct {
		name     string
		ranges   []Range
		closures map[string]bool
		now      time.Time
		want     time.Time
	}{
		{"between two ranges: last closing of the day", split, nil, at(12, 13, 0), at(12, 22, 0)},
		{"during the first range", split, nil, at(12, 7, 0), at(12, 22, 0)},
		{"after the last closing: midnight", split, nil, at(12, 23, 0), at(13, 0, 0)},
		{"overnight range ends the next morning", split, nil, at(16, 19, 0), at(17, 2, 0)},
		{"tail of last night's range", split, nil, at(17, 1, 0), at(17, 2, 0)},
		{"day without hours: midnight", split, nil, at(14, 10, 0), at(15, 0, 0)},
		{"24/7: midnight", allDay, nil, at(14, 10, 0), at(15, 0, 0)},
		{"closed today: midnight", split, map[string]bool{"2026-10-12": true}, at(12, 13, 0), at(13, 0, 0)},
	}
	for _, c := range cases {
		closures := c.closures
		if closures == nil {
			closures = map[string]bool{}
		}
		s := Schedule{Ranges: c.ranges, Loc: benin, Closures: closures}
		if got := s.DayEnd(c.now); !got.Equal(c.want) {
			t.Errorf("%s: DayEnd(%s) = %s, want %s", c.name, c.now, got, c.want)
		}
	}
}

func TestClockAt(t *testing.T) {
	// Dimanche 18 octobre 2026, 00:30 à Porto-Novo (UTC+1) = samedi 23:30 UTC.
	c := ClockAt(time.Date(2026, 10, 17, 23, 30, 0, 0, time.UTC), benin)
	if c.ISODow != 7 || c.PrevISODow != 6 || c.Date.Time.Format(time.DateOnly) != "2026-10-18" ||
		c.PrevDate.Time.Format(time.DateOnly) != "2026-10-17" || c.Time.Microseconds != 30*60*1_000_000 {
		t.Fatalf("ClockAt = %+v", c)
	}
	if got := DayStart(time.Date(2026, 10, 17, 23, 30, 0, 0, time.UTC), benin); !got.Equal(at(18, 0, 0)) {
		t.Fatalf("DayStart = %s", got)
	}
}
