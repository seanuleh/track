#!/bin/sh
set -e

# Inject runtime config for the React app
cat > /usr/share/nginx/html/config.js <<EOF
window.__CONFIG__ = {
  PB_ADMIN_EMAIL: "${PB_ADMIN_EMAIL}",
  PB_ADMIN_PASSWORD: "${PB_ADMIN_PASSWORD}"
};
EOF

echo "Config written."
exec nginx -g "daemon off;"
