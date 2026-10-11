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

func TestCircumradiusCoversTheCell(t *testing.T) {
	c, err := h3.CellAt(6.3703, 2.4253, h3.ResSearchCache)
	if err != nil {
		t.Fatal(err)
	}
	r, err := h3.Circumradius(c)
	if err != nil {
		t.Fatal(err)
	}
	// Res 8 : arête moyenne ≈ 0,53 km ; le rayon circonscrit vaut l'arête à quelques % près.
	if r < 400 || r > 700 {
		t.Fatalf("circumradius = %.0f m", r)
	}
	lat, lng, _ := h3.Center(c)
	// Tout point de la cellule est à moins du rayon de son centre.
	for _, d := range [][2]float64{{0.003, 0}, {-0.003, 0.002}, {0.001, -0.004}} {
		p, _ := h3.CellAt(lat+d[0], lng+d[1], h3.ResSearchCache)
		if p == c && h3.Haversine(lat, lng, lat+d[0], lng+d[1]) > r {
			t.Errorf("point %v inside the cell but beyond the circumradius", d)
		}
	}
	if d := h3.Haversine(6.3703, 2.4253, 9.3370, 2.6303); d < 329_000 || d > 331_000 {
		t.Errorf("Cotonou–Parakou = %.0f m", d)
	}
}

func TestBoundaryIsClosedGeoJSONRing(t *testing.T) {
	c, err := h3.CellAt(6.3703, 2.3912, h3.ResStats) // Cotonou
	if err != nil {
		t.Fatal(err)
	}
	ring, err := h3.Boundary(c)
	if err != nil {
		t.Fatal(err)
	}
	if len(ring) != 7 || ring[0] != ring[6] {
		t.Fatalf("ring = %v, want 6 vertices and a closing point", ring)
	}
	for _, p := range ring {
		if p[0] < 2.3 || p[0] > 2.5 || p[1] < 6.3 || p[1] > 6.45 { // [lng, lat]
			t.Fatalf("vertex %v is not [lng, lat] around Cotonou", p)
		}
	}
	if !h3.Valid(h3.FromInt64(h3.ToInt64(c)), h3.ResStats) || h3.Valid(c, h3.ResSearchCache) || h3.Valid(h3.FromInt64(42), h3.ResStats) {
		t.Error("Valid does not check the index and its resolution")
	}
}
