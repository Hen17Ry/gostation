# GoStation — commandes de développement. `make` ou `make help` pour la liste.
SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

COMPOSE := docker compose
s ?=

.PHONY: help env up down logs ps db-shell redis-cli osrm-prepare check

help: ## Affiche cette aide
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[33m%-14s\033[0m %s\n", $$1, $$2}'

env: .env ## Crée .env depuis .env.example avec des secrets aléatoires (n'écrase jamais)

.env:
	@command -v openssl > /dev/null || { echo "openssl requis"; exit 1; }
	@sed -e "s/change-me-postgres/$$(openssl rand -hex 24)/g" \
	     -e "s/change-me-redis/$$(openssl rand -hex 24)/g" \
	     -e "s/change-me-jwt-access-secret/$$(openssl rand -hex 32)/g" \
	     -e "s/change-me-documents-key/$$(openssl rand -hex 32)/g" \
	     .env.example > .env
	@chmod 600 .env
	@echo "✔ .env créé avec des secrets aléatoires"

up: .env ## Démarre PostGIS, Redis et OSRM, attend qu'ils soient healthy
	@$(COMPOSE) up -d --wait --wait-timeout 180 || { \
	  echo "✖ Démarrage incomplet (voir l'erreur ci-dessus et 'make ps')."; \
	  echo "  OSRM en échec ? Prépare d'abord les données : make osrm-prepare"; \
	  exit 1; }
	@$(COMPOSE) ps

down: ## Arrête les services (les volumes sont conservés)
	@$(COMPOSE) down

logs: ## Suit les logs (filtrer un service : make logs s=osrm)
	@$(COMPOSE) logs -f --tail=200 $(s)

ps: ## État des services et des healthchecks
	@$(COMPOSE) ps

db-shell: ## Ouvre psql dans le conteneur PostGIS
	@$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

redis-cli: ## Ouvre redis-cli (authentification automatique)
	@$(COMPOSE) exec redis redis-cli

osrm-prepare: .env ## Télécharge l'extrait Bénin et prépare OSRM (MLD) ; FORCE=1 pour retraiter
	@./scripts/osrm-prepare.sh $(if $(FORCE),--force,)

check: ## Vérifie PostGIS, Redis et une requête OSRM sur Cotonou
	@./scripts/check-infra.sh
