package handler

import (
	"net/http"
	"time"

	"gostation/backend/internal/analytics"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/platform/h3"
)

// ── DTO communs ─────────────────────────────────────────────────────────────

type periodDTO struct {
	Key          string    `json:"key"`
	From         time.Time `json:"from"`
	To           time.Time `json:"to"`
	PreviousFrom time.Time `json:"previousFrom"`
	PreviousTo   time.Time `json:"previousTo"`
	Granularity  string    `json:"granularity"`
	Timezone     string    `json:"timezone"`
}

func (h *Admin) period(p analytics.Period) periodDTO {
	return periodDTO{
		Key: p.Key, From: p.From.UTC(), To: p.To.UTC(), PreviousFrom: p.PrevFrom.UTC(), PreviousTo: p.PrevTo.UTC(),
		Granularity: p.Granularity, Timezone: h.loc.String(),
	}
}

type kpiDTO struct {
	Value    float64  `json:"value"`
	Previous float64  `json:"previous"`
	Change   *float64 `json:"change"` // évolution relative ; null si la période précédente vaut 0
}

func kpi(k analytics.KPI) kpiDTO {
	return kpiDTO{Value: k.Value, Previous: k.Previous, Change: k.Change()}
}

type productRefCodeDTO struct {
	ID    int16  `json:"id"`
	Code  string `json:"code"`
	Label string `json:"label"`
}

type seriesPointDTO struct {
	At            time.Time        `json:"at"`
	Searches      int64            `json:"searches"`
	EmptySearches int64            `json:"emptySearches"`
	ByProduct     map[string]int64 `json:"byProduct"` // code produit → recherches
}

func seriesDTO(points []analytics.SeriesPoint, products map[int16]analytics.ProductInfo) []seriesPointDTO {
	out := make([]seriesPointDTO, 0, len(points))
	for _, p := range points {
		d := seriesPointDTO{At: p.At.UTC(), Searches: p.Searches, EmptySearches: p.Empty, ByProduct: map[string]int64{}}
		for id, n := range p.ByProduct {
			if info, ok := products[id]; ok {
				d.ByProduct[info.Code] = n
			}
		}
		out = append(out, d)
	}
	return out
}

type latLngPoint struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type zoneDTO struct {
	Cell          string      `json:"cell"` // index H3 res 7 hexadécimal
	Center        latLngPoint `json:"center"`
	Searches      int64       `json:"searches"`
	EmptySearches int64       `json:"emptySearches"`
	EmptyRate     float64     `json:"emptyRate"`
}

func zone(c analytics.Cell) zoneDTO {
	lat, lng, _ := h3.Center(c.Cell)
	return zoneDTO{Cell: c.Cell.String(), Center: latLngPoint{Lat: lat, Lng: lng}, Searches: c.Searches, EmptySearches: c.Empty, EmptyRate: c.Rate}
}

// ── Tableau de bord ─────────────────────────────────────────────────────────

type pendingDTO struct {
	Count       int        `json:"count"`
	OldestSince *time.Time `json:"oldestSince"`
	OldestAgeS  *int64     `json:"oldestAgeS"`
}

type freshnessDTO struct {
	Fresh        int     `json:"fresh"`
	Stale        int     `json:"stale"`
	Expired      int     `json:"expired"`
	Total        int     `json:"total"`
	FreshShare   float64 `json:"freshShare"`
	StaleShare   float64 `json:"staleShare"`
	ExpiredShare float64 `json:"expiredShare"`
}

func freshness(f analytics.Freshness) freshnessDTO {
	d := freshnessDTO{Fresh: f.Fresh, Stale: f.Stale, Expired: f.Expired, Total: f.Total()}
	if t := float64(d.Total); t > 0 {
		d.FreshShare, d.StaleShare, d.ExpiredShare = float64(f.Fresh)/t, float64(f.Stale)/t, float64(f.Expired)/t
	}
	return d
}

type productSearchesDTO struct {
	Product productRefCodeDTO `json:"product"`
	kpiDTO
}

type freshnessPointDTO struct {
	At      time.Time `json:"at"`
	Fresh   *int      `json:"fresh"` // null : aucun relevé dans la tranche
	Stale   *int      `json:"stale"`
	Expired *int      `json:"expired"`
}

