# Weight Tracker — Agent Reference

Self-hosted Docker weight tracking app. React SPA + PocketBase backend. Units: **kg**.

## ⚠️ Always Back Up Before Schema Changes

```bash
cp /data/track/data.db /data/track/data.db.bak-$(date +%Y%m%d-%H%M%S)
```

PocketBase silently wipes field data when schema is patched without original field IDs.

## Current Deployment

Live at `track.uleh.tv` on the uleh home server.

- Single `survivor` container — builds from `/home/sean/git/seanuleh/track`
- PocketBase data at `/data/track` (host volume → `/pb/pb_data`)
- nginx config: `/data/nginx/conf.d/track.uleh.tv.conf`
- Auth via cf-auth sidecar + nginx sub_filter (see architecture below)

To rebuild and redeploy:
```sh
cd /home/sean && docker compose up -d --build track
```

## Architecture

```
Cloudflare Access (JWT at edge)
     │
     ▼
[nginx] :443  track.uleh.tv.conf
     │  sub_filter injects localStorage check into HTML
     │  → if no token: redirect to /cf-autologin?app=track
     │  /cf-autologin proxied to cf-auth sidecar
     ▼
[track] container :8090
     ├── /          → React SPA (pb_public/)
     ├── /api/      → PocketBase REST API
     └── /_/        → PocketBase admin UI
          └── /pb/pb_data → /data/track (host volume)
```

## Auth Flow

No login screen. Auth is handled entirely at the infrastructure layer:

1. nginx sub_filter injects a script that checks `localStorage.pocketbase_auth`
2. If missing → redirect to `/cf-autologin?app=track&next=<path>`
3. cf-auth sidecar reads `CF_Authorization` cookie, finds/creates PB user via admin API, sets localStorage, redirects back
4. PocketBase SDK auto-loads token from localStorage on `new PocketBase('/')`

The app has zero auth code — `api.js` just calls `new PocketBase('/')` and the API.

## File Structure

```
track/
├── Dockerfile               # Multi-stage: Vite build → PocketBase + pb_public
├── README.md
├── CLAUDE.md
├── pocketbase/
│   └── entrypoint.sh        # Idempotent init: admin + users collection + weight_entries
│                            # Starts PB with --publicDir only (no hooks)
└── frontend/
    ├── package.json         # react 18, recharts, pocketbase sdk, vite
    ├── vite.config.js       # Dev proxy: /api → localhost:8090
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx           # State, window filtering, delta calc, layout
        ├── App.css           # CSS custom props, mobile-first
        ├── api.js            # PocketBase('/') + CRUD — no auth code
        └── components/
            ├── WeightChart.jsx    # Recharts AreaChart, time-proportional X axis
            ├── EntryList.jsx      # Reverse-chrono cards, infinite scroll
            ├── AddEditModal.jsx   # Bottom-sheet modal
            └── FAB.jsx            # Fixed + button
```

No `pb_hooks/` — the app is hook-free. Auth is handled by the cf-auth sidecar outside the container.

## PocketBase Collections

**`users`** (auth collection) — created on first boot

**`weight_entries`** (base collection)

| Field      | Type     | Required | Notes      |
|------------|----------|----------|------------|
| date       | text     | yes      | YYYY-MM-DD |
| weight     | number   | yes      | kg, min: 0 |
| notes      | text     | no       |            |
| medication | text     | no       |            |
| dose_mg    | number   | no       |            |
| user       | relation | yes      | → users    |

Rules: user can only see/edit their own entries (`@request.auth.id = user`).

## UI

- **Header**: current weight large + delta badge (green/red) vs selected window
- **Time windows**: `1W | 1M | 3M | 6M | 1Y | 2Y | 3Y | All` pill buttons, default 3M, persisted to localStorage
- **Chart**: Recharts AreaChart, proportional time X axis
- **Entry list**: reverse-chrono cards, infinite scroll via IntersectionObserver
- **FAB**: fixed bottom-right `+` opens modal

## Dependencies

- `pocketbase` SDK `^0.21.5`
- `recharts` `^2.10`
- PocketBase binary `0.22.22`
