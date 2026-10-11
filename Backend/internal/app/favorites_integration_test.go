//go:build integration

package app_test

import (
	"net/http"
	"slices"
	"testing"
	"time"

	"gostation/backend/internal/auth"
	"gostation/backend/internal/favorite"
)

type favoriteResp struct {
	Station struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"station"`
	Available       bool    `json:"available"`
	AlertProductIDs []int16 `json:"alertProductIds"`
}

func favorites(t *testing.T, c *client) []favoriteResp {
	t.Helper()
	var out struct {
		Items []favoriteResp `json:"items"`
	}
	r := c.do(http.MethodGet, "/api/v1/me/favorites", nil)
	expect(t, r, http.StatusOK, "")
	r.decode(t, &out)
	return out.Items
}

func TestFavorites(t *testing.T) {
	prod := newProduct(t)
	stationID := seedStation(t, prod, seed{name: "Station Favorite", at: offset(bohicon, 9000)}).String()
	pending := seedStation(t, prod, seed{at: offset(bohicon, 9400), status: "pending"}).String()

	u := newClient(t)
	s := registerUser(t, u, uniqueEmail("nonverif"))
	u.bearer = s.AccessToken
	expect(t, u.do(http.MethodPost, "/api/v1/me/favorites/"+stationID, nil), http.StatusForbidden, auth.CodeEmailNotVerified)

	c, _, _ := verifiedUser(t)
	expect(t, c.do(http.MethodPost, "/api/v1/me/favorites/"+stationID, nil), http.StatusCreated, "")
	expect(t, c.do(http.MethodPost, "/api/v1/me/favorites/"+stationID, nil), http.StatusOK, "")
	favs := favorites(t, c)
	if len(favs) != 1 || favs[0].Station.Name != "Station Favorite" || !favs[0].Available || len(favs[0].AlertProductIDs) != 0 {
		t.Fatalf("favorites = %+v", favs)
	}
	// Alertes « de retour en stock » : la liste fournie remplace l'ancienne ; absente, inchangée.
	expect(t, c.do(http.MethodPost, "/api/v1/me/favorites/"+stationID, map[string]any{"alertProductIds": []int16{prod}}), http.StatusOK, "")
	expect(t, c.do(http.MethodPost, "/api/v1/me/favorites/"+stationID, nil), http.StatusOK, "")
	if favs := favorites(t, c); !slices.Equal(favs[0].AlertProductIDs, []int16{prod}) {
		t.Fatalf("alerts = %v, want [%d]", favs[0].AlertProductIDs, prod)
	}
	expect(t, c.do(http.MethodPost, "/api/v1/me/favorites/"+stationID, map[string]any{"alertProductIds": []int16{32000}}),
		http.StatusUnprocessableEntity, "request.validation_failed")
	expect(t, c.do(http.MethodPost, "/api/v1/me/favorites/"+pending, nil), http.StatusNotFound, "resource.not_found")

	// 20 favoris au plus.
	for i := range favorite.MaxFavorites - 1 {
		id := seedStation(t, prod, seed{at: offset(bohicon, float64(10000+i*400))}).String()
		expect(t, c.do(http.MethodPost, "/api/v1/me/favorites/"+id, nil), http.StatusCreated, "")
	}
	extra := seedStation(t, prod, seed{at: offset(bohicon, 19000)}).String()
	expect(t, c.do(http.MethodPost, "/api/v1/me/favorites/"+extra, nil), http.StatusConflict, favorite.CodeLimitReached)

	expect(t, c.do(http.MethodDelete, "/api/v1/me/favorites/"+stationID, nil), http.StatusNoContent, "")
	expect(t, c.do(http.MethodDelete, "/api/v1/me/favorites/"+stationID, nil), http.StatusNoContent, "")
	if n := len(favorites(t, c)); n != favorite.MaxFavorites-1 {
		t.Fatalf("%d favorites after delete, want %d", n, favorite.MaxFavorites-1)
	}
	expect(t, c.do(http.MethodPost, "/api/v1/me/favorites/"+extra, nil), http.StatusCreated, "")
}

func alertStatus(t *testing.T, userID, stationID string, product int16) []string {
	t.Helper()
	rows, err := it.pool.Query(t.Context(), `SELECT status::text FROM back_in_stock_alerts
		WHERE user_id = $1 AND station_id = $2 AND product_id = $3 ORDER BY created_at, id`, userID, stationID, product)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

// setStock met à jour les deux produits de la station et attend la fin des alertes déclenchées.
func setStock(t *testing.T, m *client, stock map[int16]int) {
	t.Helper()
	expect(t, updateStocks(t, m, stock), http.StatusOK, "")
	drainQueues(t)
}

func TestBackInStockAlerts(t *testing.T) {
	ctx := t.Context()
	admin := adminClient(t)
	gas, petrol, other := newProduct(t), newProduct(t), newProduct(t)
	m, stationID := readyStation(t, admin, offset(calavi, 15000), map[int16]int{gas: 0, petrol: 0})
	day := func(d, h, m int) time.Time { return localTime(d+5, h, m) }

	u, us, _ := verifiedUser(t)
	token, _ := registerDevice(t, u, "fr")
	expect(t, u.do(http.MethodPost, "/api/v1/me/favorites/"+stationID, map[string]any{"alertProductIds": []int16{gas}}), http.StatusCreated, "")

	// 0 → 5 : alerte, par la tâche du worker. L'essence (non suivie) ne déclenche rien.
	setClock(t, day(0, 10, 0))
	setStock(t, m, map[int16]int{gas: 5, petrol: 3})
	msgs := it.expo.waitFor(t, token, 1)
	if msgs[0].Data["type"] != "back_in_stock" || msgs[0].Data["productId"] != float64(gas) || msgs[0].Title != "De retour en stock" {
		t.Fatalf("alert push = %+v", msgs[0])
	}
	if got := inbox(t, u).ofType("back_in_stock", stationID); len(got) != 1 {
		t.Fatalf("inbox alerts = %v", got)
	}

	// Pas de nouvelle alerte avant 6 h, même après un nouveau passage de 0 à plus de 0.
	setStock(t, m, map[int16]int{gas: 0, petrol: 3})
	setStock(t, m, map[int16]int{gas: 8, petrol: 3})
	if n := len(it.expo.to(token)); n != 1 {
		t.Fatalf("%d alerts within 6 h, want 1", n)
	}
	setClock(t, day(0, 16, 1))
	setStock(t, m, map[int16]int{gas: 0, petrol: 3})
	setStock(t, m, map[int16]int{gas: 3, petrol: 3})
	it.expo.waitFor(t, token, 2)

	// 5 alertes par jour au plus : 3 autres sont déjà parties aujourd'hui.
	for range 3 {
		if _, err := it.pool.Exec(ctx, `INSERT INTO back_in_stock_alerts (user_id, station_id, product_id, status, created_at, sent_at)
			VALUES ($1, $2, $3, 'sent', $4, $4)`, us.User.ID, stationID, other, day(0, 9, 0)); err != nil {
			t.Fatal(err)
		}
	}
	expect(t, u.do(http.MethodPost, "/api/v1/me/favorites/"+stationID, map[string]any{"alertProductIds": []int16{gas, petrol}}), http.StatusOK, "")
	setClock(t, day(0, 20, 0))
	setStock(t, m, map[int16]int{gas: 3, petrol: 0})
	setStock(t, m, map[int16]int{gas: 3, petrol: 4})
	if n := len(it.expo.to(token)); n != 2 || len(alertStatus(t, us.User.ID, stationID, petrol)) != 0 {
		t.Fatalf("daily cap not applied: %d pushes, petrol alerts %v", n, alertStatus(t, us.User.ID, stationID, petrol))
	}

	// Heures calmes (21 h – 7 h) : l'alerte attend, puis part à 7 h si le stock est positif.
	v, vs, _ := verifiedUser(t)
	tokenV, _ := registerDevice(t, v, "en")
	expect(t, v.do(http.MethodPost, "/api/v1/me/favorites/"+stationID, map[string]any{"alertProductIds": []int16{petrol}}), http.StatusCreated, "")
	setClock(t, day(0, 22, 0))
	setStock(t, m, map[int16]int{gas: 3, petrol: 0})
	setStock(t, m, map[int16]int{gas: 3, petrol: 6})
	if got := alertStatus(t, vs.User.ID, stationID, petrol); !slices.Equal(got, []string{"pending"}) || len(it.expo.to(tokenV)) != 0 {
		t.Fatalf("quiet hours: alerts %v, pushes %d", got, len(it.expo.to(tokenV)))
	}
	setClock(t, day(1, 6, 59))
	if n, err := it.svc.Favorites.ReleasePending(ctx); err != nil || n != 0 {
		t.Fatalf("release at 06:59 = %d, %v; want nothing", n, err)
	}
	setClock(t, day(1, 7, 0))
	if _, err := it.svc.Favorites.ReleasePending(ctx); err != nil {
		t.Fatal(err)
	}
	msg := it.expo.waitFor(t, tokenV, 1)[0]
	if msg.Title != "Back in stock" {
		t.Fatalf("pending alert push = %+v (device language en)", msg)
	}
	if got := alertStatus(t, vs.User.ID, stationID, petrol); !slices.Equal(got, []string{"sent"}) {
		t.Fatalf("released alert status = %v", got)
	}

	// Une alerte en attente est abandonnée si le stock est retombé à 0 avant 7 h.
	setClock(t, day(1, 23, 0))
	setStock(t, m, map[int16]int{gas: 3, petrol: 0})
	setStock(t, m, map[int16]int{gas: 3, petrol: 2})
	setStock(t, m, map[int16]int{gas: 3, petrol: 0})
	setClock(t, day(2, 7, 0))
	drainQueues(t)
	if _, err := it.svc.Favorites.ReleasePending(ctx); err != nil {
		t.Fatal(err)
	}
	drainQueues(t)
	if got := alertStatus(t, vs.User.ID, stationID, petrol); !slices.Equal(got, []string{"sent", "dropped"}) || len(it.expo.to(tokenV)) != 1 {
		t.Fatalf("dropped alert: statuses %v, pushes %d", got, len(it.expo.to(tokenV)))
	}
}
