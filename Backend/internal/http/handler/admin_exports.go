package handler

import (
	"net/http"
	"strconv"
	"time"

	"gostation/backend/internal/export"
)

// ── Exports ─────────────────────────────────────────────────────────────────

type exportDTO struct {
	ID          string          `json:"id"`
	Dataset     string          `json:"dataset"`
	Format      string          `json:"format"`
	Params      export.Params   `json:"params"`
	Status      string          `json:"status"` // pending | ready | failed | expired
	Error       *string         `json:"error"`
	RowCount    *int32          `json:"rowCount"`
	SizeBytes   *int64          `json:"sizeBytes"`
	RequestedBy *exportActorDTO `json:"requestedBy"`
	CreatedAt   time.Time       `json:"createdAt"`
	CompletedAt *time.Time      `json:"completedAt"`
	ExpiresAt   *time.Time      `json:"expiresAt"` // suppression du fichier (24 h)
	Download    *downloadDTO    `json:"download"`  // lien signé, si prêt
}

type exportActorDTO struct {
	ID        string `json:"id"`
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
}

type downloadDTO struct {
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expiresAt"` // validité du lien (1 h)
}

func toExport(e export.Export) exportDTO {
	d := exportDTO{
		ID: e.ID.String(), Dataset: string(e.Dataset), Format: string(e.Format), Params: e.Params, Status: string(e.Status),
		Error: e.Error, RowCount: e.RowCount, SizeBytes: e.SizeBytes, CreatedAt: e.CreatedAt,
		CompletedAt: e.CompletedAt, ExpiresAt: e.ExpiresAt,
	}
	if e.RequestedBy != nil {
		d.RequestedBy = &exportActorDTO{ID: e.RequestedBy.String(), FirstName: deref(e.RequestedByFirstName), LastName: deref(e.RequestedByLastName)}
	}
	if e.DownloadPath != "" && e.LinkExpires != nil {
		d.Download = &downloadDTO{URL: e.DownloadPath, ExpiresAt: e.LinkExpires.UTC()}
	}
	return d
}

func exportActor(r *http.Request) export.Actor {
	uid, role := adminActor(r)
	return export.Actor{UserID: uid, Role: role}
}

type exportRequest struct {
	Dataset   string `json:"dataset"`
	Format    string `json:"format"`
	From      string `json:"from"`
	To        string `json:"to"`
	ProductID *int16 `json:"productId"`
}

// CreateExport lance un export (POST /admin/exports) : 202 avec la demande en attente.
func (h *Admin) CreateExport(w http.ResponseWriter, r *http.Request) error {
	var req exportRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	e, err := h.exports.Request(r.Context(), exportActor(r), export.Input{
		Dataset: req.Dataset, Format: req.Format, From: req.From, To: req.To, ProductID: req.ProductID,
	})
	if err != nil {
		return err
	}
	w.Header().Set("Location", "/api/v1/admin/exports/"+e.ID.String())
	h.rs.JSON(w, r, http.StatusAccepted, toExport(e))
	return nil
}

// Exports liste les exports récents (GET /admin/exports?cursor&limit).
func (h *Admin) Exports(w http.ResponseWriter, r *http.Request) error {
	q, err := strictQuery(r, "cursor", "limit")
	if err != nil {
		return err
	}
	limit, err := queryInt(q, "limit")
	if err != nil {
		return err
	}
	page, err := h.exports.List(r.Context(), q.Get("cursor"), limit)
	if err != nil {
		return err
	}
	out := pageResponse[exportDTO]{Items: make([]exportDTO, 0, len(page.Items)), NextCursor: pageCursor(page.NextCursor)}
	for _, e := range page.Items {
		out.Items = append(out.Items, toExport(e))
	}
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, http.StatusOK, out)
	return nil
}

// Export renvoie le statut d'un export et, s'il est prêt, un lien signé valable 1 h
// (GET /admin/exports/{id}).
func (h *Admin) Export(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	e, err := h.exports.Get(r.Context(), id)
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, http.StatusOK, toExport(e))
	return nil
}

// DownloadExport sert le fichier déchiffré d'un export (GET /admin/exports/{id}/download?expires&
// signature) : lien signé valable 1 h et session admin, téléchargement forcé, jamais mis en cache.
func (h *Admin) DownloadExport(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	q, err := strictQuery(r, "expires", "signature")
	if err != nil {
		return err
	}
	f, err := h.exports.Download(r.Context(), exportActor(r), id, q.Get("expires"), q.Get("signature"))
	if err != nil {
		return err
	}
	hd := w.Header()
	hd.Set("Content-Type", f.ContentType)
	hd.Set("Content-Length", strconv.Itoa(len(f.Data)))
	hd.Set("Content-Disposition", `attachment; filename="`+f.Name+`"`)
	hd.Set("Cache-Control", "no-store")
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Content-Security-Policy", "sandbox; default-src 'none'")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(f.Data) //nolint:gosec // G705 : pièce jointe téléchargée (nosniff, CSP sandbox), jamais rendue
	return nil
}
