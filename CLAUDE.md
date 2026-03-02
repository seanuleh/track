# Weight Tracker — Project Context

Self-hosted Docker Compose weight tracking app. React SPA + PocketBase backend. Units: **kg**.

## ⚠️ IMPORTANT: Always Back Up Before Migrations

Before making any changes to the PocketBase schema (collection PATCH, entrypoint.sh changes that alter the DB, or any direct SQLite operations), **take a backup first**:

```bash
cp /data/track/data.db /data/track/data.db.bak-$(date +%Y%m%d-%H%M%S)
```

PocketBase can silently wipe field data when schema is patched without original field IDs. A backup takes one second and has saved data loss before.

## Current Status

Fully deployed at `track.uleh.tv` on the uleh home server. Single container (`track`) running behind nginx + Cloudflare Access. The `cf-auth` sidecar handles JWT validation and injects `X-Auth-Email` into every proxied request.

## Architecture

```
Cloudflare Access (JWT validation at edge)
     │
     ▼
[nginx] :443  track.uleh.tv.conf
     │  auth_request → cf-auth sidecar (/validate)
     │  X-Auth-Email header injected into proxied request
     ▼
[track] container :8090
     ├── /              → React SPA (pb_public/)
     ├── /api/          → PocketBase REST API
     ├── /_/            → PocketBase admin UI
     └── pb_hooks/cf_auth.pb.js  → POST /api/cf-auth (reads X-Auth-Email)
          └── /pb/pb_data → /data/track (host volume)
```

## Production Deployment

Defined in `/home/sean/docker-compose.yml`.

- Single `track` container — builds from `/home/sean/git/seanuleh/track` (root Dockerfile)
- PocketBase serves frontend via `--publicDir /pb/pb_public`
- Hooks baked into the image at `/pb/pb_hooks/` — no volume mount, no hot-reload
- PocketBase data persists at `/data/track` (host volume → `/pb/pb_data`)
- nginx config: `/data/nginx/conf.d/track.uleh.tv.conf`
- cf-auth snippets: `/data/nginx/snippets/cf-auth.conf` and `cf-auth-location.conf`

To rebuild and redeploy after any changes:
```sh
cd /home/sean && docker compose up -d --build track
```

## Auth Flow

No login screen. On app load:

1. Frontend calls `POST /api/cf-auth`
2. nginx has already run `auth_request` → cf-auth sidecar → validated CF JWT → injected `X-Auth-Email`
3. PocketBase hook (`pb_hooks/cf_auth.pb.js`) reads `X-Auth-Email` header — no JWT decoding needed
4. Finds or creates a PocketBase `users` record for that email (random unusable password — CF is the only login path)
5. Returns a PocketBase auth token
6. Frontend stores token in `pb.authStore`, all subsequent CRUD requests are authenticated as that user

Admin credentials (`PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD`) are only used for the PocketBase admin UI at `/_/`.

## File Structure

```
track/
├── Dockerfile               # Multi-stage: Vite build → PocketBase + pb_public + pb_hooks
├── docker-compose.yml       # Local dev only (not used in production)
├── README.md
├── CLAUDE.md
├── pb_hooks/
│   └── cf_auth.pb.js        # Reads X-Auth-Email → find-or-create PB user → return token
│                            # Baked into image — rebuild required after changes
├── pocketbase/
│   ├── Dockerfile           # Superseded by root Dockerfile (kept for reference)
│   └── entrypoint.sh        # Idempotent init: admin + users collection + weight_entries
│                            # Starts PB with --publicDir and --hooksDir
└── frontend/
    ├── package.json         # react 18, recharts, pocketbase sdk, vite
    ├── vite.config.js       # Dev proxy: /api → localhost:8090
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx           # State, window filtering, delta calc, layout
        ├── App.css           # Light theme, CSS custom props, mobile-first
        ├── api.js            # PocketBase('/') + POST /api/cf-auth + CRUD
        └── components/
            ├── WeightChart.jsx    # Recharts AreaChart, time-proportional X axis
            ├── EntryList.jsx      # Reverse-chrono cards, infinite scroll
            ├── AddEditModal.jsx   # Bottom-sheet modal
            └── FAB.jsx            # Fixed + button
```

## Key Implementation Details

**Auth (`api.js`)**: On init, calls `POST /api/cf-auth` (no credentials). PocketBase is instantiated as `new PocketBase('/')` — no `/pb` prefix. Saves the returned token + user record to `pb.authStore`.

**CF auth hook (`pb_hooks/cf_auth.pb.js`)**: Reads `X-Auth-Email` header (set by nginx cf-auth sidecar). No JWT decoding — that's the sidecar's job. Uses `$app.dao().findAuthRecordByEmail()` for lookup and `$tokens.recordAuthToken()` to generate the PB token. Baked into image — requires rebuild to change.

**PocketBase init (`pocketbase/entrypoint.sh`)**: Idempotent. Creates: admin account, `users` auth collection, `weight_entries` collection. Starts PB with `--publicDir /pb/pb_public --hooksDir /pb/pb_hooks`. Stops background PB, then execs in foreground.

**Vite dev proxy**: `vite.config.js` proxies `/api` → `http://localhost:8090`. Dev mode requires a running cf-auth sidecar or manual `X-Auth-Email` header injection.

**Time window filtering (`App.jsx`)**: `filterByWindow` prepends an anchor data point pinned to the cutoff date so the chart line starts at the left edge.

**Chart (`WeightChart.jsx`)**: `AreaChart` with `type="number" scale="time"` X axis and Unix timestamps. Custom tick generation based on span.

**Entry list (`EntryList.jsx`)**: Infinite scroll via `IntersectionObserver` sentinel — 20 entries at a time.

## PocketBase Collections

**`users`** (auth collection) — created on first CF login, no static accounts

**`weight_entries`** (base collection)

| Field      | Type   | Required | Notes      |
|------------|--------|----------|------------|
| date       | text   | yes      | YYYY-MM-DD |
| weight     | number | yes      | kg, min: 0 |
| notes      | text   | no       |            |
| medication | text   | no       |            |
| dose_mg    | number | no       |            |
| user       | relation | yes    | → users    |

Rules: user can only see/edit their own entries (`@request.auth.id = user`).

## UI

- **Header**: current weight large + delta badge (colored green/red) vs selected window
- **Time windows**: `1W | 1M | 3M | 6M | 1Y | 2Y | 3Y | All` pill buttons, default 3M, persisted to localStorage
- **Chart**: Recharts AreaChart, indigo line (`#3b5bdb`), proportional time X axis, custom tooltip
- **Entry list**: reverse-chrono cards, icon edit/delete, infinite scroll
- **FAB**: fixed bottom-right `+` opens modal
- **Theme**: light — bg `#f2f4f7`, surface `#ffffff`, accent `#3b5bdb`; fonts: Cormorant Garamond + Jost

## Dependencies

- `pocketbase` SDK `^0.21.5`
- `recharts` `^2.10`
- PocketBase binary `0.22.22`
