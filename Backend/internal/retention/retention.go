// Package retention applique les durées de conservation (ARCHITECTURE §8) : tâche quotidienne
// retention:purge du worker (03:00, heure locale).
//
// Chaque règle est indépendante : l'échec de l'une n'empêche pas les suivantes. L'étape 9
// (RGPD/APDP) ajoutera ici ses règles, à la suite de celles de l'étape 6 :
//   - comptes supprimés : purge définitive 30 jours après la demande ;
//   - comptes inactifs : relance à 24 mois, suppression à 36 mois ;
//   - justificatifs : 12 mois après la fin d'activité, 90 jours après un rejet ;
//   - signalements : 12 mois après résolution ; journal d'audit : 12 mois (rôle dédié) ;
//   - historique des stocks : agrégation au-delà de 24 mois ; demandes APDP : 3 ans après clôture.
package retention

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"gostation/backend/internal/store"
)

// Durées de conservation de l'étape 6.
const (
	NotificationsTTL = 30 * 24 * time.Hour // boîte de réception
	AlertsLogTTL     = 30 * 24 * time.Hour // journal des alertes « de retour en stock »
	DevicesTTL       = 90 * 24 * time.Hour // token push sans réenregistrement
)

// Rule est une règle de purge : elle renvoie le nombre de lignes supprimées.
type Rule struct {
	Name string
	Run  func(ctx context.Context, now time.Time) (int64, error)
}

// Purger exécute les règles.
type Purger struct {
	rules []Rule
	log   *slog.Logger
	now   func() time.Time
}

// New construit le purgeur avec les règles en vigueur.
func New(st *store.Store, log *slog.Logger) *Purger {
	return &Purger{log: log, now: time.Now, rules: []Rule{
		{Name: "notifications", Run: func(ctx context.Context, now time.Time) (int64, error) {
			return st.DeleteNotificationsBefore(ctx, now.Add(-NotificationsTTL))
		}},
		{Name: "back_in_stock_alerts", Run: func(ctx context.Context, now time.Time) (int64, error) {
			return st.DeleteBackInStockAlertsBefore(ctx, now.Add(-AlertsLogTTL))
		}},
		{Name: "device_tokens", Run: func(ctx context.Context, now time.Time) (int64, error) {
			return st.DeleteInactiveDevices(ctx, now.Add(-DevicesTTL))
		}},
	}}
}

// Run applique toutes les règles et renvoie les erreurs rencontrées, jointes.
func (p *Purger) Run(ctx context.Context) error {
	now := p.now()
	var errs []error
	for _, r := range p.rules {
		n, err := r.Run(ctx, now)
		if err != nil {
			errs = append(errs, fmt.Errorf("retention: %s: %w", r.Name, err))
			continue
		}
		if n > 0 {
			p.log.InfoContext(ctx, "retention: purged", slog.String("rule", r.Name), slog.Int64("rows", n))
		}
	}
	return errors.Join(errs...)
}