type dashboardDTO struct {
	Period   periodDTO `json:"period"`
	Stations struct {
		ByStatus            map[string]int `json:"byStatus"`
		PendingApplications pendingDTO     `json:"pendingApplications"`
	} `json:"stations"`
	StockFreshness   freshnessDTO `json:"stockFreshness"`
	InactiveManagers int          `json:"inactiveManagers"`
	Searches         struct {
		Total     kpiDTO               `json:"total"`
		ByProduct []productSearchesDTO `json:"byProduct"`
		EmptyRate kpiDTO               `json:"emptyRate"`
	} `json:"searches"`
	Shortages struct {
		Zones     int       `json:"zones"`
		Top       []zoneDTO `json:"top"`
		K         int       `json:"k"`
		Threshold float64   `json:"threshold"`
	} `json:"shortages"`
	Reports struct {
		Open    int    `json:"open"`
		Created kpiDTO `json:"created"`
	} `json:"reports"`
	Alerts struct {
		Open   int            `json:"open"`
		ByKind map[string]int `json:"byKind"`
	} `json:"alerts"`
	Registrations struct {
		Users    kpiDTO `json:"users"`
		Managers kpiDTO `json:"managers"`
	} `json:"registrations"`
	Series struct {
		Searches  []seriesPointDTO    `json:"searches"`
		Freshness []freshnessPointDTO `json:"freshness"`
	} `json:"series"`
}

type countersDTO struct {
	PendingStations int                    `json:"pendingStations"`
	OpenReports     int                    `json:"openReports"`
	OpenAlerts      int                    `json:"openAlerts"`
	LocationReviews int                    `json:"locationReviews"`
	DataRequests    dataRequestCountersDTO `json:"dataRequests"`
}

// dataRequestCountersDTO : demandes d'exercice des droits ouvertes, à échéance proche, échues.
type dataRequestCountersDTO struct {
	Open    int `json:"open"`
	DueSoon int `json:"dueSoon"`
	Overdue int `json:"overdue"`
}

// Counters renvoie les compteurs des badges de la barre latérale (GET /admin/counters).
func (h *Admin) Counters(w http.ResponseWriter, r *http.Request) error {
	if _, err := strictQuery(r); err != nil {
		return err
	}
	c, err := h.analytics.Counters(r.Context())
	if err != nil {
		return err
	}
	d, err := h.privacy.Counters(r.Context())
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, http.StatusOK, countersDTO{
		PendingStations: c.PendingStations, OpenReports: c.OpenReports, OpenAlerts: c.OpenAlerts, LocationReviews: c.LocationReviews,
		DataRequests: dataRequestCountersDTO{Open: d.Open, DueSoon: d.DueSoon, Overdue: d.Overdue},
	})
	return nil
}

// Dashboard renvoie les indicateurs du tableau de bord (GET /admin/dashboard?period&from&to).
func (h *Admin) Dashboard(w http.ResponseWriter, r *http.Request) error {
	q, err := strictQuery(r, "period", "from", "to")
	if err != nil {
		return err
	}
	p, err := h.analytics.Period(q.Get("period"), q.Get("from"), q.Get("to"))
	if err != nil {
		return err
	}
	d, err := h.analytics.Dashboard(r.Context(), p)
	if err != nil {
		return err
	}
	var out dashboardDTO
	out.Period = h.period(p)
	out.Stations.ByStatus = d.StationsByStatus
	out.Stations.PendingApplications = pendingDTO{Count: d.PendingCount}
	if d.OldestPendingAt != nil {
		at := d.OldestPendingAt.UTC()
		age := int64(time.Since(at).Seconds())
		out.Stations.PendingApplications.OldestSince, out.Stations.PendingApplications.OldestAgeS = &at, &age
	}
	out.StockFreshness = freshness(d.Freshness)
	out.InactiveManagers = d.InactiveManagers()
	out.Searches.Total, out.Searches.EmptyRate = kpi(d.Searches), kpi(d.EmptyRate)
	out.Searches.ByProduct = make([]productSearchesDTO, 0, len(d.SearchesByProduct))
	for _, ps := range d.SearchesByProduct {
		out.Searches.ByProduct = append(out.Searches.ByProduct, productSearchesDTO{
			Product: productRefCodeDTO{ID: ps.Product.ID, Code: ps.Product.Code, Label: ps.Product.Label}, kpiDTO: kpi(ps.KPI),
		})
	}
	out.Shortages.Zones, out.Shortages.K, out.Shortages.Threshold = d.ShortageZones, analytics.K, analytics.ShortageRate
	out.Shortages.Top = make([]zoneDTO, 0, len(d.TopShortages))
	for _, c := range d.TopShortages {
		out.Shortages.Top = append(out.Shortages.Top, zone(c))
	}
	out.Reports.Open, out.Reports.Created = d.OpenReports, kpi(d.ReportsCreated)
	out.Alerts.ByKind = d.OpenAlerts
	for _, n := range d.OpenAlerts {
		out.Alerts.Open += n
	}
	out.Registrations.Users, out.Registrations.Managers = kpi(d.UserSignups), kpi(d.ManagerSignups)
	out.Series.Searches = seriesDTO(d.SearchSeries, d.Products)
	out.Series.Freshness = make([]freshnessPointDTO, 0, len(d.FreshnessSeries))
	for _, f := range d.FreshnessSeries {
		pt := freshnessPointDTO{At: f.At.UTC()}
		if f.Measured {
			fresh, stale, expired := f.Fresh, f.Stale, f.Expired
			pt.Fresh, pt.Stale, pt.Expired = &fresh, &stale, &expired
		}
		out.Series.Freshness = append(out.Series.Freshness, pt)
	}
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, http.StatusOK, out)
	return nil
}

