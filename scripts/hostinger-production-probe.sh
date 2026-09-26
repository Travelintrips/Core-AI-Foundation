#!/usr/bin/env bash
set -euo pipefail

: "${API_BASE_URL:?API_BASE_URL is required}"
: "${EXPECTED_SHA:?EXPECTED_SHA is required}"

health_url="${API_BASE_URL%/}/healthz"
stable_successes=0
required_successes=3

for attempt in $(seq 1 36); do
  host=$(node -e 'const u=new URL(process.argv[1]); process.stdout.write(u.hostname)' "$health_url")

  dns_addresses=$(getent ahosts "$host" 2>/dev/null | awk '{print $1}' | sort -u | paste -sd, - || true)
  if [ -z "$dns_addresses" ]; then
    echo "attempt=$attempt phase=dns status=fail host=$host expected_sha=$EXPECTED_SHA"
    stable_successes=0
    sleep 10
    continue
  fi

  tcp_status="ok"
  if ! timeout 5 bash -c "cat < /dev/null > /dev/tcp/$host/443" 2>/tmp/tcp-error; then
    tcp_status="fail"
  fi
  if [ "$tcp_status" != "ok" ]; then
    echo "attempt=$attempt phase=tcp status=fail host=$host dns=$dns_addresses expected_sha=$EXPECTED_SHA"
    stable_successes=0
    sleep 10
    continue
  fi

  rm -f /tmp/headers /tmp/body /tmp/curl-error
  code=$(curl -L -sS -D /tmp/headers -o /tmp/body -w "%{http_code}" \
    --connect-timeout 15 --max-time 30 "$health_url" 2>/tmp/curl-error || true)

  live_sha=$(awk -F': ' 'tolower($1)=="x-cst-commit-sha" {gsub("\r","",$2); print $2}' /tmp/headers 2>/dev/null | tail -n1)
  marker=$(awk -F': ' 'tolower($1)=="x-cst-release-marker" {gsub("\r","",$2); print $2}' /tmp/headers 2>/dev/null | tail -n1)
  server=$(awk -F': ' 'tolower($1)=="server" {gsub("\\r","",$2); print $2}' /tmp/headers 2>/dev/null | tail -n1)
  content_type=$(awk -F': ' 'tolower($1)=="content-type" {gsub("\\r","",$2); print $2}' /tmp/headers 2>/dev/null | tail -n1)
  location=$(awk -F': ' 'tolower($1)=="location" {gsub("\\r","",$2); print $2}' /tmp/headers 2>/dev/null | tail -n1)
  via=$(awk -F': ' 'tolower($1)=="via" {gsub("\\r","",$2); print $2}' /tmp/headers 2>/dev/null | tail -n1)
  request_id=$(awk -F': ' 'tolower($1)=="x-request-id" || tolower($1)=="x-hostinger-request-id" || tolower($1)=="cf-ray" {gsub("\\r","",$2); print $2}' /tmp/headers 2>/dev/null | tail -n1)
  curl_error=$(tr '\n' ' ' </tmp/curl-error 2>/dev/null | sed 's/[[:space:]]\+/ /g' | cut -c1-240 || true)
  body_excerpt=$(tr '\\n' ' ' </tmp/body 2>/dev/null | sed 's/<[^>]*>/ /g; s/[[:space:]]\\+/ /g' | cut -c1-240 || true)

  if [ "$code" = "000" ]; then
    echo "attempt=$attempt phase=https status=fail http=000 dns=$dns_addresses live_sha=${live_sha:-missing} expected_sha=$EXPECTED_SHA marker=${marker:-missing} error=${curl_error:-none}"
    stable_successes=0
  elif [ "$code" != "200" ]; then
    echo "attempt=$attempt phase=http status=fail http=$code dns=$dns_addresses live_sha=${live_sha:-missing} expected_sha=$EXPECTED_SHA marker=${marker:-missing} server=${server:-missing} content_type=${content_type:-missing} location=${location:-missing} via=${via:-missing} request_id=${request_id:-missing} body=${body_excerpt:-empty}"
    stable_successes=0
  elif [ "$live_sha" != "$EXPECTED_SHA" ]; then
    echo "attempt=$attempt phase=sha status=waiting http=$code dns=$dns_addresses live_sha=${live_sha:-missing} expected_sha=$EXPECTED_SHA marker=${marker:-missing}"
    stable_successes=0
  else
    stable_successes=$((stable_successes + 1))
    echo "attempt=$attempt phase=stable status=ok http=$code dns=$dns_addresses live_sha=$live_sha expected_sha=$EXPECTED_SHA marker=${marker:-missing} consecutive=$stable_successes/$required_successes"
    if [ "$stable_successes" -ge "$required_successes" ]; then
      exit 0
    fi
  fi

  sleep 10
done

echo "Production did not become stable on expected commit $EXPECTED_SHA"
exit 1
