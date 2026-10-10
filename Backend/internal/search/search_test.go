package search

import (
	"testing"
	"time"
)

func TestSortByServedAt(t *testing.T) {
	now := time.Date(2026, 10, 10, 21, 0, 0, 0, time.UTC)
	dur := func(s int) *int { return &s }
	at := func(h int) *time.Time { v := now.Add(time.Duration(h) * time.Hour); return &v }
	items := []Item{
		{Name: "closed-reopens-in-10h-near", IsOpen: false, NextOpening: at(10), DurationS: dur(600), DistanceM: 5_000},
		{Name: "open-far", IsOpen: true, DurationS: dur(3 * 3600), DistanceM: 150_000},
		{Name: "closed-reopens-in-10h-far", IsOpen: false, NextOpening: at(10), DurationS: dur(1800), DistanceM: 20_000},
		{Name: "unreachable", IsOpen: true, DistanceM: 1_000},
		// Fermée mais rouvre avant d'y arriver : servie à l'arrivée.
		{Name: "closed-reopens-in-1h-but-4h-away", IsOpen: false, NextOpening: at(1), DurationS: dur(4 * 3600), DistanceM: 200_000},
	}
	setServed(items, now)
	sortByServedAt(items)
	want := []string{"open-far", "closed-reopens-in-1h-but-4h-away", "closed-reopens-in-10h-near", "closed-reopens-in-10h-far", "unreachable"}
	for i, w := range want {
		if items[i].Name != w {
			t.Fatalf("position %d: %s, want %s (order %v)", i, items[i].Name, w, names(items))
		}
	}
	if !items[1].ServedAt.Equal(now.Add(4 * time.Hour)) {
		t.Errorf("servedAt = %s, want arrival time", items[1].ServedAt)
	}
	if !items[2].ServedAt.Equal(*at(10)) {
		t.Errorf("servedAt = %s, want reopening", items[2].ServedAt)
	}
}

func names(items []Item) []string {
	out := make([]string, len(items))
	for i, it := range items {
		out[i] = it.Name
	}
	return out
}

func TestValidCoords(t *testing.T) {
	for _, c := range [][2]float64{{91, 0}, {-91, 0}, {0, 181}, {0, -180.1}} {
		if validCoords(c[0], c[1]) == nil {
			t.Errorf("%v accepted", c)
		}
	}
	if err := validCoords(6.37, 2.42); err != nil {
		t.Error(err)
	}
}
