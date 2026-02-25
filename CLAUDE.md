# Weight Tracker — Project Context

Self-hosted Docker Compose weight tracking app. React SPA + PocketBase backend. Units: **kg**.

## ⚠️ IMPORTANT: Always Back Up Before Migrations

Before making any changes to the PocketBase schema (collection PATCH, entrypoint.sh changes that alter the DB, or any direct SQLite operations), **take a backup first**:

```bash
cp /data/track/data.db /data/track/data.db.bak-$(date +%Y%m%d-%H%M%S)
```

PocketBase can silently wipe field data when schema is patched without original field IDs. A backup takes one second and has saved data loss before.

## Current Status

Fully deployed at `track.uleh.tv` on the uleh home server. Running behind Cloudflare Access (nginx reverse proxy → Docker Compose stack on port 3003). Debug instance runs on port 3002 from the local dev compose file.

## Architecture

```
Cloudflare Access (JWT validation at edge)
     │  Cf-Access-Jwt-Assertion header injected
     ▼
[nginx host] :443  track.uleh.tv.conf → track-frontend:80 (Docker container, pirate network)
     │
  [frontend] nginx container :3003
     ├── serves React SPA at /
     ├── serves /config.js (empty — no credentials)
     └── proxies /pb/ → [pocketbase]:8090 (internal Docker network)
          │  forwards Cf-Access-Jwt-Assertion header
          ▼
     [track-pocketbase] container :8090
          ├── pb_hooks/cf_auth.pb.js  → POST /api/cf-auth
          └── /pb/pb_data → /data/track (host volume)
```

## Production Deployment

Defined in `/home/sean/docker-compose.yml` alongside all other server services.

- `track-frontend`: builds from `/home/sean/git/seanuleh/track/frontend`, port 3003
- `track-pocketbase`: builds from `/home/sean/git/seanuleh/track/pocketbase`, no exposed port
- PocketBase data persists at `/data/track`
- `pb_hooks/` mounted from git repo at `/home/sean/git/seanuleh/track/pb_hooks` (hot-reloaded by PocketBase — no rebuild needed for hook changes)
- `track-pocketbase` has network alias `pocketbase` on the `pirate` network (required by the frontend nginx.conf which hardcodes that hostname)
- nginx config: `/data/nginx/conf.d/track.uleh.tv.conf`

To rebuild and redeploy after frontend changes:
```sh
docker compose up -d --build track-frontend
```

## Home Network Access

Pi-hole conditional forwarding routes all `uleh.tv` DNS queries directly to the server LAN IP (`192.168.1.1`), bypassing Cloudflare — so no CF JWT gets injected for home network traffic.

**Fix**: Add local DNS records in Pi-hole for `track.uleh.tv` pointing to Cloudflare's anycast IPs (`172.67.190.109`, `104.21.19.225`). Pi-hole serves local records before forwarding, so `track.uleh.tv` resolves via Cloudflare (JWT injected) while all other `uleh.tv` subdomains still resolve locally.

## Auth Flow

No login screen. On app load:

1. Frontend calls `POST /pb/api/cf-auth`
2. PocketBase hook (`pb_hooks/cf_auth.pb.js`) reads the `Cf-Access-Jwt-Assertion` header injected by Cloudflare Access
3. Decodes the JWT payload, extracts the user's email
4. Finds or creates a PocketBase `users` record for that email (random unusable password — CF is the only login path)
5. Returns a PocketBase auth token
6. Frontend stores token in `pb.authStore`, all subsequent CRUD requests are authenticated as that user

Admin credentials (`PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD`) are only used for the PocketBase admin UI at `/pb/_/` — set in `docker-compose.yml` environment for `track-pocketbase` only (`track-frontend` does not need them).

## Getting Started with Docker

```sh
cp .env.example .env
# Edit .env — set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD (min 10 chars)
docker compose up --build -d
```

Requires Cloudflare Access in front to inject the CF JWT header. Without it all requests return 401.

PocketBase admin dashboard: `http://localhost:<FRONTEND_PORT>/pb/_/`

Data persists via volume at `PB_DATA_PATH` (default `./pb_data/`).

**To reset the database**: stop containers, delete `pb_data/`, run `docker compose up -d`.

**Note**: Use `docker compose up -d` (not `restart`) after `.env` changes — restart doesn't reload env vars.

## File Structure

