# Weight Tracker — Project Context

Self-hosted Docker Compose weight tracking app. React SPA + PocketBase backend. Units: **kg**.

## Current Status

Fully deployed at `track.uleh.tv` on the uleh home server. Running behind Cloudflare Access (nginx reverse proxy → Docker Compose stack on port 3002).

## Architecture

```
Cloudflare Access (JWT validation at edge)
     │  Cf-Access-Jwt-Assertion header injected
     ▼
[nginx host] :443  track.uleh.tv.conf → localhost:3002
     │
  [frontend] nginx container :3002
     ├── serves React SPA at /
     ├── serves /config.js (empty — no credentials)
     └── proxies /pb/ → [pocketbase]:8090 (internal Docker network)
          │  forwards Cf-Access-Jwt-Assertion header
          ▼
     [pocketbase] container :8090
          ├── pb_hooks/cf_auth.pb.js  → POST /api/cf-auth
          └── /pb/pb_data → host volume
```

## Auth Flow

No login screen. On app load:

1. Frontend calls `POST /pb/api/cf-auth`
2. PocketBase hook (`pb_hooks/cf_auth.pb.js`) reads the `Cf-Access-Jwt-Assertion` header injected by Cloudflare Access
3. Decodes the JWT payload, extracts the user's email
4. Finds or creates a PocketBase `users` record for that email (random unusable password — CF is the only login path)
5. Returns a PocketBase auth token
6. Frontend stores token in `pb.authStore`, all subsequent CRUD requests are authenticated as that user

Admin credentials (`PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD`) are only used for the PocketBase admin UI at `/pb/_/` — never exposed to the browser.

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
    ├── nginx.conf            # SPA fallback + /pb/ proxy (forwards CF JWT header)
    ├── package.json          # react 18, recharts, pocketbase sdk, vite
    ├── vite.config.js        # Dev proxy: /pb → localhost:8090
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx            # State, window filtering, delta calc, layout
        ├── App.css            # Dark theme, CSS custom props, mobile-first
        ├── api.js             # CF auth + PocketBase CRUD
        └── components/
            ├── WeightChart.jsx    # Recharts ResponsiveContainer LineChart
            ├── EntryList.jsx      # Reverse-sorted history cards
            ├── AddEditModal.jsx   # Bottom-sheet modal (slides up on mobile)
            └── FAB.jsx            # Fixed + button, bottom-right
```

## Key Implementation Details

**Auth (`api.js`)**: On init, calls `POST /pb/api/cf-auth` (no credentials needed — CF JWT is in the header automatically). Saves the returned token + user record to `pb.authStore`. All CRUD requests use this token.

**CF auth hook (`pb_hooks/cf_auth.pb.js`)**: Registered via `routerAdd`. Decodes the JWT payload with a pure-JS base64url decoder (goja runtime doesn't have `atob` or `$base64`). Uses `$app.dao().findAuthRecordByEmail()` for lookup and `$tokens.recordAuthToken()` to generate the PB token.

**PocketBase init (`pocketbase/entrypoint.sh`)**: Idempotent. Creates: admin account, `users` auth collection (rules: authenticated users only), `weight_entries` collection (rules: `@request.auth.id != ""`). Stops background PB, then execs in foreground.

**Frontend nginx**: Passes `Cf-Access-Jwt-Assertion` header through to PocketBase via `proxy_set_header`.

**Vite dev proxy**: `vite.config.js` rewrites `/pb/*` → `http://localhost:8090/*`. Dev mode won't work without a CF JWT — you'd need to mock the header or temporarily relax the hook.

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
- **Time windows**: `1W | 1M | 3M | 6M | 1Y | All` pill buttons, default 3M
- **Chart**: Recharts LineChart, sky-blue line (`#38bdf8`), dark card, custom tooltip
- **Entry list**: reverse-chrono cards, weight + date + notes, edit/delete buttons
- **FAB**: fixed bottom-right `+` opens modal
- **Modal**: slides up from bottom on mobile, centered on desktop
- **Theme**: dark — bg `#0a0f1e`, surface `#111827`, primary `#38bdf8`, danger `#f87171`, success `#4ade80`

## Dependencies

- `pocketbase` SDK `^0.21.5` — uses `pb.authStore` and `pb.collection()` CRUD
- `recharts` `^2.10` — `ResponsiveContainer`, `LineChart`, `Line`, `XAxis`, `YAxis`, `Tooltip`, `CartesianGrid`
- PocketBase binary `0.22.22` — uses `/api/admins` endpoints (not the newer superusers API)
