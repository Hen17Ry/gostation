# syntax=docker/dockerfile:1
# Image de l'API GoStation : build cgo (h3-go) sur Debian trixie, exécution distroless
# (glibc, sans shell) sous l'utilisateur non-root 65532.

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
 && CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/admin ./cmd/admin
# Répertoire des justificatifs, possédé par l'utilisateur non-root : un volume nommé monté
# dessus hérite de ces droits.
RUN mkdir -p /out/documents && chown 65532:65532 /out/documents && chmod 700 /out/documents

FROM gcr.io/distroless/base-debian13:nonroot
COPY --from=build /out/api /out/admin /app/
COPY --from=build --chown=65532:65532 /out/documents /var/lib/gostation/documents
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/app/api"]
