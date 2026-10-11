package favorite

import (
	"testing"
	"time"
)

func TestQuietHours(t *testing.T) {
	loc, err := time.LoadLocation("Africa/Porto-Novo")
	if err != nil {
		t.Fatal(err)
	}
	for hm, quiet := range map[[2]int]bool{
		{20, 59}: false, {21, 0}: true, {23, 30}: true, {0, 0}: true, {6, 59}: true, {7, 0}: false, {12, 0}: false,
	} {
		at := time.Date(2026, 10, 12, hm[0], hm[1], 0, 0, loc)
		if Quiet(at, loc) != quiet {
			t.Errorf("%02d:%02d: quiet = %v, want %v", hm[0], hm[1], !quiet, quiet)
		}
	}
	// 20:30 UTC = 21:30 à Porto-Novo : l'heure locale compte, pas l'UTC.
	if !Quiet(time.Date(2026, 10, 12, 20, 30, 0, 0, time.UTC), loc) {
		t.Error("quiet hours must use the local time")
	}
}
