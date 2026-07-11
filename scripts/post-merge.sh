#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db run push || echo "Schema push skipped/incomplete (likely a pending interactive confirmation) — apply pending schema changes manually via SQL. See .agents/memory/drizzle-push-false-positive.md"
