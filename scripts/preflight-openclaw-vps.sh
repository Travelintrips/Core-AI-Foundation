#!/usr/bin/env bash
# Non-destructive safety gate before installing the existing AI Core OpenClaw worker stack on a VPS.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${AI_WORKERS_ENV_FILE:-/etc/ai-core/ai-workers.env}"
STACK="$ROOT/deploy/ai-workers/docker-compose.yml"
fail() { printf '[openclaw-vps-preflight] BLOCKED: %s\n' "$*" >&2; exit 1; }
check() { printf '[openclaw-vps-preflight] OK: %s\n' "$*"; }
command -v docker >/dev/null || fail 'Docker is not installed'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is unavailable'
docker info >/dev/null 2>&1 || fail 'Cannot access Docker daemon'
check 'Docker available'
test -f "$STACK" || fail 'AI Core worker compose is missing'
test -f "$ENV_FILE" || fail "Protected worker environment is missing ($ENV_FILE)"
# Only inspect variable names/presence, never echo credential values.
for key in AI_CORE_SCOPED_AGENT_TOKEN OPENCLAW_GATEWAY_TOKEN; do
  if ! awk -v k="$key" 'index($0,k"=")==1 && length(substr($0,length(k)+2))>0 {found=1} END {exit !found}' "$ENV_FILE"; then
    fail "$key must be provisioned before VPS installation"
  fi
done
check 'Scoped agent token and gateway token present'
# Explicitly protect a shared Hostinger VPS running the existing production WA Gateway.
if docker ps --format '{{.Names}}' | grep -Eiq '(^|[-_])(wa[-_]gateway|cst[-_]wa|whatsapp)([-_]|$)'; then
  printf '[openclaw-vps-preflight] NOTICE: Existing WhatsApp containers detected; do not restart or prune them.\n'
fi
# This is a *separate* compose project, never the WA Gateway production compose.
if grep -Eq '^COMPOSE_PROJECT_NAME=(wa[-_]?gateway|cst[-_]?wa[-_]?gateway)$' "$ENV_FILE"; then
  fail 'Worker compose project name conflicts with a WA Gateway project'
fi
check 'Worker compose project is separately scoped'
# Avoid accidental second worker registration for canonical gcp-openclaw-main.
if docker ps --format '{{.Names}}' | grep -Eq '^ai-core-workers[-_]openclaw[-_]'; then
  printf '[openclaw-vps-preflight] NOTICE: An AI Core OpenClaw stack already exists on this host.\n'
fi
printf '[openclaw-vps-preflight] PRECHECK PASSED (read-only). No containers were changed.\n'
printf '[openclaw-vps-preflight] IMPORTANT: canonical worker ID gcp-openclaw-main must not run concurrently on another host.\n'
