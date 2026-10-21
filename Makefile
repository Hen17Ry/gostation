# GoStation — commandes de développement. `make` ou `make help` pour la liste.
SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

COMPOSE := docker compose
s ?=

# ── Outils Go (versions figées, installées par `make tools`) ──────────────────
BACKEND := Backend
MIGRATIONS := $(BACKEND)/db/migrations
GOBIN_DIR := $(shell go env GOBIN 2> /dev/null)
ifeq ($(GOBIN_DIR),)
GOBIN_DIR := $(shell go env GOPATH 2> /dev/null)/bin
endif
GOOSE_VERSION := v3.28.0
SQLC_VERSION := v1.31.1
GOLANGCI_VERSION := v2.14.0
GOOSE := $(GOBIN_DIR)/goose
SQLC := $(GOBIN_DIR)/sqlc
GOLANGCI := $(GOBIN_DIR)/golangci-lint
VERSION ?= $(shell git describe --tags --always --dirty 2> /dev/null || echo dev)

# Exporte .env dans l'environnement de la commande (valeurs sans espaces ni caractères shell).
WITH_ENV := set -a && . ./.env && set +a &&
WITH_ENV_IF_ANY := if [ -f .env ]; then set -a && . ./.env && set +a; fi &&
# goose lit la base dans l'environnement : le mot de passe n'apparaît pas dans la liste des processus.
GOOSE_ENV := GOOSE_DRIVER=postgres GOOSE_DBSTRING="$$DATABASE_URL" GOOSE_MIGRATION_DIR=$(MIGRATIONS)

.PHONY: help env env-sync up down logs ps db-shell redis-cli osrm-prepare check \
	tools run worker-run build legal-html purge-dry-run test test-unit lint fmt sqlc migrate-up migrate-down migrate-status migrate-new api-up worker-up \
	admin-create admin-reset-2fa seed-dev explain-search bench explain-stats bench-stats dev-remind dev-notify dev-decide \
	deploy-staging rollback-staging staging-tunnel

help: ## Affiche cette aide
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[33m%-15s\033[0m %s\n", $$1, $$2}'

# ── Infra ─────────────────────────────────────────────────────────────────────
env: .env ## Crée .env depuis .env.example avec des secrets aléatoires (n'écrase jamais)

.env:
	@./scripts/env.sh init

env-sync: .env ## Ajoute à .env les variables apparues dans .env.example (secrets générés)
	@./scripts/env.sh sync

up: .env ## Démarre PostGIS, Redis, OSRM, Mailpit et asynqmon, attend qu'ils soient healthy
	@$(COMPOSE) --profile dev up -d --wait --wait-timeout 180 || { \
	  echo "✖ Démarrage incomplet (voir l'erreur ci-dessus et 'make ps')."; \
	  echo "  OSRM en échec ? Prépare d'abord les données : make osrm-prepare"; \
	  exit 1; }
	@$(COMPOSE) --profile dev ps

down: ## Arrête tous les services, API comprise (les volumes sont conservés)
	@$(COMPOSE) --profile dev --profile api down

logs: ## Suit les logs (filtrer un service : make logs s=osrm)
	@$(COMPOSE) --profile dev --profile api logs -f --tail=200 $(s)

ps: ## État des services et des healthchecks
	@$(COMPOSE) --profile dev --profile api ps

db-shell: ## Ouvre psql dans le conteneur PostGIS
	@$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

redis-cli: ## Ouvre redis-cli (authentification automatique)
	@$(COMPOSE) exec redis redis-cli

osrm-prepare: .env ## Télécharge l'extrait Bénin et prépare OSRM (MLD) ; FORCE=1 pour retraiter
	@./scripts/osrm-prepare.sh $(if $(FORCE),--force,)

check: ## Vérifie PostGIS, Redis et une requête OSRM sur Cotonou
	@./scripts/check-infra.sh

# ── Backend Go ────────────────────────────────────────────────────────────────
tools: ## Installe goose, sqlc et golangci-lint (versions figées)
	go install github.com/pressly/goose/v3/cmd/goose@$(GOOSE_VERSION)
	go install github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION)
	go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_VERSION)

