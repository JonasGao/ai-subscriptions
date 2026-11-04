#!/usr/bin/env bash
# Smoke-test the built image against the deployment contract (ADR-0018):
# non-root runtime, distroless healthcheck, /data volume read/write, embedded
# SPA. Runs on a throw-away container/port, so it never touches the live
# deployment on :3000.
#
# Usage: deploy/docker/smoke.sh [image]
set -euo pipefail

IMAGE="${1:-ai-subscriptions:latest}"
NAME="ai-subscriptions-smoke"
PORT="${SMOKE_PORT:-13900}"
DATA_DIR="$(mktemp -d)"
CONTAINER_DATA_DIR="/data/smoke-subdir"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  docker logs "$NAME" 2>&1 | tail -20 >&2 || true
  exit 1
}

echo "==> image: $IMAGE"
USER_CFG="$(docker image inspect -f '{{.Config.User}}' "$IMAGE")"
[ "$USER_CFG" = "1000:1000" ] || fail "image USER = '$USER_CFG', want 1000:1000"

echo "==> start container (data volume: $DATA_DIR, port: $PORT)"
# DATA_DIR points at a not-yet-existing subdirectory so that the container
# process itself must create it inside the mounted volume — that is the
# volume write proof (the runtime has no shell to test with).
docker run -d --name "$NAME" \
  -p "$PORT:3000" \
  -e DATA_DIR="$CONTAINER_DATA_DIR" \
  -v "$DATA_DIR:/data" \
  --user 1000:1000 \
  "$IMAGE" >/dev/null

echo "==> wait for the container healthcheck (distroless: binary subcommand)"
for _ in $(seq 1 40); do
  state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$NAME" 2>/dev/null || true)"
  [ "$state" = "healthy" ] && break
  [ "$state" = "unhealthy" ] && fail "container reported unhealthy"
  sleep 1
done
[ "${state:-}" = "healthy" ] || fail "container did not become healthy (last state: ${state:-unknown})"

echo "==> HTTP contract on :$PORT"
health="$(curl -fsS "http://127.0.0.1:$PORT/api/health")"
case "$health" in
  *'"status":"ok"'*) ;;
  *) fail "/api/health body = $health" ;;
esac
shell="$(curl -fsS "http://127.0.0.1:$PORT/")"
case "$shell" in
  *'id="root"'*) ;;
  *) fail "SPA shell missing from / (body starts: ${shell:0:80})" ;;
esac
api404="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/does-not-exist")"
[ "$api404" = "404" ] || fail "unknown API route returned $api404, want 404"

echo "==> non-root runtime uid"
# docker top requires PID in the field list; take the UID column only.
run_uid="$(docker top "$NAME" -eo uid,pid | awk 'NR>1 {print $1}' | sort -u | sed -n '1p')"
[ "$run_uid" = "1000" ] || fail "process uid = '$run_uid', want 1000"

echo "==> data volume write (container -> host)"
[ -d "$DATA_DIR/smoke-subdir" ] || fail "container did not create $CONTAINER_DATA_DIR inside the mounted volume"
echo "probe" > "$DATA_DIR/smoke-subdir/host-write.txt"
[ -f "$DATA_DIR/smoke-subdir/host-write.txt" ] || fail "host cannot write into the mounted volume"

echo "==> storage and snapshot paths live on the volume"
[ -f "$DATA_DIR/smoke-subdir/ai-subscriptions.db" ] || fail "SQLite database is not inside DATA_DIR (volume)"
[ -d "$DATA_DIR/smoke-subdir/backups" ] || fail "snapshot dir backups/ is not inside DATA_DIR (volume)"
[ -n "$(find "$DATA_DIR/smoke-subdir/backups" -name '*.db' -print -quit)" ] || fail "no startup snapshot found in DATA_DIR/backups"

echo "==> data volume mount mapping"
mounts="$(docker inspect -f '{{range .Mounts}}{{.Source}}:{{.Destination}} {{end}}' "$NAME")"
case "$mounts" in
  *"$DATA_DIR:/data"*) ;;
  *) fail "mounts = '$mounts', want '$DATA_DIR:/data'" ;;
esac

echo "==> ok: image contract verified"
