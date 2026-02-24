# track

Self-hosted weight tracker. React SPA + PocketBase backend, deployed via Docker Compose.

Auth is handled by Cloudflare Access — whoever CF lets through gets a PocketBase user automatically. No login screen.

## Stack

- **Frontend**: React + Recharts, served by nginx
- **Backend**: PocketBase 0.22 (REST API + realtime)
- **Auth**: Cloudflare Access JWT → PocketBase user (find-or-create on first visit)

## Run

```sh
cp .env.example .env
# Edit .env — set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD (min 10 chars)
docker compose up --build -d
```

Requires Cloudflare Access in front of the app to inject the `Cf-Access-Jwt-Assertion` header. Without it, all requests return 401.

**PocketBase admin UI**: `yourhost/pb/_/`

## Data

Persists to `./pb_data/` (configurable via `PB_DATA_PATH` in `.env`).

To reset: stop containers, delete `pb_data/`, restart.
