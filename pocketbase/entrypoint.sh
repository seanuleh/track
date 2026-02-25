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

# Create users auth collection (no-op if exists)
# Users are created on-demand by the cf_auth hook — no static accounts needed.
echo "Creating users auth collection..."
USERS_COLLECTION_PAYLOAD='{
  "name": "users",
  "type": "auth",
  "schema": [],
  "listRule": "@request.auth.id != \"\"",
  "viewRule": "@request.auth.id != \"\"",
  "createRule": null,
  "updateRule": "@request.auth.id = id",
  "deleteRule": null
}'
USERS_COLL_RESP=$(wget -q -O - --post-data="$USERS_COLLECTION_PAYLOAD" \
  --header="Content-Type: application/json" \
  --header="Authorization: ${TOKEN}" \
  http://localhost:8090/api/collections 2>&1 || true)
echo "Users collection create response: $USERS_COLL_RESP"

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
    },
    {
      "name": "medication",
      "type": "text",
      "required": false,
      "options": {}
    },
    {
      "name": "dose_mg",
      "type": "number",
      "required": false,
      "options": {"min": 0, "max": null}
    },
    {
      "name": "user",
      "type": "relation",
      "required": true,
      "options": {"collectionId": "_pb_users_auth_", "cascadeDelete": false, "minSelect": null, "maxSelect": 1, "displayFields": []}
    }
  ],
  "listRule": "@request.auth.id = user",
  "viewRule": "@request.auth.id = user",
  "createRule": "@request.auth.id != \"\"",
  "updateRule": "@request.auth.id = user",
  "deleteRule": "@request.auth.id = user"
}'

COLL_RESP=$(wget -q -O - --post-data="$COLLECTION_PAYLOAD" \
  --header="Content-Type: application/json" \
  --header="Authorization: ${TOKEN}" \
  http://localhost:8090/api/collections 2>&1 || true)
echo "Collection create response: $COLL_RESP"

# Add medication/dose_mg fields to weight_entries if they don't exist (migration for existing installs)
echo "Migrating weight_entries: ensuring medication and dose_mg fields exist..."
CURRENT_SCHEMA=$(wget -q -O - \
  --header="Authorization: ${TOKEN}" \
  http://localhost:8090/api/collections/weight_entries 2>/dev/null || echo "")

if echo "$CURRENT_SCHEMA" | grep -q '"medication"'; then
  echo "medication field already exists — skipping migration."
else
  echo "Adding medication and dose_mg fields..."
  MIGRATE_RESP=$(wget -q -O - \
    --method=PATCH \
    --body-data='{"schema":[{"name":"date","type":"text","required":true,"options":{}},{"name":"weight","type":"number","required":true,"options":{"min":0,"max":null}},{"name":"notes","type":"text","required":false,"options":{}},{"name":"medication","type":"text","required":false,"options":{}},{"name":"dose_mg","type":"number","required":false,"options":{"min":0,"max":null}},{"name":"user","type":"relation","required":true,"options":{"collectionId":"_pb_users_auth_","cascadeDelete":false,"minSelect":null,"maxSelect":1,"displayFields":[]}}]}' \
    --header="Content-Type: application/json" \
    --header="Authorization: ${TOKEN}" \
    http://localhost:8090/api/collections/weight_entries 2>&1 || true)
  echo "Migration response: $MIGRATE_RESP"
fi

# Stop background PocketBase
echo "Stopping background PocketBase..."
kill $PB_PID
wait $PB_PID 2>/dev/null || true

echo "Init complete. Starting PocketBase in foreground..."
exec $PB_BIN serve --http=0.0.0.0:8090 --dir="$DATA_DIR"
