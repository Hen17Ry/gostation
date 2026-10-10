package station

import (
	"context"
	"fmt"
	"math"
	"net/http"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/platform/h3"
	"gostation/backend/internal/store/dbgen"
)

// Règles de position (D13).
const (
	// FreeMoveMeters : en deçà, un déplacement est une correction GPS appliquée directement.
	FreeMoveMeters = 200
	// DeviceFlagMeters : au-delà, une épingle éloignée de l'appareil du gérant est signalée à l'admin.
	DeviceFlagMeters = 500
)

// Issues d'un épinglage.
const (
	OutcomeSet           = "set"            // premier épinglage
	OutcomeCorrected     = "corrected"      // déplacement de moins de 200 m, appliqué
	OutcomeMoveRequested = "move_requested" // déplacement de 200 m ou plus, en attente de validation
)

// DevicePosition est la position GPS de l'appareil du gérant au moment de l'épinglage. Elle sert
// uniquement au contrôle de vraisemblance : seule la distance calculée est conservée.
type DevicePosition struct {
	Lat       float64
	Lng       float64
	AccuracyM float64
}

// LocationInput est un épinglage.
type LocationInput struct {
	Lat     float64
	Lng     float64
	Confirm bool // l'avertissement « épinglez la station, pas votre position » a été acquitté
	Device  *DevicePosition
}

// LocationResult est le résultat d'un épinglage.
type LocationResult struct {
	Station ManagerStation
	Outcome string
	Flagged bool
}

// distanceMeters calcule la distance orthodromique (haversine, rayon terrestre moyen). L'écart
// avec la géodésique (< 0,5 %) est sans effet sur le seuil de 500 m.
func distanceMeters(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadius = 6_371_008.8
	rad := math.Pi / 180
	dLat, dLng := (lat2-lat1)*rad, (lng2-lng1)*rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadius * math.Asin(math.Min(1, math.Sqrt(a)))
}

func validateLocation(in LocationInput) error {
	var f fieldErrors
	if !in.Confirm {
		f.add("confirmStationLocation", "required", "the manager must confirm the pin is on the station, not on their own position")
	}
	if in.Lat < -90 || in.Lat > 90 || math.IsNaN(in.Lat) {
		f.add("lat", "out_of_range", "must be between -90 and 90")
	}
	if in.Lng < -180 || in.Lng > 180 || math.IsNaN(in.Lng) {
		f.add("lng", "out_of_range", "must be between -180 and 180")
	}
	if d := in.Device; d != nil {
		if d.Lat < -90 || d.Lat > 90 || d.Lng < -180 || d.Lng > 180 {
			f.add("device", "out_of_range", "device coordinates are out of range")
		}
		if d.AccuracyM < 0 || d.AccuracyM > 10_000 {
			f.add("device.accuracyM", "out_of_range", "must be between 0 and 10000 meters")
		}
	}
	return f.err()
}

// SetLocation épingle la station (D13) : refus hors du Bénin (marge de 2 km) ; premier épinglage
// libre ; ensuite correction libre sous 200 m, demande de déplacement au-delà (l'ancienne position
// reste active). Une épingle à plus de 500 m de l'appareil est signalée à l'admin, sans blocage.
func (s *Service) SetLocation(ctx context.Context, a Actor, expected int32, in LocationInput) (LocationResult, error) {
	if err := validateLocation(in); err != nil {
		return LocationResult{}, err
	}
	cell, err := h3.CellAt(in.Lat, in.Lng, h3.ResSearchCache)
	if err != nil {
		return LocationResult{}, apperr.Validation(apperr.FieldError{Field: "lat", Code: "invalid", Message: "invalid coordinates"})
	}
	var deviceDist, deviceAcc *int32
	if d := in.Device; d != nil {
		dist := int32(math.Round(distanceMeters(in.Lat, in.Lng, d.Lat, d.Lng)))
		acc := int32(math.Round(d.AccuracyM))
		deviceDist, deviceAcc = &dist, &acc
	}
	flagged := deviceDist != nil && *deviceDist > DeviceFlagMeters

	var stationID uuid.UUID
	var outcome string
	var moveM float64
	err = s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		st, err := s.managerStation(ctx, q, a.UserID)
		if err != nil {
			return err
		}
		stationID = st.ID
		if _, err := bump(ctx, q, st.ID, expected); err != nil {
			return err
		}
		check, err := q.CheckStationPin(ctx, dbgen.CheckStationPinParams{StationID: st.ID, Lat: in.Lat, Lng: in.Lng})
		if err != nil {
			return fmt.Errorf("station: check pin: %w", err)
		}
		if !check.InsideBenin {
			return apperr.New(http.StatusUnprocessableEntity, CodeOutsideCountry, "The station must be located in Benin.")
		}
		moveM = check.MoveM
		if moveM >= 0 && moveM >= FreeMoveMeters {
			outcome = OutcomeMoveRequested
			if err := q.SupersedeLocationRequests(ctx, st.ID); err != nil {
				return fmt.Errorf("station: supersede move requests: %w", err)
			}
			_, err := q.CreateLocationRequest(ctx, dbgen.CreateLocationRequestParams{
				StationID: st.ID, RequestedBy: &a.UserID, Lat: in.Lat, Lng: in.Lng, H3R8: h3.ToInt64(cell),
				DistanceM: int32(math.Round(moveM)), DeviceDistanceM: deviceDist, DeviceAccuracyM: deviceAcc,
			})
			if err != nil {
				return fmt.Errorf("station: create move request: %w", err)
			}
			return nil
		}
		outcome = OutcomeSet
		if moveM >= 0 {
			outcome = OutcomeCorrected
		}
		if err := q.SetStationLocation(ctx, dbgen.SetStationLocationParams{ID: st.ID, Lat: in.Lat, Lng: in.Lng, H3R8: ptr(h3.ToInt64(cell))}); err != nil {
			return fmt.Errorf("station: set location: %w", err)
		}
		if flagged {
			if err := q.FlagStationLocation(ctx, dbgen.FlagStationLocationParams{ID: st.ID, DistanceM: deviceDist, AccuracyM: deviceAcc}); err != nil {
				return fmt.Errorf("station: flag location: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return LocationResult{}, err
	}

	meta := map[string]any{"outcome": outcome, "flagged": flagged}
	if moveM >= 0 {
		meta["moveMeters"] = int(math.Round(moveM))
	}
	if deviceDist != nil {
		meta["deviceDistanceMeters"] = *deviceDist
	}
	action := audit.ActionLocationSet
	if outcome == OutcomeMoveRequested {
		action = audit.ActionLocationMoveRequested
	} else {
		s.invalidate(ctx, true)
	}
	s.audit(ctx, a, action, stationID, meta)
	st, err := s.ForManager(ctx, a.UserID)
	return LocationResult{Station: st, Outcome: outcome, Flagged: flagged && outcome != OutcomeMoveRequested}, err
}

func ptr[T any](v T) *T { return &v }
