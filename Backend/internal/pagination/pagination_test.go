package pagination

import (
	"testing"
	"time"
)

func TestCursorRoundTripAndLimits(t *testing.T) {
	at := time.Date(2026, 10, 11, 9, 30, 0, 123456789, time.FixedZone("WAT", 3600))
	got, id, err := Decode(Encode(at, "42"))
	if err != nil || !got.Equal(at) || id != "42" {
		t.Fatalf("round trip = %s, %q, %v", got, id, err)
	}
	for _, bad := range []string{"%%%", "bm90LWEtY3Vyc29y", Encode(at, "")} {
		if _, _, err := Decode(bad); err == nil {
			t.Errorf("Decode(%q) accepted", bad)
		}
	}
	for in, want := range map[int]int{0: DefaultLimit, 1: 1, 100: 100} {
		if n, err := Limit(in); err != nil || n != want {
			t.Errorf("Limit(%d) = %d, %v", in, n, err)
		}
	}
	for _, bad := range []int{-1, 101} {
		if _, err := Limit(bad); err == nil {
			t.Errorf("Limit(%d) accepted", bad)
		}
	}
}
