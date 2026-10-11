// Package h3 encapsule uber/h3-go (cgo) : résolutions utilisées par GoStation et conversions.
// Res 8 (≈ 0,74 km²) sert de clé au cache de recherche, res 7 (≈ 5 km²) aux stats anonymes.
package h3

import (
	"fmt"
	"math"

	uberh3 "github.com/uber/h3-go/v4"
)

// Résolutions H3 de l'application.
const (
	ResSearchCache = 8
	ResStats       = 7
)

// Cell est un index de cellule H3.
type Cell = uberh3.Cell

// CellAt renvoie la cellule contenant (lat, lng) à la résolution res.
func CellAt(lat, lng float64, res int) (Cell, error) {
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		return 0, fmt.Errorf("h3: coordinates out of range (%f, %f)", lat, lng)
	}
	c, err := uberh3.LatLngToCell(uberh3.NewLatLng(lat, lng), res)
	if err != nil {
		return 0, fmt.Errorf("h3: lat/lng to cell: %w", err)
	}
	return c, nil
}

// Center renvoie le centre de la cellule.
func Center(c Cell) (lat, lng float64, err error) {
	ll, err := uberh3.CellToLatLng(c)
	if err != nil {
		return 0, 0, fmt.Errorf("h3: cell to lat/lng: %w", err)
	}
	return ll.Lat, ll.Lng, nil
}

// ToInt64 convertit la cellule pour les colonnes bigint (h3_r8, h3_r7). Un index H3 valide
// tient toujours sur 63 bits.
func ToInt64(c Cell) int64 {
	return int64(c) //nolint:gosec // le bit de poids fort d'un index H3 est toujours 0
}

// Circumradius renvoie la distance maximale (mètres) entre le centre de la cellule et ses sommets :
// tout point de la cellule est à cette distance du centre ou moins. Sert de marge à la recherche
// faite depuis le centre de la cellule (le cache est partagé par cellule).
func Circumradius(c Cell) (float64, error) {
	center, err := uberh3.CellToLatLng(c)
	if err != nil {
		return 0, fmt.Errorf("h3: cell center: %w", err)
	}
	boundary, err := uberh3.CellToBoundary(c)
	if err != nil {
		return 0, fmt.Errorf("h3: cell boundary: %w", err)
	}
	var maxDist float64
	for _, v := range boundary {
		maxDist = math.Max(maxDist, Haversine(center.Lat, center.Lng, v.Lat, v.Lng))
	}
	return maxDist, nil
}

// Haversine calcule la distance orthodromique en mètres (rayon terrestre moyen).
func Haversine(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadius = 6_371_008.8
	rad := math.Pi / 180
	dLat, dLng := (lat2-lat1)*rad, (lng2-lng1)*rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadius * math.Asin(math.Min(1, math.Sqrt(a)))
}
