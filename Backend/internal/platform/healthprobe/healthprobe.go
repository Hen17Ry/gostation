// Package healthprobe interroge /readyz en local : healthcheck Docker des images distroless (ni
// shell ni curl), partagé par cmd/api et cmd/worker.
package healthprobe

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"
)

// Run interroge http://127.0.0.1:{port de addr}/readyz et renvoie le code de sortie : 0 si prêt.
func Run(addr string, stderr io.Writer) int {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		fmt.Fprintln(stderr, "healthcheck: invalid address:", err)
		return 1
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:"+port+"/readyz", nil)
	if err != nil {
		fmt.Fprintln(stderr, "healthcheck:", err)
		return 1
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		fmt.Fprintln(stderr, "healthcheck:", err)
		return 1
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(stderr, "healthcheck: /readyz returned", resp.StatusCode)
		return 1
	}
	return 0
}
