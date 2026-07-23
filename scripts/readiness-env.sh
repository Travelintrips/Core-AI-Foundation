#!/bin/bash
# readiness-env.sh — Validate production environment variables.
# Usage: pnpm readiness:env
# Reports SET / MISSING / INVALID — never prints values.

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

MISSING=0
INVALID=0
SET_COUNT=0

check() {
  local key="$1"
  local expected_value="${2:-}"   # optional: exact value it must equal
  local val="${!key:-}"

  if [ -z "$val" ]; then
    echo -e "${RED}  MISSING   $key${NC}"
    MISSING=$((MISSING + 1))
  elif [ -n "$expected_value" ] && [ "$val" != "$expected_value" ]; then
    echo -e "${YELLOW}  INVALID   $key (expected: $expected_value)${NC}"
    INVALID=$((INVALID + 1))
  else
    echo -e "${GREEN}  SET       $key${NC}"
    SET_COUNT=$((SET_COUNT + 1))
  fi
}

echo ""
echo "=== Production Readiness: Environment Variable Check ==="
echo "(Values are never printed — only SET / MISSING / INVALID)"
echo ""

echo "--- Runtime ---"
check NODE_ENV "production"
check PORT

echo ""
echo "--- AI Job Engine ---"
check AI_DISPATCHER_ENABLED "true"
check AI_SCHEDULER_ENABLED "true"

echo ""
echo "--- Application ---"
check PUBLIC_APP_URL
check ALLOWED_ORIGINS

echo ""
echo "--- Authentication ---"
check SESSION_SECRET
check ADMIN_API_KEY

echo ""
echo "--- Database ---"
if [ -n "${SUPABASE_PROD_DATABASE_URL:-}" ] || [ -n "${SUPABASE_DATABASE_URL:-}" ]; then
  echo -e "${GREEN}  SET       SUPABASE_PROD_DATABASE_URL (or alias)${NC}"
  SET_COUNT=$((SET_COUNT + 1))
else
  echo -e "${RED}  MISSING   SUPABASE_PROD_DATABASE_URL${NC}"
  MISSING=$((MISSING + 1))
fi
check SUPABASE_URL
check SUPABASE_SERVICE_ROLE_KEY
check SUPABASE_ANON_KEY
check SUPABASE_STORAGE_BUCKET

echo ""
echo "--- AI Providers ---"
check OPENAI_API_KEY
check ANTHROPIC_API_KEY
check GEMINI_API_KEY
check REPLICATE_API_TOKEN
check MISTRAL_API_KEY

echo ""
echo "--- Email ---"
check SMTP_HOST
check SMTP_PORT
check SMTP_USER
check SMTP_FROM
check SMTP_PASS

echo ""
echo "--- WhatsApp ---"
check FONNTE_TOKEN

echo ""
echo "=== Summary ==="
echo -e "${GREEN}  SET:     $SET_COUNT${NC}"
echo -e "${YELLOW}  INVALID: $INVALID${NC}"
echo -e "${RED}  MISSING: $MISSING${NC}"
echo ""

if [ "$MISSING" -gt 0 ] || [ "$INVALID" -gt 0 ]; then
  echo -e "${RED}✗ NOT READY. Fix MISSING and INVALID variables before deploying.${NC}"
  exit 1
else
  echo -e "${GREEN}✓ All required environment variables are set.${NC}"
  exit 0
fi
