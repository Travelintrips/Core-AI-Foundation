#!/bin/bash
# security-scan.sh — Scan repository for plaintext secrets.
# Usage: pnpm security:scan-secrets
# Fails (exit 1) if any secrets are detected.
# Safe to run in CI — never prints secret values.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FOUND=0
REPORT=()

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

# Files and directories to exclude from scanning
EXCLUDE_PATTERNS=(
  ".git"
  "node_modules"
  "dist"
  ".pnpm-store"
  "*.lock"
  "pnpm-lock.yaml"
  "*.map"
  ".env.example"
  "ROTATION_REQUIRED.md"
  "BASELINE_REPORT.md"
  "PRODUCTION_ENVIRONMENT_CHECKLIST.md"
  "scripts/security-scan.sh"
  "attached_assets"
)

build_exclude_args() {
  local args=()
  for pat in "${EXCLUDE_PATTERNS[@]}"; do
    args+=("--exclude-dir=$pat" "--exclude=$pat")
  done
  echo "${args[@]}"
}

scan() {
  local desc="$1"
  local pattern="$2"
  local exclude_args
  exclude_args=$(build_exclude_args)

  # shellcheck disable=SC2086
  matches=$(grep -rn --include="*.ts" --include="*.js" --include="*.json" \
    --include="*.toml" --include="*.yaml" --include="*.yml" \
    --include="*.md" --include="*.sh" --include="*.env" \
    $exclude_args \
    -E "$pattern" "$REPO_ROOT" 2>/dev/null || true)

  if [ -n "$matches" ]; then
    REPORT+=("FAIL: $desc")
    # Print file:line but mask value
    while IFS= read -r line; do
      file=$(echo "$line" | cut -d: -f1)
      lineno=$(echo "$line" | cut -d: -f2)
      REPORT+=("  → $file:$lineno")
    done <<< "$matches"
    FOUND=$((FOUND + 1))
  fi
}

echo ""
echo "=== Secret Scanner ==="
echo "Scanning: $REPO_ROOT"
echo ""

# Known API key prefixes
scan "OpenAI API key prefix (sk-proj-* or sk-*)" \
  '"sk-(proj-|ant-api|[A-Za-z0-9]{48})[^"]*"'

scan "Anthropic API key prefix" \
  '"sk-ant-api[0-9]+-[A-Za-z0-9_-]{90,}"'

scan "Replicate API token prefix" \
  '"r8_[A-Za-z0-9]{32,}"'

scan "Supabase service role JWT" \
  '"eyJ[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]{10,}"'

scan "Supabase DB URL with password" \
  'postgresql://[^@]+:[^@]{8,}@[a-z0-9.-]+\.supabase\.com'

scan "Plaintext password assignment" \
  '(SMTP_PASS|PASSWORD|_PASS)\s*=\s*"[^<][^"]{6,}"'

scan "Generic token pattern (long hex)" \
  '(TOKEN|SECRET|API_KEY)\s*=\s*"[A-Fa-f0-9]{32,}"'

# Check .replit specifically
echo "--- Checking .replit ---"
if [ -f "$REPO_ROOT/.replit" ]; then
  if grep -qE '(sk-|r8_|eyJ|postgresql://[^:]+:[^@]+@)' "$REPO_ROOT/.replit" 2>/dev/null; then
    REPORT+=("FAIL: .replit contains plaintext credentials in [userenv.*] blocks")
    FOUND=$((FOUND + 1))
    echo -e "${YELLOW}  WARNING: .replit contains secrets. See ROTATION_REQUIRED.md.${NC}"
  else
    echo -e "${GREEN}  .replit appears clean.${NC}"
  fi
fi

echo ""
echo "--- Scan Results ---"

if [ ${#REPORT[@]} -eq 0 ]; then
  echo -e "${GREEN}✓ No secrets detected.${NC}"
  exit 0
else
  for line in "${REPORT[@]}"; do
    if [[ "$line" == FAIL:* ]]; then
      echo -e "${RED}$line${NC}"
    else
      echo -e "${YELLOW}$line${NC}"
    fi
  done
  echo ""
  echo -e "${RED}✗ $FOUND secret pattern(s) detected. See ROTATION_REQUIRED.md.${NC}"
  exit 1
fi
