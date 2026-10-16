package notification

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/google/uuid"

	"gostation/backend/internal/jobs"
	"gostation/backend/internal/push"
	"gostation/backend/internal/store/dbgen"
)

// tokenHash est l'empreinte d'un token push transmise aux tâches (jamais le token lui-même
// dans les journaux ; seule l'empreinte voyage avec les reçus).
func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// unit regroupe les messages d'une notification : un lot Expo ne coupe jamais une notification,
// pour qu'un retry ne renvoie pas un push déjà accepté.
type unit struct {
	id      uuid.UUID
	msgs    []push.Message
	devices []dbgen.ListDevicesForUsersRow
}

// Deliver envoie les push des notifications (tâche push:send). Les appareils dont la session
// n'existe plus sont supprimés ; les notifications sont marquées « remises » lot par lot (un
// retry ne renvoie que ce qui n'est pas parti) ; les reçus sont lus plus tard (push:receipts).
func (s *Service) Deliver(ctx context.Context, ids []uuid.UUID) error {
	rows, err := s.Store.ListNotificationsToPush(ctx, ids)
	if err != nil {
		return fmt.Errorf("notification: load notifications: %w", err)
	}
	if len(rows) == 0 {
		return nil
	}
	userIDs := make([]uuid.UUID, 0, len(rows))
	seenUser := map[uuid.UUID]bool{}
	for _, r := range rows {
		if !seenUser[r.UserID] {
			seenUser[r.UserID] = true
			userIDs = append(userIDs, r.UserID)
		}
	}
	devices, err := s.Store.ListDevicesForUsers(ctx, userIDs)
	if err != nil {
		return fmt.Errorf("notification: load devices: %w", err)
	}
	byUser, err := s.liveDevices(ctx, devices)
	if err != nil {
		return err
	}

	var units []unit
	var silent []uuid.UUID // aucun appareil : rien à envoyer, la boîte de réception suffit
	for _, r := range rows {
		devs := byUser[r.UserID]
		if len(devs) == 0 {
			silent = append(silent, r.ID)
			continue
		}
		var data map[string]any
		if err := json.Unmarshal(r.Data, &data); err != nil {
			return fmt.Errorf("notification: decode data: %w", err)
		}
		u := unit{id: r.ID, devices: devs}
		for _, d := range devs {
			u.msgs = append(u.msgs, buildMessage(d.Token, d.Language, d.Platform, Type(r.Type), r.ID, data))
		}
		units = append(units, u)
	}
	if len(silent) > 0 {
		if err := s.Store.MarkNotificationsPushed(ctx, silent); err != nil {
			return fmt.Errorf("notification: mark pushed: %w", err)
		}
	}

	var refs []jobs.TicketRef
	var gone []dbgen.ListDevicesForUsersRow
	defer func() { s.afterSend(context.WithoutCancel(ctx), refs, gone) }()
	for start := 0; start < len(units); {
		end, n := start, 0
		for end < len(units) && (n == 0 || n+len(units[end].msgs) <= push.BatchSize) {
			n += len(units[end].msgs)
			end++
		}
		batch := units[start:end]
		var msgs []push.Message
		var devs []dbgen.ListDevicesForUsersRow
		for _, u := range batch {
			msgs = append(msgs, u.msgs...)
			devs = append(devs, u.devices...)
		}
		tickets, sendErr := s.Pusher.Send(ctx, msgs)
		for i, t := range tickets {
			switch {
			case t.Error == push.ErrDeviceNotRegistered:
				gone = append(gone, devs[i])
			case t.Error != "":
				s.Log.WarnContext(ctx, "notification: push rejected", slog.String("expo_error", t.Error))
			case t.ID != "":
				refs = append(refs, jobs.TicketRef{ID: t.ID, DeviceID: devs[i].ID, TokenHash: tokenHash(devs[i].Token)})
			}
		}
		// Notifications entièrement couvertes par les tickets reçus : remises.
		var done []uuid.UUID
		covered := 0
		for _, u := range batch {
			covered += len(u.msgs)
			if covered > len(tickets) {
				break
			}
			done = append(done, u.id)
		}
		if len(done) > 0 {
			if err := s.Store.MarkNotificationsPushed(ctx, done); err != nil {
				return fmt.Errorf("notification: mark pushed: %w", err)
			}
		}
		if sendErr != nil {
			return fmt.Errorf("notification: send push: %w", sendErr)
		}
		start = end
	}
	return nil
}

