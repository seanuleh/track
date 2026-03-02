# track

Self-hosted weight tracker. React SPA + PocketBase backend, deployed as a single Docker container.

Auth is handled by Cloudflare Access + a `cf-auth` nginx sidecar — whoever CF lets through gets a PocketBase user automatically. No login screen.

## Stack

- **Frontend**: React + Recharts, served by PocketBase `--publicDir`
- **Backend**: PocketBase 0.22 (REST API + realtime)
- **Auth**: Cloudflare Access JWT → nginx cf-auth sidecar → `X-Auth-Email` header → PocketBase hook (find-or-create user)

## Run

Requires:
- The `cf-auth` nginx sidecar running and injecting `X-Auth-Email` headers
- nginx configured with `cf-auth.conf` and `cf-auth-location.conf` snippets

```sh
docker compose up --build -d
```

Set `PB_ADMIN_EMAIL` and `PB_ADMIN_PASSWORD` (min 10 chars) in the environment or compose file.

**PocketBase admin UI**: `yourhost/_/`

## Data

Persists to `/pb/pb_data` (mount a volume there).

To reset: stop container, delete pb_data contents, restart.