```
track/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── README.md
├── CLAUDE.md
├── pb_hooks/
│   └── cf_auth.pb.js       # CF JWT → find-or-create PB user → return token
├── pocketbase/
│   ├── Dockerfile           # Downloads PB 0.22.22 binary (alpine)
│   └── entrypoint.sh        # Idempotent init: admin + users collection + weight_entries
└── frontend/
    ├── Dockerfile            # Multi-stage: Vite build → nginx:alpine
    ├── entrypoint.sh         # Writes empty /config.js, starts nginx
    ├── nginx.conf            # SPA fallback + /pb/ proxy (forwards CF JWT header); upstream hostname must be "pocketbase"
    ├── package.json          # react 18, recharts, pocketbase sdk, vite
    ├── vite.config.js        # Dev proxy: /pb → localhost:8090
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx            # State, window filtering, delta calc, layout
        ├── App.css            # Light theme (cool & clinical), CSS custom props, mobile-first
        ├── api.js             # CF auth + PocketBase CRUD
        └── components/
            ├── WeightChart.jsx    # Recharts AreaChart, time-proportional X axis (timestamps)
            ├── EntryList.jsx      # Reverse-chrono cards, infinite scroll, tap-to-reveal actions
            ├── AddEditModal.jsx   # Bottom-sheet modal (slides up on mobile)
            └── FAB.jsx            # Fixed + button, bottom-right
```

## Key Implementation Details

**Auth (`api.js`)**: On init, calls `POST /pb/api/cf-auth` (no credentials needed — CF JWT is in the header automatically). Saves the returned token + user record to `pb.authStore`. All CRUD requests use this token.

**CF auth hook (`pb_hooks/cf_auth.pb.js`)**: Registered via `routerAdd`. Decodes the JWT payload with a pure-JS base64url decoder (goja runtime doesn't have `atob` or `$base64`). Uses `$app.dao().findAuthRecordByEmail()` for lookup and `$tokens.recordAuthToken()` to generate the PB token. Hook file is hot-reloaded by PocketBase — no container restart needed after edits.

**PocketBase init (`pocketbase/entrypoint.sh`)**: Idempotent. Creates: admin account, `users` auth collection (rules: authenticated users only), `weight_entries` collection (rules: `@request.auth.id != ""`). Stops background PB, then execs in foreground.

**Frontend nginx**: Passes `Cf-Access-Jwt-Assertion` header through to PocketBase via `proxy_set_header`. Upstream is hardcoded as `pocketbase:8090` — in production the `track-pocketbase` container must have network alias `pocketbase`.

**Vite dev proxy**: `vite.config.js` rewrites `/pb/*` → `http://localhost:8090/*`. Dev mode won't work without a CF JWT — you'd need to mock the header or temporarily relax the hook.

**Time window filtering (`App.jsx`)**: `filterByWindow` prepends an anchor data point pinned to the cutoff date (from the last entry before the window) so the chart line starts at the left edge. Anchor is only added if the oldest in-range entry is strictly after the cutoff (avoids duplicate points when a real entry falls exactly on the cutoff date). Selected window persists to `localStorage`.

**Chart (`WeightChart.jsx`)**: Uses `AreaChart` with `type="number" scale="time"` X axis and Unix timestamps. Custom tick generation (daily/weekly/monthly/yearly) based on span. Ticks are filtered to `[minTs, maxTs]` to prevent Recharts from extending the domain leftward. Y-axis width is dynamic based on the character length of the max value.

**Entry list (`EntryList.jsx`)**: Infinite scroll via `IntersectionObserver` sentinel — loads 20 entries at a time. Edit/delete actions are icon buttons, hidden by default, revealed on hover (desktop) or tap (mobile) via `.actions-visible` class.

## PocketBase Collections

**`users`** (auth collection) — created on first CF login, no static accounts

**`weight_entries`** (base collection)

| Field  | Type   | Required | Notes      |
|--------|--------|----------|------------|
| date   | text   | yes      | YYYY-MM-DD |
| weight | number | yes      | kg, min: 0 |
| notes  | text   | no       |            |

Rules on both collections: `@request.auth.id != ""` (any authenticated user).

## UI

- **Header**: current weight large + delta badge (colored green/red) vs selected window
- **Time windows**: `1W | 1M | 3M | 6M | 1Y | 2Y | 3Y | All` pill buttons, default 3M, persisted to localStorage
- **Chart**: Recharts AreaChart, indigo line (`#3b5bdb`), proportional time X axis, custom tooltip
- **Entry list**: reverse-chrono cards, date left / weight right, icon edit/delete, infinite scroll
- **FAB**: fixed bottom-right `+` opens modal
- **Modal**: slides up from bottom on mobile, centered on desktop
- **Theme**: light — bg `#f2f4f7`, surface `#ffffff`, accent `#3b5bdb`, fonts: Cormorant Garamond (display) + Jost (body)

## Dependencies

- `pocketbase` SDK `^0.21.5` — uses `pb.authStore` and `pb.collection()` CRUD
- `recharts` `^2.10` — `ResponsiveContainer`, `AreaChart`, `Area`, `XAxis`, `YAxis`, `Tooltip`, `CartesianGrid`
- PocketBase binary `0.22.22` — uses `/api/admins` endpoints (not the newer superusers API)
