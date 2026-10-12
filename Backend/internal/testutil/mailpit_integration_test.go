//go:build integration

package testutil

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/testcontainers/testcontainers-go"
)

// Régression : Mailpit résolvait le nom de chaque client SMTP (DNS inverse) avant d'envoyer sa
// bannière. Avec un résolveur injoignable, la bannière arrivait après 10 s, soit le délai du client
// SMTP de l'application : les emails des tests d'intégration échouaient au hasard selon le réseau.
// Ici le résolveur du conteneur est une adresse non routable (RFC 5737) : la bannière doit
// pourtant arriver tout de suite, à chaque connexion.
func TestMailpitGreetsWithoutReverseDNS(t *testing.T) {
	ctx := context.Background()
	mp, stop, err := StartMailpit(ctx, testcontainers.WithHostConfigModifier(func(hc *container.HostConfig) {
		hc.DNS = []netip.Addr{netip.MustParseAddr("192.0.2.1")}
	}))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(stop)

	addr := net.JoinHostPort(mp.SMTPHost, fmt.Sprint(mp.SMTPPort))
	for i := range 3 {
		start := time.Now()
		conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
		if err != nil {
			t.Fatal(err)
		}
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		line, err := bufio.NewReader(conn).ReadString('\n')
		_ = conn.Close()
		if err != nil {
			t.Fatalf("connection %d: no SMTP greeting after %s: %v", i, time.Since(start).Round(time.Millisecond), err)
		}
		if !strings.HasPrefix(line, "220 ") {
			t.Fatalf("connection %d: greeting = %q, want 220", i, line)
		}
	}
}
