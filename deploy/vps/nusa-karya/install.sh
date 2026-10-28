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

"${SUDO[@]}" install -d -m 0755 "$WEB_ROOT"
"${SUDO[@]}" install -m 0644 "$SOURCE_DIR/index.html" "$WEB_ROOT/index.html"
"${SUDO[@]}" install -m 0644 "$SOURCE_DIR/styles.css" "$WEB_ROOT/styles.css"
"${SUDO[@]}" install -m 0644 "$SOURCE_DIR/app.js" "$WEB_ROOT/app.js"
printf '%s\n' "$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo unknown)" | "${SUDO[@]}" tee "$WEB_ROOT/deploy-sha.txt" >/dev/null
echo "NUSA_KARYA_STATIC_SYNC=PASS web_root=$WEB_ROOT"

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

local_code="$(curl --silent --show-error --connect-timeout 5 --max-time 10 \
  -H "Host: $DOMAIN" \
  -D /tmp/nusa-karya-health.headers \
  -o /tmp/nusa-karya-health.body \
  -w '%{http_code}' http://127.0.0.1/healthz || true)"

case "$local_code" in
  200)
    grep -q '"status":"ok"' /tmp/nusa-karya-health.body
    local_home="$(curl --silent --show-error --connect-timeout 5 --max-time 10 -H "Host: $DOMAIN" http://127.0.0.1/ || true)"
    grep -q 'Marketplace 3D Karya Indonesia' <<<"$local_home"
    grep -q 'hero-3d' <<<"$local_home"
    grep -q '20261028-3d-bronze-1' <<<"$local_home"
    echo "NUSA_KARYA_LOCAL_HTTP=PASS domain=$DOMAIN web_root=$WEB_ROOT redesign=bronze-3d"
    ;;
  301|302|307|308)
    grep -Eiq "^location:[[:space:]]*https://$DOMAIN(/healthz)?[[:space:]]*$" /tmp/nusa-karya-health.headers || {
      echo "NUSA_KARYA_LOCAL_HTTP=UNEXPECTED_REDIRECT http=$local_code" >&2
      cat /tmp/nusa-karya-health.headers >&2 || true
      exit 1
    }
    echo "NUSA_KARYA_LOCAL_HTTP=REDIRECT_PASS domain=$DOMAIN http=$local_code"
    ;;
  *)
    echo "NUSA_KARYA_LOCAL_HTTP=FAILED http=${local_code:-missing}" >&2
    cat /tmp/nusa-karya-health.headers >&2 || true
    cat /tmp/nusa-karya-health.body >&2 || true
    exit 1
    ;;
esac

if command -v certbot >/dev/null 2>&1; then
  if getent ahostsv4 "$DOMAIN" >/dev/null 2>&1; then
    "${SUDO[@]}" certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect       --register-unsafely-without-email || echo "NUSA_KARYA_TLS=DEFERRED"
  fi
fi

public_code="$(curl --silent --show-error --connect-timeout 8 --max-time 15 -D /tmp/nusa-karya-public.headers -o /tmp/nusa-karya-public.html -w '%{http_code}' "https://$DOMAIN/" || true)"
css_code="$(curl --silent --show-error --connect-timeout 8 --max-time 15 -D /tmp/nusa-karya-css.headers -o /tmp/nusa-karya-public.css -w '%{http_code}' "https://$DOMAIN/styles.css?v=20261028-3d-bronze-1" || true)"
js_code="$(curl --silent --show-error --connect-timeout 8 --max-time 15 -D /tmp/nusa-karya-js.headers -o /tmp/nusa-karya-public.js -w '%{http_code}' "https://$DOMAIN/app.js?v=20261028-mobile-tilt-1" || true)"

if [ "$public_code" = "200" ] && [ "$css_code" = "200" ] && [ "$js_code" = "200" ] && grep -q 'Marketplace 3D Karya Indonesia' /tmp/nusa-karya-public.html && grep -q 'hero-3d' /tmp/nusa-karya-public.html && grep -q '20261028-3d-bronze-1' /tmp/nusa-karya-public.html && cmp -s "$SOURCE_DIR/styles.css" /tmp/nusa-karya-public.css && cmp -s "$SOURCE_DIR/app.js" /tmp/nusa-karya-public.js && grep -Eiq '^cache-control:.*no-cache.*no-store.*must-revalidate' /tmp/nusa-karya-public.headers && grep -Eiq '^cache-control:.*no-cache.*no-store.*must-revalidate' /tmp/nusa-karya-css.headers && grep -Eiq '^cache-control:.*no-cache.*no-store.*must-revalidate' /tmp/nusa-karya-js.headers; then
  echo "NUSA_KARYA_BROWSER_ASSETS=PASS domain=$DOMAIN redesign=bronze-3d cache=no-store"
else
  echo "NUSA_KARYA_BROWSER_ASSETS=FAILED html=$public_code css=$css_code js=$js_code"
  exit 2
fi
