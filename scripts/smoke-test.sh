#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# WP-13: Post-deploy smoke test
#
# Verifies the deployed application is serving real traffic correctly.
# Lighter than pre-deploy-check.sh — focused on end-to-end happy paths.
#
# Usage:
#   API_BASE_URL=https://<replit-dev-domain>/api \
#   ADMIN_API_KEY=<key> \
#   bash scripts/smoke-test.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

API_BASE="${API_BASE_URL:-http://localhost:8080}"
ADMIN_KEY="${ADMIN_API_KEY:-}"
TIMEOUT=20
PASS=0
FAIL=0

pass() { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1" >&2; ((FAIL++)) || true; }
warn() { echo "  ⚠  $1"; }
section() { echo ""; echo "── $1"; }

echo "═══════════════════════════════════════════════════"
echo "  AI Platform — Smoke Test"
echo "  Target: $API_BASE"
echo "  $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "═══════════════════════════════════════════════════"

auth_header() {
  if [ -n "$ADMIN_KEY" ]; then
    echo "-H \"x-admin-api-key: $ADMIN_KEY\""
  fi
}

# ─── Helper: call and check ───────────────────────────────────────────────────
check() {
  local label="$1"
  local expected_status="$2"
  local url="$3"
  shift 3
  local extra_args=("$@")

  local actual_status
  actual_status=$(curl -s -o /dev/null -w "%{http_code}" \
    --connect-timeout "$TIMEOUT" \
    "${extra_args[@]+"${extra_args[@]}"}" \
    "$url" 2>/dev/null || echo "000")

  if [ "$actual_status" = "$expected_status" ]; then
    pass "$label → HTTP $actual_status"
  else
    fail "$label → HTTP $actual_status (expected $expected_status)"
  fi
}

check_body() {
  local label="$1"
  local pattern="$2"
  local url="$3"
  shift 3
  local extra_args=("$@")

  local body
  body=$(curl -s --connect-timeout "$TIMEOUT" \
    "${extra_args[@]+"${extra_args[@]}"}" \
    "$url" 2>/dev/null || echo "")

  if echo "$body" | grep -q "$pattern"; then
    pass "$label (body contains '$pattern')"
  else
    fail "$label (expected body containing '$pattern', got: ${body:0:200})"
  fi
}

# ─── 1. Health checks ────────────────────────────────────────────────────────
section "Health"
check "Liveness /healthz" "200" "${API_BASE}/healthz"
check_body "Liveness body" '"status"' "${API_BASE}/healthz"
check "Readiness /healthz/full" "200" "${API_BASE}/healthz/full"

# ─── 2. Unauthenticated access to admin routes ────────────────────────────────
section "Auth Guard"
check "No-key → admin agents 401" "401" "${API_BASE}/ai/agents"
check "No-key → admin jobs 401" "401" "${API_BASE}/ai/jobs"
check "No-key → observability 401" "401" "${API_BASE}/ai/observability/cost-summary"

# ─── 3. Authenticated admin routes ────────────────────────────────────────────
if [ -n "$ADMIN_KEY" ]; then
  section "Authenticated Admin Routes"
  check "Agents list" "200" "${API_BASE}/ai/agents" -H "x-admin-api-key: $ADMIN_KEY"
  check "Models list" "200" "${API_BASE}/ai/models" -H "x-admin-api-key: $ADMIN_KEY"
  check "Providers list" "200" "${API_BASE}/ai/providers" -H "x-admin-api-key: $ADMIN_KEY"
  check "Jobs list" "200" "${API_BASE}/ai/jobs" -H "x-admin-api-key: $ADMIN_KEY"
  check "Cost summary" "200" "${API_BASE}/ai/observability/cost-summary" -H "x-admin-api-key: $ADMIN_KEY"
  check "Audit logs" "200" "${API_BASE}/ai/audit" -H "x-admin-api-key: $ADMIN_KEY"
fi

# ─── 4. Public catalog routes ─────────────────────────────────────────────────
section "Public Catalog"
check "Public catalog services" "200" "${API_BASE}/ai/catalog/public/services"
check "Public templates gallery" "200" "${API_BASE}/public/templates"
check "Public portfolio" "200" "${API_BASE}/public/portfolio"

# ─── 5. Security headers ─────────────────────────────────────────────────────
section "Security Headers"
HEADERS=$(curl -s -I --connect-timeout "$TIMEOUT" "${API_BASE}/healthz" 2>/dev/null || echo "")

for header in "x-content-type-options" "x-frame-options" "strict-transport-security"; do
  if echo "$HEADERS" | grep -qi "$header"; then
    pass "Header $header present"
  else
    warn "Header $header missing from /healthz (may only appear on full requests)"
  fi
done

# ─── 6. SSRF guard ────────────────────────────────────────────────────────────
if [ -n "$ADMIN_KEY" ]; then
  section "SSRF Guard"
  SSRF_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    --connect-timeout "$TIMEOUT" \
    -H "x-admin-api-key: $ADMIN_KEY" \
    -H "Content-Type: application/json" \
    -d '{"name":"test-provider","baseUrl":"http://169.254.169.254/latest/meta-data","slug":"test"}' \
    "${API_BASE}/ai/providers" 2>/dev/null || echo "000")
  if [ "$SSRF_STATUS" = "400" ]; then
    pass "SSRF attempt blocked (metadata IP → 400)"
  else
    fail "SSRF attempt not blocked (got $SSRF_STATUS, expected 400)"
  fi
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo "  ❌ SMOKE TEST: FAILED — investigate before promoting" >&2
  exit 1
else
  echo "  ✅ SMOKE TEST: PASSED — deployment healthy"
  exit 0
fi
