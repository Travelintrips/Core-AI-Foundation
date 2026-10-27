#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-/opt/core-ai-foundation}"
DOMAIN="${NUSA_KARYA_DOMAIN:-nusakarya.aicst.co.id}"
WEB_ROOT="${NUSA_KARYA_WEB_ROOT:-/var/www/nusa-karya}"
SOURCE_DIR="$REPO_DIR/artifacts/nusa-karya"
NGINX_SOURCE="$REPO_DIR/deploy/vps/nusa-karya/nginx.conf"
NGINX_AVAILABLE="/etc/nginx/sites-available/nusa-karya"
NGINX_ENABLED="/etc/nginx/sites-enabled/nusa-karya"

if [ "$(id -u)" -eq 0 ]; then SUDO=(); else SUDO=(sudo); fi

test -f "$SOURCE_DIR/index.html"
test -f "$SOURCE_DIR/styles.css"
test -f "$SOURCE_DIR/app.js"
test -f "$NGINX_SOURCE"
command -v nginx >/dev/null 2>&1

if [ -f "$NGINX_AVAILABLE" ] && [ -L "$NGINX_ENABLED" ]; then
  "${SUDO[@]}" install -d -m 0755 "$WEB_ROOT"
  "${SUDO[@]}" install -m 0644 "$SOURCE_DIR/index.html" "$WEB_ROOT/index.html"
  "${SUDO[@]}" install -m 0644 "$SOURCE_DIR/styles.css" "$WEB_ROOT/styles.css"
  "${SUDO[@]}" install -m 0644 "$SOURCE_DIR/app.js" "$WEB_ROOT/app.js"
  echo "NUSA_KARYA_STATIC_REFRESH=PASS web_root=$WEB_ROOT"

  public_code="$(curl --silent --show-error --connect-timeout 8 --max-time 15 -o /tmp/nusa-karya-public.html -w '%{http_code}' "https://$DOMAIN/" || true)"
  if [ "$public_code" = "200" ] && grep -qi "Nusa Karya" /tmp/nusa-karya-public.html; then
    echo "NUSA_KARYA_PUBLIC_HTTPS=PASS domain=$DOMAIN"
    exit 0
  fi

  echo "NUSA_KARYA_PUBLIC_HTTPS=NOT_YET_VERIFIED http=$public_code"
  exit 2
fi

"${SUDO[@]}" install -d -m 0755 "$WEB_ROOT"
"${SUDO[@]}" install -m 0644 "$SOURCE_DIR/index.html" "$WEB_ROOT/index.html"
"${SUDO[@]}" install -m 0644 "$SOURCE_DIR/styles.css" "$WEB_ROOT/styles.css"
"${SUDO[@]}" install -m 0644 "$SOURCE_DIR/app.js" "$WEB_ROOT/app.js"

tmp_conf="$(mktemp)"
trap 'rm -f "$tmp_conf"' EXIT
sed "s/nusakarya\.aicst\.co\.id/$DOMAIN/g" "$NGINX_SOURCE" > "$tmp_conf"
"${SUDO[@]}" install -m 0644 "$tmp_conf" "$NGINX_AVAILABLE"
"${SUDO[@]}" ln -sfn "$NGINX_AVAILABLE" "$NGINX_ENABLED"

"${SUDO[@]}" nginx -t
if "${SUDO[@]}" systemctl reload nginx 2>/tmp/nusa-karya-nginx-reload.err; then
  echo "NUSA_KARYA_NGINX_RELOAD=SYSTEMCTL_PASS"
elif "${SUDO[@]}" nginx -s reload 2>>/tmp/nusa-karya-nginx-reload.err; then
  echo "NUSA_KARYA_NGINX_RELOAD=SIGNAL_PASS"
else
  cat /tmp/nusa-karya-nginx-reload.err >&2 || true
  echo "NUSA_KARYA_NGINX_RELOAD=FAILED" >&2
  exit 1
fi

local_code="$(curl --silent --show-error --connect-timeout 5 --max-time 10   -H "Host: $DOMAIN" -o /tmp/nusa-karya-health.json -w '%{http_code}' http://127.0.0.1/healthz || true)"
test "$local_code" = "200"
grep -q '"status":"ok"' /tmp/nusa-karya-health.json

echo "NUSA_KARYA_LOCAL_HTTP=PASS domain=$DOMAIN web_root=$WEB_ROOT"

if command -v certbot >/dev/null 2>&1; then
  if getent ahostsv4 "$DOMAIN" >/dev/null 2>&1; then
    "${SUDO[@]}" certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect       --register-unsafely-without-email || echo "NUSA_KARYA_TLS=DEFERRED"
  fi
fi

public_code="$(curl --silent --show-error --connect-timeout 8 --max-time 15   -o /tmp/nusa-karya-public.html -w '%{http_code}' "https://$DOMAIN/" || true)"
if [ "$public_code" = "200" ] && grep -qi "Nusa Karya" /tmp/nusa-karya-public.html; then
  echo "NUSA_KARYA_PUBLIC_HTTPS=PASS domain=$DOMAIN"
else
  echo "NUSA_KARYA_PUBLIC_HTTPS=NOT_YET_VERIFIED http=$public_code"
  exit 2
fi