run: .env ## Lance l'API sur l'hôte avec les variables de .env (emails et push : make worker-run)
	@$(WITH_ENV) cd $(BACKEND) && go run -ldflags "-X main.version=$(VERSION)" ./cmd/api

worker-run: .env ## Lance le worker asynq sur l'hôte (tâches + scheduler, une seule instance)
	@$(WITH_ENV) cd $(BACKEND) && go run -ldflags "-X main.version=$(VERSION)" ./cmd/worker

build: ## Compile Backend/bin/api et Backend/bin/worker
	cd $(BACKEND) && CGO_ENABLED=1 go build -trimpath -ldflags "-X main.version=$(VERSION)" -o bin/api ./cmd/api
	cd $(BACKEND) && CGO_ENABLED=1 go build -trimpath -ldflags "-X main.version=$(VERSION)" -o bin/worker ./cmd/worker

legal-html: ## Rendu HTML statique des textes légaux (docs/legal/*.md → var/legal/)
	@cd Mobile && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/gen-legal.mts --html ../var/legal

purge-dry-run: .env ## Simule les purges de conservation : lignes que chaque règle traiterait maintenant, sans rien modifier
	@$(WITH_ENV) cd $(BACKEND) && go run ./cmd/worker purge-dry-run

test: ## Tests unitaires + intégration (testcontainers, Docker requis), avec -race
	@$(WITH_ENV_IF_ANY) cd $(BACKEND) && go test -race -count=1 -tags integration ./...

test-unit: ## Tests unitaires seuls (sans Docker)
	cd $(BACKEND) && go test -race ./...

lint: ## golangci-lint, formatage gci + gofumpt compris
	cd $(BACKEND) && $(GOLANGCI) run ./...

fmt: ## Formate le code Go (gci + gofumpt)
	cd $(BACKEND) && $(GOLANGCI) fmt ./...

sqlc: ## Régénère internal/store/dbgen depuis db/queries
	cd $(BACKEND) && $(SQLC) generate

migrate-up: .env ## Applique toutes les migrations en attente
	@$(WITH_ENV) $(GOOSE_ENV) $(GOOSE) up

migrate-down: .env ## Annule la dernière migration
	@$(WITH_ENV) $(GOOSE_ENV) $(GOOSE) down

migrate-status: .env ## État des migrations
	@$(WITH_ENV) $(GOOSE_ENV) $(GOOSE) status

migrate-new: ## Crée une migration SQL horodatée : make migrate-new name=add_x
	@[[ "$(name)" =~ ^[a-z0-9_]+$$ ]] || { echo "usage : make migrate-new name=add_x (minuscules, chiffres, _)"; exit 1; }
	@$(GOOSE) -dir $(MIGRATIONS) create $(name) sql

api-up: .env ## Lance l'API et le worker dans Docker (profil api) après les migrations, attend /readyz
	@$(COMPOSE) --profile dev up -d --wait --wait-timeout 180
	@$(MAKE) --no-print-directory migrate-up
	@API_VERSION=$(VERSION) $(COMPOSE) --profile dev --profile api up -d --build --wait --wait-timeout 180 api worker
	@$(COMPOSE) --profile api ps api worker

worker-up: .env ## Lance le worker seul dans Docker (profil api) après les migrations
	@$(COMPOSE) --profile dev up -d --wait --wait-timeout 180
	@$(MAKE) --no-print-directory migrate-up
	@API_VERSION=$(VERSION) $(COMPOSE) --profile dev --profile api up -d --build --wait --wait-timeout 180 worker
	@$(COMPOSE) --profile api ps worker

admin-create: .env ## Crée un admin : make admin-create email=… first=… last=… (mot de passe demandé)
	@[[ -n "$(email)" && -n "$(first)" && -n "$(last)" ]] || { echo "usage : make admin-create email=… first=… last=…"; exit 1; }
	@$(WITH_ENV) cd $(BACKEND) && go run ./cmd/admin create --email "$(email)" --first-name "$(first)" --last-name "$(last)"

