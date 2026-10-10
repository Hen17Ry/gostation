package osrm_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestTable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/table/v1/driving/2.400000,6.360000;2.410000,6.370000;2.900000,7.000000" ||
			r.URL.Query().Get("sources") != "0" || r.URL.Query().Get("annotations") != "duration,distance" {
			t.Errorf("unexpected request %s", r.URL)
		}
		_, _ = w.Write([]byte(`{"code":"Ok","durations":[[0,120.5,null]],"distances":[[0,1500.2,null]]}`))
	}))
	defer srv.Close()
	c, _ := osrm.New(srv.URL, time.Second)
	legs, err := c.Table(t.Context(), osrm.Point{Lat: 6.36, Lng: 2.40}, []osrm.Point{{Lat: 6.37, Lng: 2.41}, {Lat: 7, Lng: 2.9}})
	if err != nil {
		t.Fatal(err)
	}
	if len(legs) != 2 || legs[0] == nil || legs[0].DurationS != 120.5 || legs[0].DistanceM != 1500.2 || legs[1] != nil {
		t.Fatalf("legs = %+v", legs)
	}
}

func TestRoute(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("overview") != "full" || q.Get("geometries") != "polyline6" || q.Get("steps") != "true" {
			t.Errorf("unexpected query %s", r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(`{"code":"Ok","routes":[{"distance":6435,"duration":747,"geometry":"abc","legs":[{"steps":[
			{"name":"Rue 12.191","distance":449.7,"duration":40.6,"maneuver":{"type":"end of road","modifier":"right","location":[2.395303,6.365383]}},
			{"name":"","ref":"RNIE 1","distance":0,"duration":0,"maneuver":{"type":"roundabout","exit":2,"location":[2.4,6.37]}}]}]}]}`))
	}))
	defer srv.Close()
	c, _ := osrm.New(srv.URL, time.Second)
	r, err := c.Route(t.Context(), osrm.Point{Lat: 6.36, Lng: 2.39}, osrm.Point{Lat: 6.37, Lng: 2.4})
	if err != nil {
		t.Fatal(err)
	}
	if r.DistanceM != 6435 || r.Geometry != "abc" || len(r.Steps) != 2 {
		t.Fatalf("route = %+v", r)
	}
	if s := r.Steps[0]; s.Type != "end of road" || s.Modifier != "right" || s.Name != "Rue 12.191" || s.Location.Lat != 6.365383 {
		t.Fatalf("step = %+v", s)
	}
	if s := r.Steps[1]; s.Exit != 2 || s.Ref != "RNIE 1" {
		t.Fatalf("roundabout step = %+v", s)
	}
}

func TestNoRoute(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"NoRoute","message":"Impossible route between points"}`))
	}))
	defer srv.Close()
	c, _ := osrm.New(srv.URL, time.Second)
	if _, err := c.Route(t.Context(), osrm.Point{Lat: 6.36, Lng: 2.39}, osrm.Point{Lat: 6.37, Lng: 2.4}); !errors.Is(err, osrm.ErrNoRoute) {
		t.Fatalf("err = %v, want ErrNoRoute", err)
	}
}

// Les erreurs réseau de net/http contiennent l'URL, donc les coordonnées : le client les retire.
func TestErrorsNeverContainCoordinates(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer slow.Close()
	hangUp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		conn, _, _ := w.(http.Hijacker).Hijack()
		_ = conn.Close()
	}))
	defer hangUp.Close()
	closed := httptest.NewServer(http.NotFoundHandler())
	closedURL := closed.URL
	closed.Close()

	user := osrm.Point{Lat: 6.4012345, Lng: 2.3456789}
	for name, base := range map[string]string{"timeout": slow.URL, "hang up": hangUp.URL, "refused": closedURL} {
		t.Run(name, func(t *testing.T) {
			c, _ := osrm.New(base, 100*time.Millisecond)
			_, errTable := c.Table(t.Context(), user, []osrm.Point{{Lat: 6.37, Lng: 2.41}})
			_, errRoute := c.Route(t.Context(), user, osrm.Point{Lat: 6.37, Lng: 2.41})
			for _, err := range []error{errTable, errRoute} {
				if err == nil {
					t.Fatal("expected an error")
				}
				if msg := err.Error(); strings.Contains(msg, "6.401") || strings.Contains(msg, "2.345") || strings.Contains(msg, "http://") {
					t.Errorf("error leaks the request URL: %s", msg)
				}
			}
		})
	}
}