// liveDevices écarte (et supprime) les appareils dont la session a expiré ou été révoquée sans
// que le crochet de révocation ait pu les supprimer.
func (s *Service) liveDevices(ctx context.Context, devices []dbgen.ListDevicesForUsersRow) (map[uuid.UUID][]dbgen.ListDevicesForUsersRow, error) {
	sids := make([]string, 0, len(devices))
	for _, d := range devices {
		sids = append(sids, d.SessionID)
	}
	alive, err := s.Sessions.Alive(ctx, sids)
	if err != nil {
		return nil, fmt.Errorf("notification: check sessions: %w", err)
	}
	out := map[uuid.UUID][]dbgen.ListDevicesForUsersRow{}
	var dead []uuid.UUID
	for _, d := range devices {
		if !alive[d.SessionID] {
			dead = append(dead, d.ID)
			continue
		}
		out[d.UserID] = append(out[d.UserID], d)
	}
	if len(dead) > 0 {
		if _, err := s.Store.DeleteDevicesByID(ctx, dead); err != nil {
			return nil, fmt.Errorf("notification: delete devices of dead sessions: %w", err)
		}
		s.Log.InfoContext(ctx, "notification: devices of expired sessions removed", slog.Int("devices", len(dead)))
	}
	return out, nil
}

// afterSend programme la lecture des reçus et supprime les tokens refusés par Expo.
func (s *Service) afterSend(ctx context.Context, refs []jobs.TicketRef, gone []dbgen.ListDevicesForUsersRow) {
	if err := s.Queue.EnqueueReceipts(ctx, refs); err != nil {
		s.Log.ErrorContext(ctx, "notification: push receipts not scheduled", slog.Int("tickets", len(refs)), slog.Any("err", err))
	}
	for _, d := range gone {
		s.removeDevice(ctx, d.ID, tokenHash(d.Token))
	}
}

func (s *Service) removeDevice(ctx context.Context, id uuid.UUID, hash string) {
	if _, err := s.Store.DeleteDeviceIfToken(ctx, dbgen.DeleteDeviceIfTokenParams{ID: id, TokenHash: hash}); err != nil {
		s.Log.ErrorContext(ctx, "notification: unregistered device not deleted", slog.Any("err", err))
		return
	}
	s.Log.InfoContext(ctx, "notification: device no longer registered, removed")
}

// CheckReceipts lit les reçus Expo (tâche push:receipts, 15 min après l'envoi) et supprime les
// appareils DeviceNotRegistered. Un reçu pas encore disponible est ignoré.
func (s *Service) CheckReceipts(ctx context.Context, tickets []jobs.TicketRef) error {
	if len(tickets) == 0 {
		return nil
	}
	ids := make([]string, len(tickets))
	for i, t := range tickets {
		ids[i] = t.ID
	}
	receipts, err := s.Pusher.Receipts(ctx, ids)
	if err != nil {
		return fmt.Errorf("notification: read receipts: %w", err)
	}
	failed, missing := 0, 0
	for _, t := range tickets {
		r, ok := receipts[t.ID]
		switch {
		case !ok:
			missing++
		case r.OK:
		case r.Error == push.ErrDeviceNotRegistered:
			failed++
			s.removeDevice(ctx, t.DeviceID, t.TokenHash)
		default:
			failed++
			s.Log.WarnContext(ctx, "notification: push not delivered", slog.String("expo_error", r.Error))
		}
	}
	s.Log.DebugContext(ctx, "notification: receipts checked",
		slog.Int("tickets", len(tickets)), slog.Int("failed", failed), slog.Int("missing", missing))
	return nil
}
