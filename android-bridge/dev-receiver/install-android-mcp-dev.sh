#!/bin/sh
set -eu
# Operator-run DEV-only installer. No PROD configuration access.
SERVICE=ai-task-android-mcp-dev.service
SRC=/opt/openclaw-android-bridge-dev
CONF=/etc/nginx/sites-enabled/dev-ai-task.cstlogistic.co.id
TOKEN_DIR=/etc/ai-task-android-mcp-dev
if [ "$(id -u)" -ne 0 ]; then
  echo 'Run as root on the authorized DEV VPS' >&2
  exit 1
fi
test -f "$SRC/android-mcp-dev.mjs"
test -f "$SRC/ai-task-android-mcp-dev.service"
test -f "$CONF"
test -d /var/lib/openclaw-android-bridge-dev
/usr/bin/node --check "$SRC/android-mcp-dev.mjs"
# Do not accidentally activate when the isolated DEV container isn't running.
test "$(/usr/bin/docker inspect ai-task-dev-pr49-hostnet --format '{{.State.Running}}')" = true
/usr/bin/docker exec ai-task-dev-pr49-hostnet node -e "if(process.env.NODE_ENV!=='development'||!process.env.SUPABASE_DATABASE_URL_DEV||process.env.SUPABASE_DATABASE_URL||process.env.SUPABASE_PROD_DATABASE_URL)process.exit(12)"
install -d -m 0700 -o root -g root "$TOKEN_DIR"
if [ ! -s "$TOKEN_DIR/token" ]; then
  umask 077
  /usr/bin/node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url')+'\n')" > "$TOKEN_DIR/token"
fi
chown root:root "$TOKEN_DIR/token"
chmod 0600 "$TOKEN_DIR/token"
install -m 0644 -o root -g root "$SRC/ai-task-android-mcp-dev.service" "/etc/systemd/system/$SERVICE"
# Nginx is patched only in exact DEV virtual host, never an unrelated host.
if ! grep -q 'location = /mcp/android-dev {' "$CONF"; then
  cp -p "$CONF" "$CONF.pre-android-mcp-dev"
  /usr/bin/python3 - "$CONF" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1])
s=p.read_text()
needle='    location / {'
assert s.count(needle)==1, 'Unexpected DEV Nginx layout'
block='''    location = /mcp/android-dev {
        limit_except POST { deny all; }
        client_max_body_size 8k;
        proxy_pass http://127.0.0.1:18799/mcp/android-dev;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Host $host;
        proxy_connect_timeout 5s;
        proxy_read_timeout 20s;
        proxy_buffering off;
    }

'''
p.write_text(s.replace(needle,block+needle,1))
PY
fi
if ! nginx -t; then
  echo 'Nginx invalid; restore saved DEV configuration before proceeding.' >&2
  exit 1
fi
systemctl daemon-reload
systemctl enable --now "$SERVICE"
systemctl reload nginx
systemctl is-active --quiet "$SERVICE"
# Authentication MUST reject requests without bearer.
code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://127.0.0.1:18799/mcp/android-dev)"
test "$code" = 401
echo 'DEV MCP service enabled; unauthenticated request denied (HTTP 401).'
echo 'Configure an authorized independent MCP connection; never paste the token into chat.'
