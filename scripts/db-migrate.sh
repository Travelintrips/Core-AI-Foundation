#!/bin/bash
# db-migrate.sh — Run all pending DDL migrations in scripts/migrations/.
#
# Usage:
#   pnpm db:migrate             — apply all pending migrations
#   pnpm db:migrate:status      — show which migrations have been applied
#   pnpm db:migrate:dry-run     — show SQL that WOULD be run without applying
#
# Exit code: 0 = success, 1 = error.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"
MODE="${1:-apply}"   # apply | status | dry-run

# Resolve DB URL: prefers SUPABASE_PROD_DATABASE_URL in production
if [ "${NODE_ENV:-development}" = "production" ]; then
  DB_URL="${SUPABASE_PROD_DATABASE_URL:-${SUPABASE_DATABASE_URL:-}}"
else
  DB_URL="${SUPABASE_DEV_DATABASE_URL:-${SUPABASE_DEV_DATABASE_URL:-}}"
fi

if [ -z "$DB_URL" ]; then
  echo "ERROR: No database URL found. Set SUPABASE_DEV_DATABASE_URL (dev) or SUPABASE_PROD_DATABASE_URL (prod)." >&2
  exit 1
fi

PSQL="psql $DB_URL"

# Ensure tracking table exists
$PSQL -q -c "
  CREATE SCHEMA IF NOT EXISTS ai_platform;
  CREATE TABLE IF NOT EXISTS ai_platform.schema_migrations (
    version    TEXT NOT NULL PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checksum   TEXT
  );
" 2>&1

get_applied() {
  $PSQL -tAq -c "SELECT version FROM ai_platform.schema_migrations ORDER BY version;" 2>/dev/null || echo ""
}

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo -e "${YELLOW}No migrations directory found at $MIGRATIONS_DIR${NC}"
  exit 0
fi

APPLIED=$(get_applied)
PENDING=()
APPLIED_LIST=()

for file in "$MIGRATIONS_DIR"/*.sql; do
  [ -f "$file" ] || continue
  version=$(basename "$file" .sql)
  if echo "$APPLIED" | grep -qx "$version"; then
    APPLIED_LIST+=("$version")
  else
    PENDING+=("$version")
  fi
done

if [ "$MODE" = "status" ]; then
  echo ""
  echo "=== Migration Status ==="
  echo ""
  echo "Applied (${#APPLIED_LIST[@]}):"
  for v in "${APPLIED_LIST[@]}"; do
    echo -e "  ${GREEN}✓ $v${NC}"
  done
  echo ""
  echo "Pending (${#PENDING[@]}):"
  for v in "${PENDING[@]}"; do
    echo -e "  ${YELLOW}○ $v${NC}"
  done
  echo ""
  if [ ${#PENDING[@]} -eq 0 ]; then
    echo -e "${GREEN}All migrations applied.${NC}"
  else
    echo -e "${YELLOW}${#PENDING[@]} pending migration(s). Run: pnpm db:migrate${NC}"
  fi
  exit 0
fi

if [ "$MODE" = "dry-run" ]; then
  echo ""
  echo "=== Dry Run — SQL that WOULD be applied ==="
  echo ""
  if [ ${#PENDING[@]} -eq 0 ]; then
    echo "No pending migrations."
    exit 0
  fi
  for v in "${PENDING[@]}"; do
    echo "--- $v ---"
    cat "$MIGRATIONS_DIR/$v.sql"
    echo ""
  done
  exit 0
fi

# apply mode
if [ ${#PENDING[@]} -eq 0 ]; then
  echo -e "${GREEN}✓ No pending migrations.${NC}"
  exit 0
fi

echo ""
echo "=== Applying ${#PENDING[@]} migration(s) ==="
echo ""

FAILED=0
for v in "${PENDING[@]}"; do
  echo -n "  Applying $v ... "
  if $PSQL -q -f "$MIGRATIONS_DIR/$v.sql" 2>&1; then
    # Record in tracking table
    $PSQL -q -c "INSERT INTO ai_platform.schema_migrations (version) VALUES ('$v') ON CONFLICT DO NOTHING;"
    echo -e "${GREEN}OK${NC}"
  else
    echo -e "${RED}FAILED${NC}"
    FAILED=$((FAILED + 1))
    echo "  Run manually: psql \$DB_URL -f $MIGRATIONS_DIR/$v.sql"
    break  # stop on first failure to avoid partial state
  fi
done

echo ""
if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ All migrations applied.${NC}"
  exit 0
else
  echo -e "${RED}✗ $FAILED migration(s) failed.${NC}"
  exit 1
fi
