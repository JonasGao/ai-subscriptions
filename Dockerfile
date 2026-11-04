# Multi-stage build for the Go + SolidJS single binary (ADR-0018).
# Build context: repository root (`docker build -t ai-subscriptions:latest .`).
#
# Base images are overridable at build time so machines without direct
# docker.io access can point at a mirror (see deploy/docker/README.md):
#   ~/docker/ai-subscriptions/build.env sets NODE_IMAGE / GO_IMAGE /
#   RUNTIME_IMAGE / GOPROXY, and deploy/docker/Makefile forwards them.
ARG NODE_IMAGE=node:24-alpine
ARG GO_IMAGE=golang:1.27-alpine
ARG RUNTIME_IMAGE=gcr.io/distroless/static-debian12:nonroot
ARG GOPROXY=https://proxy.golang.org,direct

# --- web: build the SolidJS SPA ---
FROM ${NODE_IMAGE} AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# --- server: compile the static Go binary with the SPA embedded ---
FROM ${GO_IMAGE} AS build
ARG GOPROXY
ENV GOPROXY=${GOPROXY}
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
COPY --from=web /src/web/dist/ ./internal/webui/dist/
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/ai-subscriptions ./cmd/server \
 && mkdir -p /out/data && touch /out/data/.keep

# --- runtime: distroless, no shell/tooling, non-root ---
FROM ${RUNTIME_IMAGE}
WORKDIR /app
ENV PORT=3000 \
    DATA_DIR=/data
COPY --from=build /out/ai-subscriptions /app/ai-subscriptions
# Prepare the data mount point with the contract user (1000:1000).
COPY --from=build --chown=1000:1000 /out/data /data
USER 1000:1000
EXPOSE 3000
# Distroless carries no shell/wget/curl, so the probe is the binary itself.
# Tight cadence here so `docker run` (and deploy/docker/smoke.sh) converge fast;
# deploy/docker/docker-compose.yml restates the deployment cadence
# (interval 30s, timeout 10s, start_period 15s).
HEALTHCHECK --interval=5s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/ai-subscriptions", "healthcheck"]
ENTRYPOINT ["/app/ai-subscriptions"]
