#!/usr/bin/env bash
# Record the Cadence walkthrough from scratch.
#
#   apps/web/scripts/demo/record.sh [out-dir] [extra tour.mjs args, e.g. --only calendar]
#
# Resets both state dirs (a fresh copy of the seeded demo database, and an empty freshly migrated
# one for the onboarding segment), starts a dev server on each, runs the tour, and stops the servers.
# Output: <out-dir>/cadence-walkthrough.mp4 (default out-dir: ./demo-video).
set -euo pipefail

WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$(realpath -m "${1:-demo-video}")"
shift || true
BASE_PORT=${BASE_PORT:-5208}
FRESH_PORT=${FRESH_PORT:-5218}
export WRANGLER_SEND_METRICS=false CI=1

cd "$WEB"
[ -d .wrangler/seed-master ] || { echo "missing .wrangler/seed-master (seed the demo database first)" >&2; exit 1; }

stop() {
  pgrep -f "vite.js dev --port $BASE_PORT" | xargs -r kill || true
  pgrep -f "vite.js dev --port $FRESH_PORT" | xargs -r kill || true
}
trap stop EXIT
stop
sleep 1

echo "· resetting state"
rm -rf .wrangler/vid && cp -r .wrangler/seed-master .wrangler/vid
rm -rf .wrangler/vid-fresh
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/vid-fresh >/dev/null

mkdir -p "$OUT"
echo "· starting servers ($BASE_PORT seeded, $FRESH_PORT fresh)"
CF_PERSIST_TO=.wrangler/vid VITE_CACHE_DIR=node_modules/.vite-vid \
  npx vite dev --port "$BASE_PORT" --strictPort >"$OUT/server-base.log" 2>&1 &
sleep 5 # two servers starting at once can clash on the inspector port
CF_PERSIST_TO=.wrangler/vid-fresh VITE_CACHE_DIR=node_modules/.vite-vid-fresh \
  npx vite dev --port "$FRESH_PORT" --strictPort >"$OUT/server-fresh.log" 2>&1 &

for port in "$BASE_PORT" "$FRESH_PORT"; do
  for _ in $(seq 1 90); do
    curl -sf "http://localhost:$port/api/auth/status" >/dev/null && break
    sleep 1
  done
  curl -sf "http://localhost:$port/api/auth/status" >/dev/null || { echo "server on :$port did not start" >&2; exit 1; }
done

echo "· recording"
node scripts/demo/tour.mjs --base "http://localhost:$BASE_PORT" --fresh "http://localhost:$FRESH_PORT" --out "$OUT" "$@"
