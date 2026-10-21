# syntax=docker/dockerfile:1
# Image de l'API GoStation (et du worker : entrypoint /app/worker) : build cgo (h3-go) sur Debian
# trixie, exécution distroless (glibc, sans shell) sous l'utilisateur non-root 65532.

ARG GO_VERSION=1.27.2

FROM golang:${GO_VERSION}-trixie AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
ARG VERSION=dev
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=1 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/api ./cmd/api \
 && CGO_ENABLED=1 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/worker ./cmd/worker \
 && CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/admin ./cmd/admin
# Répertoire des justificatifs, possédé par l'utilisateur non-root : un volume nommé monté
# dessus hérite de ces droits.
RUN mkdir -p /out/documents && chown 65532:65532 /out/documents && chmod 700 /out/documents

# Outils du staging (scripts/prod.sh seed | e2e-*) : seed des stations fictives, fixtures et
# nettoyage des E2E. Image à part (cible « tools », deploy/staging.compose.yml), jamais dans celle
# de la production ; les deux binaires refusent APP_ENV=production.
FROM build AS tools-build
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/seed ./cmd/seed \
 && CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/e2efixtures ./cmd/e2efixtures

FROM gcr.io/distroless/base-debian13:nonroot AS tools
COPY --from=tools-build /out/seed /out/e2efixtures /app/
USER nonroot:nonroot
ENTRYPOINT []

# Image de l'API et du worker (cible par défaut : dernière étape).
FROM gcr.io/distroless/base-debian13:nonroot
COPY --from=build /out/api /out/worker /out/admin /app/
COPY --from=build --chown=65532:65532 /out/documents /var/lib/gostation/documents
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/app/api"]
