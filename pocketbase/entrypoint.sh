#!/bin/sh
set -e

PB_BIN="/pb/pocketbase"
DATA_DIR="/pb/pb_data"

echo "Starting PocketBase init..."

# Start PocketBase in background
$PB_BIN serve --http=0.0.0.0:8090 --dir="$DATA_DIR" &
PB_PID=$!

# Wait for PocketBase to be ready
echo "Waiting for PocketBase to be ready..."
for i in $(seq 1 30); do
  if wget -q --spider http://localhost:8090/api/health 2>/dev/null; then
    echo "PocketBase is ready."
    break
  fi
  sleep 1
done

# Create admin account (no-op if already exists)
echo "Creating admin account..."
ADMIN_RESP=$(wget -q -O - --post-data="{\"email\":\"${PB_ADMIN_EMAIL}\",\"password\":\"${PB_ADMIN_PASSWORD}\",\"passwordConfirm\":\"${PB_ADMIN_PASSWORD}\"}" \
  --header="Content-Type: application/json" \
  http://localhost:8090/api/admins 2>&1 || true)
echo "Admin create response: $ADMIN_RESP"

# Authenticate to get token
echo "Authenticating..."
AUTH_RESP=$(wget -q -O - --post-data="{\"identity\":\"${PB_ADMIN_EMAIL}\",\"password\":\"${PB_ADMIN_PASSWORD}\"}" \
  --header="Content-Type: application/json" \
  http://localhost:8090/api/admins/auth-with-password)

TOKEN=$(echo "$AUTH_RESP" | sed 's/.*"token":"\([^"]*\)".*/\1/')
echo "Got token: ${TOKEN:0:20}..."

# Create weight_entries collection (no-op if exists)
echo "Creating weight_entries collection..."
COLLECTION_PAYLOAD='{
  "name": "weight_entries",
  "type": "base",
  "schema": [
    {
      "name": "date",
      "type": "text",
      "required": true,
      "options": {}
    },
    {
      "name": "weight",
      "type": "number",
      "required": true,
      "options": {"min": 0, "max": null}
    },
    {
      "name": "notes",
      "type": "text",
      "required": false,
      "options": {}
    }
  ],
  "listRule": null,
  "viewRule": null,
  "createRule": null,
  "updateRule": null,
  "deleteRule": null
}'

COLL_RESP=$(wget -q -O - --post-data="$COLLECTION_PAYLOAD" \
  --header="Content-Type: application/json" \
  --header="Authorization: ${TOKEN}" \
  http://localhost:8090/api/collections 2>&1 || true)
echo "Collection create response: $COLL_RESP"

# Stop background PocketBase
echo "Stopping background PocketBase..."
kill $PB_PID
wait $PB_PID 2>/dev/null || true

echo "Init complete. Starting PocketBase in foreground..."
exec $PB_BIN serve --http=0.0.0.0:8090 --dir="$DATA_DIR"
