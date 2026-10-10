package h3_test

import (
	"math"
	"testing"

	"gostation/backend/internal/platform/h3"
)

func TestCellAtCotonou(t *testing.T) {
	const lat, lng = 6.3703, 2.4253 // Dantokpa
	c, err := h3.CellAt(lat, lng, h3.ResSearchCache)
	if err != nil {
		t.Fatal(err)
	}
	if !c.IsValid() || c.Resolution() != h3.ResSearchCache {
		t.Fatalf("cell %s invalid or wrong resolution %d", c, c.Resolution())
	}
	// Le centre d'une cellule res 8 est à moins d'~0,6 km du point (≈ 0,005°).
	clat, clng, err := h3.Center(c)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(clat-lat) > 0.006 || math.Abs(clng-lng) > 0.006 {
		t.Errorf("center (%f, %f) too far from (%f, %f)", clat, clng, lat, lng)
	}
	if h3.ToInt64(c) <= 0 {
		t.Errorf("ToInt64 = %d, want positive", h3.ToInt64(c))
	}
	parent, err := h3.CellAt(lat, lng, h3.ResStats)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := c.Parent(h3.ResStats); got != parent {
		t.Errorf("res 7 cell %s is not the parent of %s", parent, c)
	}
}

func TestCellAtRejectsOutOfRange(t *testing.T) {
	for _, p := range [][2]float64{{91, 0}, {0, 181}, {-90.5, 10}} {
		if _, err := h3.CellAt(p[0], p[1], h3.ResSearchCache); err == nil {
			t.Errorf("CellAt(%v) succeeded, want error", p)
		}
	}
}
