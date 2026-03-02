# track

Self-hosted weight tracker. React SPA + PocketBase backend, deployed as a single Docker container.

## Stack

- **Frontend**: React + Recharts, served by PocketBase `--publicDir`
- **Backend**: PocketBase 0.22 (REST API + realtime)
- **Auth**: handled externally — see [Running with auth](#running-with-auth)

## Self-hosting

The app itself has no login screen and no auth code. Authentication is intended to be handled at the infrastructure layer (reverse proxy) before requests reach the container.

The PocketBase JS SDK reads `localStorage.pocketbase_auth` on startup. Your infrastructure is responsible for populating it with a valid PocketBase token before the app loads.

### Minimal setup (no auth)

For local use or trusted environments, you can run the container directly and create users manually via the PocketBase admin UI at `/_/`.

```sh
docker run -p 8090:8090 \
  -e PB_ADMIN_EMAIL=admin@example.com \
  -e PB_ADMIN_PASSWORD=yourpassword \
  -v ./pb_data:/pb/pb_data \
  ghcr.io/seanuleh/track
```

Or with Docker Compose:

```yaml
services:
  track:
    build: .
    ports:
      - "8090:8090"
    environment:
      - PB_ADMIN_EMAIL=admin@example.com
      - PB_ADMIN_PASSWORD=yourpassword    # min 10 characters
    volumes:
      - ./pb_data:/pb/pb_data
```

### Running with auth

To get automatic login (no login screen), place a reverse proxy in front of the container that:

1. Validates the user's identity
2. Injects a script into HTML responses that sets `localStorage.pocketbase_auth` to a valid PocketBase token before the app initialises
3. Proxies `/cf-autologin` to an endpoint that handles find-or-create PocketBase users and returns the token injection page

The [`cfAuth`](https://github.com/seanuleh/cfAuth) sidecar implements this pattern for Cloudflare Access, but any identity provider can be used.

## Environment variables

| Variable | Description |
|---|---|
| `PB_ADMIN_EMAIL` | PocketBase superadmin email |
| `PB_ADMIN_PASSWORD` | PocketBase superadmin password (min 10 chars) |

## Data

Persists to `/pb/pb_data` inside the container. Mount a volume there to keep data across rebuilds.

**PocketBase admin UI**: `yourhost/_/`

## Dev

```sh
cd frontend
npm install
npm run dev   # proxies /api → localhost:8090
```

Requires a running PocketBase instance on port 8090.
