#!/usr/bin/env bash
# Stand up a disposable copy of production and drive the real UI against it.
#
# Everything this creates is throwaway: a PocketBase container named `trackdev`
# on a copy of the latest backup, a vite dev server on :5199, and a seeded probe
# user. Production (`/data/track`, the `track` container) is never touched.
#
#   ./probe/run.sh          # set up, run all probes, tear down
#   ./probe/run.sh --keep   # leave the stack up to iterate against
#   ./probe/run.sh --down   # tear down a stack left up by --keep
#
# See probe/README.md for what each probe checks and how to add cases.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK=/tmp/trackprobe
DATA=/tmp/trackdev
PORT=5199

teardown() {
  docker rm -f trackdev >/dev/null 2>&1 || true
  pkill -f "vite --port $PORT" >/dev/null 2>&1 || true
  rm -rf "$DATA"
  echo "torn down"
}

if [[ "${1:-}" == "--down" ]]; then teardown; exit 0; fi

# ── 1. Disposable backend on a copy of the newest backup ──────────────────
BACKUP=$(ls -t /data/track/backups/*.tar.gz 2>/dev/null | head -1)
if [[ -z "$BACKUP" ]]; then
  echo "No backup in /data/track/backups. Take one first (see CLAUDE.md)." >&2
  exit 1
fi
echo "seeding from $BACKUP"

docker rm -f trackdev >/dev/null 2>&1 || true
rm -rf "$DATA"; mkdir -p "$DATA" "$WORK"
tar -xzf "$BACKUP" -C "$DATA"

IMAGE=$(docker inspect track --format '{{.Config.Image}}')
docker run -d --rm --name trackdev \
  -p 127.0.0.1:8090:8090 \
  -v "$DATA":/pb/pb_data \
  --entrypoint /pb/pocketbase "$IMAGE" \
  serve --http=0.0.0.0:8090 --dir=/pb/pb_data >/dev/null

until curl -sf localhost:8090/api/health >/dev/null; do sleep 0.3; done
echo "pocketbase up on :8090"

# ── 2. Probe user + synthetic data ────────────────────────────────────────
# Signup is open on the users collection, so no admin credentials are needed.
cp "$REPO"/probe/*.py "$REPO"/probe/*.js "$WORK"/
( cd "$WORK" && python3 mkuser.py && python3 seed.py )

# ── 3. Frontend ───────────────────────────────────────────────────────────
# vite.config.js proxies /api to localhost:8090, which is now the copy.
# setsid + </dev/null so vite doesn't inherit this script's stdout: if it does,
# piping run.sh into anything (`| tail`) blocks until vite exits rather than
# until the script finishes.
( cd "$REPO/frontend" && setsid npx vite --port $PORT --host 127.0.0.1 \
    </dev/null >"$WORK/vite.log" 2>&1 & )
until curl -sf "localhost:$PORT" >/dev/null; do sleep 0.3; done
echo "vite up on :$PORT"

# ── 4. Browser ────────────────────────────────────────────────────────────
# Playwright, not Selenium: this host has no chrome/chromedriver and installing
# one needs root, whereas `npx playwright install chromium` drops a browser in
# ~/.cache/ms-playwright as an ordinary user.
if [[ ! -d /tmp/node_modules/playwright ]]; then
  ( cd /tmp && npm i -D playwright@latest --silent && npx playwright install chromium )
fi

( cd "$WORK" && node probe.js && echo && node probe2.js && echo && node probe3.js && echo && node probe5.js )
echo
echo "screenshots: $WORK/shots  $WORK/shots2"

if [[ "${1:-}" == "--keep" ]]; then
  echo "stack left up — app on http://127.0.0.1:$PORT, tear down with ./probe/run.sh --down"
else
  teardown
fi
