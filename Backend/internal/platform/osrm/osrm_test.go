package osrm_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"gostation/backend/internal/platform/osrm"
)

func TestPing(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		body    string
		delay   time.Duration
		wantErr bool
	}{
		{"dataset loaded", http.StatusOK, `{"code":"Ok","waypoints":[]}`, 0, false},
		{"osrm error code", http.StatusBadRequest, `{"code":"InvalidQuery","message":"bad"}`, 0, true},
		{"not json", http.StatusBadGateway, `<html>bad gateway</html>`, 0, true},
		{"too slow", http.StatusOK, `{"code":"Ok"}`, 200 * time.Millisecond, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/nearest/v1/driving/2.4253,6.3703" || r.URL.Query().Get("number") != "1" {
					t.Errorf("unexpected request %s", r.URL)
				}
				time.Sleep(tt.delay)
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer srv.Close()

			c, err := osrm.New(srv.URL+"/", 50*time.Millisecond)
			if err != nil {
				t.Fatal(err)
			}
			if err := c.Ping(t.Context()); (err != nil) != tt.wantErr {
				t.Errorf("Ping error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestNewRejectsInvalidSettings(t *testing.T) {
	if _, err := osrm.New("not a url", time.Second); err == nil {
		t.Error("expected error for invalid URL")
	}
	if _, err := osrm.New("http://osrm:5000", 0); err == nil {
		t.Error("expected error for zero timeout")
	}
}
