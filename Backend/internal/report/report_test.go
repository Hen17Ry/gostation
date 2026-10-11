package report

import (
	"math"
	"strings"
	"testing"

	"gostation/backend/internal/apperr"
)

func fieldCodes(err error) map[string]string {
	out := map[string]string{}
	if e, ok := apperr.As(err); ok {
		for _, f := range e.Fields {
			out[f.Field] = f.Code
		}
	}
	return out
}

func TestValidate(t *testing.T) {
	product := int16(3)
	near := &Position{Lat: 6.37, Lng: 2.42}
	long := strings.Repeat("é", MaxCommentRunes+1)
	blank := "   "
	cases := []struct {
		name string
		in   Input
		want map[string]string // champ → code ; vide = valide
	}{
		{"out of stock", Input{Reason: ReasonOutOfStock, ProductID: &product, Position: near}, nil},
		{"out of stock without product", Input{Reason: ReasonOutOfStock, Position: near}, map[string]string{"productId": "required"}},
		{"out of stock without position", Input{Reason: ReasonOutOfStock, ProductID: &product}, map[string]string{"position": "required"}},
		{"closed with invalid position", Input{Reason: ReasonStationClosed, Position: &Position{Lat: math.NaN(), Lng: 2}}, map[string]string{"position": "out_of_range"}},
		{"wrong location with a product", Input{Reason: ReasonWrongLocation, ProductID: &product}, map[string]string{"productId": "not_allowed"}},
		{"wrong location without position", Input{Reason: ReasonWrongLocation}, nil},
		{"other without comment", Input{Reason: ReasonOther, Comment: &blank}, map[string]string{"comment": "required"}},
		{"comment too long", Input{Reason: ReasonOther, Comment: &long}, map[string]string{"comment": "too_long"}},
		{"unknown reason", Input{Reason: "stock_incorrect"}, map[string]string{"reason": "invalid"}},
	}
	for _, c := range cases {
		err := validate(&c.in)
		got := fieldCodes(err)
		if len(c.want) == 0 {
			if err != nil {
				t.Errorf("%s: unexpected error %v", c.name, err)
			}
			continue
		}
		for field, code := range c.want {
			if got[field] != code {
				t.Errorf("%s: field %s = %q, want %q (all: %v)", c.name, field, got[field], code, got)
			}
		}
	}
	trimmed := "  Pompe 3 en panne  "
	in := Input{Reason: ReasonOther, Comment: &trimmed}
	if err := validate(&in); err != nil || *in.Comment != "Pompe 3 en panne" {
		t.Fatalf("comment not trimmed: %q, %v", *in.Comment, err)
	}
}