// ── Stats des recherches ────────────────────────────────────────────────────

type hourDTO struct {
	Hour          int   `json:"hour"`
	Searches      int64 `json:"searches"`
	EmptySearches int64 `json:"emptySearches"`
}

type searchStatsDTO struct {
	Period    periodDTO `json:"period"`
	ProductID *int16    `json:"productId"`
	Totals    struct {
		Searches  kpiDTO `json:"searches"`
		EmptyRate kpiDTO `json:"emptyRate"`
	} `json:"totals"`
	Series      []seriesPointDTO `json:"series"`
	ByHourOfDay []hourDTO        `json:"byHourOfDay"`
}

// SearchStats renvoie les séries des recherches et leur répartition par heure de la journée, tous
// lieux confondus (GET /admin/stats/searches?period&from&to&productId).
func (h *Admin) SearchStats(w http.ResponseWriter, r *http.Request) error {
	q, err := strictQuery(r, "period", "from", "to", "productId")
	if err != nil {
		return err
	}
	product, err := queryProduct(q)
	if err != nil {
		return err
	}
	p, err := h.analytics.Period(q.Get("period"), q.Get("from"), q.Get("to"))
	if err != nil {
		return err
	}
	st, err := h.analytics.SearchStats(r.Context(), p, product)
	if err != nil {
		return err
	}
	out := searchStatsDTO{Period: h.period(p), ProductID: product, Series: seriesDTO(st.Series, st.Products)}
	out.Totals.Searches, out.Totals.EmptyRate = kpi(st.Total), kpi(st.EmptyRate)
	out.ByHourOfDay = make([]hourDTO, 0, len(st.ByHour))
	for _, hp := range st.ByHour {
		out.ByHourOfDay = append(out.ByHourOfDay, hourDTO{Hour: hp.Hour, Searches: hp.Searches, EmptySearches: hp.Empty})
	}
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, http.StatusOK, out)
	return nil
}

// ── Carte des pénuries (GeoJSON) ────────────────────────────────────────────

type polygonDTO struct {
	Type        string         `json:"type"`
	Coordinates [][][2]float64 `json:"coordinates"`
}

type cellFeatureDTO struct {
	Type       string     `json:"type"`
	ID         string     `json:"id"`
	Geometry   polygonDTO `json:"geometry"`
	Properties struct {
		Cell          string  `json:"cell"`
		Searches      int64   `json:"searches"`
		EmptySearches int64   `json:"emptySearches"`
		EmptyRate     float64 `json:"emptyRate"`
		Shortage      bool    `json:"shortage"`
	} `json:"properties"`
}

type shortagesDTO struct {
	Type        string           `json:"type"`
	Period      periodDTO        `json:"period"`
	ProductID   *int16           `json:"productId"`
	K           int              `json:"k"`
	Threshold   float64          `json:"threshold"`
	MaskedCells int              `json:"maskedCells"`
	Features    []cellFeatureDTO `json:"features"`
}

// Shortages renvoie les cellules H3 res 7 de la période en GeoJSON, avec leur taux de recherches
// sans station ouverte à 5 km ; les cellules de moins de 5 recherches sont masquées
// (GET /admin/stats/shortages?period&from&to&productId&onlyShortages).
func (h *Admin) Shortages(w http.ResponseWriter, r *http.Request) error {
	q, err := strictQuery(r, "period", "from", "to", "productId", "onlyShortages")
	if err != nil {
		return err
	}
	product, err := queryProduct(q)
	if err != nil {
		return err
	}
	only, err := queryBool(q, "onlyShortages")
	if err != nil {
		return err
	}
	p, err := h.analytics.Period(q.Get("period"), q.Get("from"), q.Get("to"))
	if err != nil {
		return err
	}
	m, err := h.analytics.ShortageMap(r.Context(), p, product, only != nil && *only)
	if err != nil {
		return err
	}
	out := shortagesDTO{
		Type: "FeatureCollection", Period: h.period(p), ProductID: product, K: analytics.K,
		Threshold: analytics.ShortageRate, MaskedCells: m.MaskedCells, Features: make([]cellFeatureDTO, 0, len(m.Cells)),
	}
	for _, c := range m.Cells {
		ring, err := h3.Boundary(c.Cell)
		if err != nil {
			return err
		}
		f := cellFeatureDTO{Type: "Feature", ID: c.Cell.String(), Geometry: polygonDTO{Type: "Polygon", Coordinates: [][][2]float64{ring}}}
		f.Properties.Cell, f.Properties.Searches, f.Properties.EmptySearches = c.Cell.String(), c.Searches, c.Empty
		f.Properties.EmptyRate, f.Properties.Shortage = c.Rate, c.Shortage
		out.Features = append(out.Features, f)
	}
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSONType(w, r, http.StatusOK, respond.ContentTypeGeoJSON, out)
	return nil
}
