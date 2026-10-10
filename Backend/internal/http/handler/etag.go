package handler

import (
	"net/http"
	"strconv"
	"strings"

	"gostation/backend/internal/apperr"
)

// Verrouillage optimiste (CLAUDE.md, conventions API) : les lectures renvoient ETag "v{version}",
// les écritures exigent If-Match avec cette valeur. Absent → 428, périmé → 412 (côté service).

func setETag(w http.ResponseWriter, version int32) {
	w.Header().Set("ETag", `"v`+strconv.Itoa(int(version))+`"`)
}

// expectedVersion lit If-Match (comparaison forte, une seule valeur).
func expectedVersion(r *http.Request) (int32, error) {
	h := strings.TrimSpace(r.Header.Get("If-Match"))
	if h == "" {
		return 0, apperr.New(http.StatusPreconditionRequired, apperr.CodePrecondition,
			"The If-Match header with the resource ETag is required.")
	}
	if !strings.HasPrefix(h, `"v`) || !strings.HasSuffix(h, `"`) || len(h) < 4 {
		return 0, apperr.BadRequest(apperr.CodeInvalidParameter, `If-Match must be an ETag such as "v3".`)
	}
	n, err := strconv.ParseInt(h[2:len(h)-1], 10, 32)
	if err != nil || n < 1 {
		return 0, apperr.BadRequest(apperr.CodeInvalidParameter, `If-Match must be an ETag such as "v3".`)
	}
	return int32(n), nil
}
