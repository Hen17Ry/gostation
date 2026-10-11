package catalog

import "testing"

func TestProductCodeAndSize(t *testing.T) {
	size := func(v float64) *float64 { return &v }
	for _, tc := range []struct {
		kind string
		size *float64
		want string
	}{
		{"lpg", size(12.5), "lpg_12_5kg"},
		{"lpg", size(6), "lpg_6kg"},
		{"lpg", size(0.75), "lpg_0_75kg"},
		{"petrol", nil, "petrol"},
		{"diesel", nil, "diesel"},
	} {
		if got := productCode(tc.kind, tc.size); got != tc.want {
			t.Errorf("productCode(%s, %v) = %s, want %s", tc.kind, tc.size, got, tc.want)
		}
	}
	for v, want := range map[float64]bool{12.6: true, 61.6: true, 0.5: true, 12.345: false, 6.001: false} {
		if centesimal(v) != want {
			t.Errorf("centesimal(%v) = %v", v, !want)
		}
	}
}
