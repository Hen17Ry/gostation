// Package db embarque les migrations goose, pour les tests d'intégration (et plus tard une
// sous-commande de migration). Le CLI goose lit les mêmes fichiers dans db/migrations.
package db

import "embed"

// Migrations contient db/migrations/*.sql. Variable en lecture seule imposée par go:embed.
//
//go:embed migrations/*.sql
var Migrations embed.FS
