# Weight Tracker — Project Context

Self-hosted Docker Compose weight tracking app. React SPA + PocketBase backend. Units: **kg**.

## Current Status

App is fully implemented and working. Tested locally by running PocketBase and Vite dev server directly (no Docker). Next step: deploy with Docker Compose on a machine that has Docker.

## Architecture

```
Host port 3000
     │
  [frontend] nginx container
     ├── serves React SPA at /
     ├── serves /config.js (runtime env inject for PB credentials)
     └── proxies /pb/ → [pocketbase]:8090 (internal Docker network)
                              │
                         [pocketbase] container
                              └── /pb/pb_data → host volume
```

- PocketBase is **not** exposed to the host — only reachable via nginx proxy at `/pb/`
- Admin credentials are injected via Docker env vars → `window.__CONFIG__` → `api.js` auto-logs in
- No user-facing login screen

## Getting Started with Docker

```sh
cp .env.example .env
# Edit .env — set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD
docker compose up --build
```

Open http://localhost:3000 (or whatever `FRONTEND_PORT` is set to).

PocketBase admin dashboard: `http://localhost:3000/pb/_/`

Data persists via volume at `PB_DATA_PATH` (default `./pb_data/`).

## Running Locally Without Docker (dev)

Requires Node.js and a PocketBase binary.

1. Download PocketBase for your platform from https://github.com/pocketbase/pocketbase/releases (tested with v0.22.22)
2. Place binary at `./pb_bin/pocketbase`
3. First run — init admin and collection:

```sh
# Start PB in background
./pb_bin/pocketbase serve --http=127.0.0.1:8090 --dir=./pb_data &

# Create admin
curl -s -X POST http://127.0.0.1:8090/api/admins \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"changeme123","passwordConfirm":"changeme123"}'

# Auth and get token
TOKEN=$(curl -s -X POST http://127.0.0.1:8090/api/admins/auth-with-password \
  -H "Content-Type: application/json" \
  -d '{"identity":"admin@example.com","password":"changeme123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Create collection
curl -s -X POST http://127.0.0.1:8090/api/collections \
  -H "Content-Type: application/json" \
  -H "Authorization: $TOKEN" \
  -d '{
    "name": "weight_entries", "type": "base",
    "schema": [
      {"name":"date","type":"text","required":true,"options":{}},
      {"name":"weight","type":"number","required":true,"options":{"min":0}},
      {"name":"notes","type":"text","required":false,"options":{}}
    ],
    "listRule":null,"viewRule":null,"createRule":null,"updateRule":null,"deleteRule":null
  }'

# Start frontend
npm install --prefix frontend
npm run dev --prefix frontend -- --port 3000
```

Subsequent runs: just start PB and Vite — data and admin persist in `./pb_data/`.

## File Structure

```
track/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── CLAUDE.md
├── pocketbase/
│   ├── Dockerfile          # Downloads PB 0.22.22 binary (alpine)
│   └── entrypoint.sh       # Idempotent init: creates admin + collection, then serves
└── frontend/
    ├── Dockerfile           # Multi-stage: Vite build → nginx:alpine
    ├── entrypoint.sh        # Writes window.__CONFIG__ from env vars, starts nginx
    ├── nginx.conf           # SPA fallback + /pb/ proxy with WebSocket support
    ├── package.json         # react 18, recharts, pocketbase sdk, vite
    ├── vite.config.js       # Dev proxy: /pb → localhost:8090
    ├── index.html           # Loads /config.js before module scripts
    └── src/
        ├── main.jsx
        ├── App.jsx           # State, window filtering, delta calc, layout
        ├── App.css           # Dark theme, CSS custom props, mobile-first
        ├── api.js            # PocketBase admin auth + CRUD
        └── components/
            ├── WeightChart.jsx    # Recharts ResponsiveContainer LineChart
            ├── EntryList.jsx      # Reverse-sorted history cards
            ├── AddEditModal.jsx   # Bottom-sheet modal (slides up on mobile)
            └── FAB.jsx            # Fixed + button, bottom-right
```

## Key Implementation Details

**Auth (`api.js`)**: Calls `pb.admins.authWithPassword()` on app init using credentials from `window.__CONFIG__`. Token stored in module scope. All CRUD uses admin token — no collection rules needed.

**PocketBase init (`pocketbase/entrypoint.sh`)**: Fully idempotent. Starts PB in background, waits for `/api/health`, creates admin (no-ops if exists), authenticates, creates `weight_entries` collection (no-ops if exists), stops background PB, then execs PB in foreground.

**Runtime config**: `frontend/entrypoint.sh` writes `/config.js` at nginx startup from Docker env vars. `index.html` loads it via `<script src="/config.js">` before module scripts so `window.__CONFIG__` is available synchronously.

**Vite dev proxy**: `vite.config.js` rewrites `/pb/*` → `http://localhost:8090/*` so the dev server behaves identically to the nginx proxy in production.

## PocketBase Collection Schema

Collection name: `weight_entries`

| Field  | Type   | Required | Notes          |
|--------|--------|----------|----------------|
| date   | text   | yes      | YYYY-MM-DD     |
| weight | number | yes      | kg, min: 0     |
| notes  | text   | no       |                |

All rules null (admin bypasses anyway).

## UI

- **Header**: current weight large + delta badge (colored green/red) vs selected window
- **Time windows**: `1W | 1M | 3M | 6M | 1Y | All` pill buttons, default 3M
- **Chart**: Recharts LineChart, sky-blue line (`#38bdf8`), dark card, custom tooltip
- **Entry list**: reverse-chrono cards, weight + date + notes, edit/delete buttons
- **FAB**: fixed bottom-right `+` opens modal
- **Modal**: slides up from bottom on mobile, centered on desktop
- **Theme**: dark — bg `#0a0f1e`, surface `#111827`, primary `#38bdf8`, danger `#f87171`, success `#4ade80`

## Dependencies

- `pocketbase` SDK `^0.21.5` — uses `pb.admins.authWithPassword()` and `pb.collection()` CRUD
- `recharts` `^2.10` — `ResponsiveContainer`, `LineChart`, `Line`, `XAxis`, `YAxis`, `Tooltip`, `CartesianGrid`
- PocketBase binary `0.22.22` — uses `/api/admins` endpoints (not the newer superusers API)