admin-reset-2fa: .env ## Réinitialise la 2FA d'un admin : make admin-reset-2fa email=…
	@[[ -n "$(email)" ]] || { echo "usage : make admin-reset-2fa email=…"; exit 1; }
	@$(WITH_ENV) cd $(BACKEND) && go run ./cmd/admin reset-2fa --email "$(email)"

# ── Notifications : déclenchement immédiat (dev uniquement, le worker envoie les push) ──

dev-remind: .env ## Rappel de stock tout de suite : vieillit la dernière mise à jour puis lance la tâche (station=<uuid> [reset=1])
	@[[ -n "$(station)" ]] || { echo "usage : make dev-remind station=<uuid> [reset=1]"; exit 1; }
	@./scripts/with-env.sh bash -c 'cd $(BACKEND) && go run ./cmd/devtools remind -station "$(station)" $(if $(reset),-reset,)'

dev-notify: .env ## Notification d'un type à un compte (type=stock_reminder|back_in_stock|station_reported|station_decision user=<email|uuid> [decision=…] [station=…])
	@[[ -n "$(type)" && -n "$(user)" ]] || { echo "usage : make dev-notify type=… user=<email|uuid> [decision=…] [station=<uuid>]"; exit 1; }
	@./scripts/with-env.sh bash -c 'cd $(BACKEND) && go run ./cmd/devtools notify -type "$(type)" -user "$(user)" $(if $(decision),-decision "$(decision)",) $(if $(station),-station "$(station)",)'

dev-decide: .env ## Décision d'admin sur une station (push de décision) : make dev-decide station=<uuid> action=approve|reject|suspend|unsuspend [reason=… exigé sauf approve]
	@[[ -n "$(station)" && -n "$(action)" ]] || { echo "usage : make dev-decide station=<uuid> action=approve|reject|suspend|unsuspend [reason=…]"; exit 1; }
	@./scripts/with-env.sh bash -c 'cd $(BACKEND) && go run ./cmd/devtools decide -station "$(station)" -action "$(action)" $(if $(reason),-reason "$(reason)",)'

# ── Recherche : données fictives, plans et bench ──────────────────────────────

seed-dev: .env ## Stations fictives (5 000) + 30 jours de stats de recherche (dev uniquement ; COUNT=…, RESET=1 pour supprimer)
	@./scripts/with-env.sh bash -c 'cd $(BACKEND) && go run ./cmd/seed -count $(or $(COUNT),5000) $(if $(RESET),-reset,)'

explain-search: .env ## EXPLAIN ANALYZE des requêtes de recherche (vérifie l'index GiST)
	@./scripts/explain-search.sh

bench: .env ## Bench k6 de /search (5 zones) : p50/p95/p99, taux de cache ; DURATION=60s RATE=100
	@./scripts/bench.sh

explain-stats: .env ## EXPLAIN ANALYZE des requêtes de stats admin (agrégats, index de search_stats)
	@./scripts/explain-stats.sh

bench-stats: .env ## p50/p95/p99 des stats admin sur le jeu seed-dev (échoue si un p95 dépasse 300 ms)
	@./scripts/with-env.sh bash -c 'cd $(BACKEND) && go run ./cmd/benchstats $(if $(N),-n $(N),)'

# ── Staging (VPS, docs/DEPLOY.md §17) : depuis le poste, par SSH ─────────────

deploy-staging: ## Staging : deploy/staging.env poussé, code à REF (défaut origin/main), migrations, redémarrage
	@./scripts/staging.sh deploy $(or $(REF),origin/main)

rollback-staging: ## Staging : retour à une version déjà construite (make rollback-staging v=… ; liste : scripts/staging.sh prod versions)
	@[[ -n "$(v)" ]] || { echo "usage : make rollback-staging v=<version>"; exit 1; }
	@./scripts/staging.sh rollback "$(v)"

staging-tunnel: ## Staging : tunnel SSH vers Mailpit (127.0.0.1:18025) et le pilotage des E2E (127.0.0.1:18097)
	@./scripts/staging.sh tunnel
