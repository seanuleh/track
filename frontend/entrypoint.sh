#!/bin/sh
set -e

# No runtime credentials needed — auth is handled server-side via CF Access JWT
cat > /usr/share/nginx/html/config.js <<EOF
window.__CONFIG__ = {};
EOF

echo "Config written."
exec nginx -g "daemon off;"
