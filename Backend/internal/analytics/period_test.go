package analytics

import (
	"testing"
	"time"
)

func TestParsePeriod(t *testing.T) {
	loc, err := time.LoadLocation("Africa/Porto-Novo")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 11, 10, 40, 0, 0, loc) // samedi 10 h 40, heure locale
	day := func(d, h int) time.Time { return time.Date(2026, 10, d, h, 0, 0, 0, loc) }

	tests := []struct {
		name, key, from, to string
		wantFrom, wantTo    time.Time
		wantPrevFrom        time.Time
		wantPrevTo          time.Time
		hourly              bool
		granularity         string
		buckets             int
	}{
		{
			name: "24 h", key: "24h", wantFrom: day(10, 11), wantTo: day(11, 11), wantPrevFrom: day(9, 11), wantPrevTo: day(10, 11),
			hourly: true, granularity: GranularityHour, buckets: 24,
		},
		{
			name: "7 jours par défaut", wantFrom: day(5, 0), wantTo: day(11, 11), wantPrevFrom: time.Date(2026, 9, 28, 0, 0, 0, 0, loc),
			wantPrevTo: day(4, 11), granularity: GranularityDay, buckets: 7,
		},
		{
			name: "30 jours", key: "30d", wantFrom: time.Date(2026, 9, 12, 0, 0, 0, 0, loc), wantTo: day(11, 11),
			wantPrevFrom: time.Date(2026, 8, 13, 0, 0, 0, 0, loc), wantPrevTo: time.Date(2026, 9, 11, 11, 0, 0, 0, loc),
			granularity: GranularityDay, buckets: 30,
		},
		{
			name: "plage passée", key: "custom", from: "2026-10-01", to: "2026-10-03", wantFrom: day(1, 0), wantTo: day(4, 0),
			wantPrevFrom: time.Date(2026, 9, 28, 0, 0, 0, 0, loc), wantPrevTo: day(1, 0), granularity: GranularityDay, buckets: 3,
		},
		{
			name: "plage jusqu'à aujourd'hui", key: "custom", from: "2026-10-10", to: "2026-10-11", wantFrom: day(10, 0), wantTo: day(11, 11),
			wantPrevFrom: day(8, 0), wantPrevTo: day(9, 11), granularity: GranularityHour, buckets: 35,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p, err := ParsePeriod(tc.key, tc.from, tc.to, now, loc)
			if err != nil {
				t.Fatal(err)
			}
			if !p.From.Equal(tc.wantFrom) || !p.To.Equal(tc.wantTo) || !p.PrevFrom.Equal(tc.wantPrevFrom) || !p.PrevTo.Equal(tc.wantPrevTo) {
				t.Fatalf("period = [%s, %s) prev [%s, %s)", p.From, p.To, p.PrevFrom, p.PrevTo)
			}
			if p.Hourly != tc.hourly || p.Granularity != tc.granularity || len(p.buckets(loc)) != tc.buckets {
				t.Fatalf("hourly %v, granularity %s, %d buckets", p.Hourly, p.Granularity, len(p.buckets(loc)))
			}
			if p.To.Sub(p.From) != p.PrevTo.Sub(p.PrevFrom) {
				t.Fatal("previous period of a different length")
			}
		})
	}

	for _, bad := range [][3]string{
		{"1y", "", ""},
		{"custom", "2026-10-01", ""},
		{"custom", "2026-10-05", "2026-10-01"},
		{"custom", "2026-10-01", "2026-10-12"},
		{"custom", "2025-01-01", "2026-10-01"},
		{"custom", "01/10/2026", "2026-10-02"},
		{"7d", "2026-10-01", ""},
	} {
		if _, err := ParsePeriod(bad[0], bad[1], bad[2], now, loc); err == nil {
			t.Errorf("ParsePeriod(%q, %q, %q) accepted", bad[0], bad[1], bad[2])
		}
	}
	// 366 jours, bornes comprises : accepté.
	if _, err := ParsePeriod("custom", "2025-10-11", "2026-10-11", now, loc); err != nil {
		t.Errorf("366-day range refused: %v", err)
	}
}

func TestKPIChangeAndTopShortages(t *testing.T) {
	if (KPI{Value: 3}).Change() != nil {
		t.Error("change against 0 must be null")
	}
	if c := (KPI{Value: 30, Previous: 20}).Change(); c == nil || *c != 0.5 {
		t.Errorf("change = %v, want 0.5", c)
	}
	cells := []Cell{
		{Cell: 1, Empty: 5, Rate: 0.5, Shortage: true},
		{Cell: 2, Empty: 9, Rate: 0.9, Shortage: true},
		{Cell: 3, Empty: 50, Rate: 0.4},
		{Cell: 4, Empty: 9, Rate: 0.6, Shortage: true},
	}
	top := topShortages(cells, 2)
	if len(top) != 2 || top[0].Cell != 2 || top[1].Cell != 4 {
		t.Fatalf("top = %+v, want cells 2 then 4 (shortages by unmet searches, then rate)", top)
	}
}
