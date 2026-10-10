package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gostation/backend/internal/apperr"
)

func TestDecodeJSON(t *testing.T) {
	type payload struct {
		Email string `json:"email"`
		Age   int    `json:"age"`
	}
	tests := []struct {
		name, body, ctype string
		allowEmpty        bool
		code              string
		field             string
	}{
		{"valid", `{"email":"a@b.bj","age":3}`, "application/json", false, "", ""},
		{"charset", `{"email":"a@b.bj"}`, "application/json; charset=utf-8", false, "", ""},
		{"empty allowed", ``, "", true, "", ""},
		{"empty refused", ``, "application/json", false, apperr.CodeInvalidJSON, ""},
		{"unknown field", `{"email":"a@b.bj","role":"admin"}`, "application/json", false, apperr.CodeValidation, "role"},
		{"wrong type", `{"age":"three"}`, "application/json", false, apperr.CodeValidation, "age"},
		{"syntax", `{"email":`, "application/json", false, apperr.CodeInvalidJSON, ""},
		{"two objects", `{"email":"a"}{"email":"b"}`, "application/json", false, apperr.CodeInvalidJSON, ""},
		{"wrong content type", `{"email":"a"}`, "text/plain", false, apperr.CodeInvalidJSON, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tt.body))
			if tt.ctype != "" {
				req.Header.Set("Content-Type", tt.ctype)
			}
			var p payload
			err := decodeJSON(req, &p, tt.allowEmpty)
			if tt.code == "" {
				if err != nil {
					t.Fatalf("decodeJSON = %v", err)
				}
				return
			}
			e, ok := apperr.As(err)
			if !ok || e.Code != tt.code {
				t.Fatalf("decodeJSON = %v, want %s", err, tt.code)
			}
			if tt.field != "" && (len(e.Fields) != 1 || e.Fields[0].Field != tt.field) {
				t.Errorf("fields = %+v, want %s", e.Fields, tt.field)
			}
		})
	}
}
