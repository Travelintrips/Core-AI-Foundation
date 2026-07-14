#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# WP-13: Pre-deploy gate script
#
# Run this before switching traffic to a new deployment.
# Exits 0 (pass) or 1 (fail). All failures are printed to stderr.
#
# Usage:
#   API_BASE_URL=https://<your-replit-domain>/api \
#   ADMIN_API_KEY=<key> \
#   bash scripts/pre-deploy-check.sh
#
# In CI/CD, set the env vars as secrets and call this script as a step.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

API_BASE="${API_BASE_URL:-http://localhost:8080}"
ADMIN_KEY="${ADMIN_API_KEY:-}"
TIMEOUT=15

PASS=0
FAIL=0

pass() { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1" >&2; ((FAIL++)) || true; }
section() { echo ""; echo "── $1 ──────────────────────────────────────────"; }

echo "═══════════════════════════════════════════════════"
echo "  AI Platform — Pre-Deploy Gate"
echo "  Target: $API_BASE"
echo "  $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "═══════════════════════════════════════════════════"

# ─── 1. Required environment variables ───────────────────────────────────────
section "Environment"

REQUIRED_VARS=("ADMIN_API_KEY" "SESSION_SECRET")
for var in "${REQUIRED_VARS[@]}"; do
  if [ -n "${!var:-}" ]; then
    pass "$var is set"
  else
    fail "$var is NOT set"
  fi
done

# SUPABASE vars — require at least one database URL
if [ -n "${SUPABASE_DEV_DATABASE_URL:-}" ] || [ -n "${SUPABASE_PROD_DATABASE_URL:-}" ] || [ -n "${SUPABASE_DATABASE_URL:-}" ]; then
  pass "Database URL configured"
else
  fail "No database URL configured (SUPABASE_DEV_DATABASE_URL / SUPABASE_PROD_DATABASE_URL)"
fi

# ─── 2. Build artifact integrity ─────────────────────────────────────────────
section "Build Artifacts"

DIST="artifacts/api-server/dist/index.mjs"
if [ -f "$DIST" ]; then
  SIZE=$(wc -c < "$DIST")
  if [ "$SIZE" -gt 100000 ]; then
    pass "api-server dist/index.mjs exists (${SIZE} bytes)"
  else
    fail "api-server dist/index.mjs is suspiciously small (${SIZE} bytes) — rebuild required"
  fi
else
  fail "api-server dist/index.mjs not found — run pnpm run build:api first"
fi

# ─── 3. Liveness probe ────────────────────────────────────────────────────────
section "API Server Liveness"

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout "$TIMEOUT" \
  "${API_BASE}/healthz" 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
  pass "GET /healthz → HTTP 200"
else
  fail "GET /healthz → HTTP $HTTP_STATUS (expected 200)"
fi

# ─── 4. Readiness probe (DB + schema) ────────────────────────────────────────
section "API Server Readiness"

READINESS_RESP=$(curl -s --connect-timeout "$TIMEOUT" \
  "${API_BASE}/healthz/full" 2>/dev/null || echo '{"status":"unreachable"}')

READINESS_STATUS=$(echo "$READINESS_RESP" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")

if [ "$READINESS_STATUS" = "ok" ]; then
  pass "GET /healthz/full → status=ok"
elif [ "$READINESS_STATUS" = "degraded" ]; then
  pass "GET /healthz/full → status=degraded (non-blocking)"
  echo "    ⚠ Degraded details: $READINESS_RESP"
else
  fail "GET /healthz/full → status=$READINESS_STATUS"
  echo "    Response: $READINESS_RESP" >&2
fi

# ─── 5. Auth enforcement ────────────────────────────────────────────────────
section "Security: Auth Enforcement"

# Admin endpoint without key → must return 401
if [ -n "$ADMIN_KEY" ]; then
  UNAUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    --connect-timeout "$TIMEOUT" \
    "${API_BASE}/ai/agents" 2>/dev/null || echo "000")
  if [ "$UNAUTH_STATUS" = "401" ]; then
    pass "Admin route without key → 401 (fail-closed confirmed)"
  else
    fail "Admin route without key → $UNAUTH_STATUS (expected 401 — auth may be open)"
  fi

  # Admin endpoint with key → must return 200
  AUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    --connect-timeout "$TIMEOUT" \
    -H "x-admin-api-key: $ADMIN_KEY" \
    "${API_BASE}/ai/agents" 2>/dev/null || echo "000")
  if [ "$AUTH_STATUS" = "200" ]; then
    pass "Admin route with correct key → 200"
  else
    fail "Admin route with correct key → $AUTH_STATUS (expected 200)"
  fi
fi

# ─── 6. Public route accessibility ─────────────────────────────────────────
section "Public Routes"

PUBLIC_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --connect-timeout "$TIMEOUT" \
  "${API_BASE}/healthz" 2>/dev/null || echo "000")
if [ "$PUBLIC_STATUS" = "200" ]; then
  pass "GET /healthz (public) → 200"
else
  fail "GET /healthz → $PUBLIC_STATUS"
fi

# ─── 7. Rate limiter headers ────────────────────────────────────────────────
section "Security: Rate Limit Headers"

HEADERS=$(curl -s -I --connect-timeout "$TIMEOUT" \
  "${API_BASE}/healthz" 2>/dev/null || echo "")

if echo "$HEADERS" | grep -qi "ratelimit-limit"; then
  pass "RateLimit headers present"
else
  # /healthz may not be rate-limited — try an authenticated route
  if [ -n "$ADMIN_KEY" ]; then
    HEADERS2=$(curl -s -I --connect-timeout "$TIMEOUT" \
      -H "x-admin-api-key: $ADMIN_KEY" \
      "${API_BASE}/ai/agents" 2>/dev/null || echo "")
    if echo "$HEADERS2" | grep -qi "ratelimit-limit"; then
      pass "RateLimit headers present on /api routes"
    else
      fail "RateLimit headers missing from /api routes — check globalLimiter config"
    fi
  fi
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo "  ❌ DEPLOY GATE: FAILED" >&2
  exit 1
else
  echo "  ✅ DEPLOY GATE: PASSED"
  exit 0
fi
