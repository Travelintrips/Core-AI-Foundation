#!/usr/bin/env bash
set -euo pipefail

CUSTODIAN_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CUSTODIAN_ESBUILD="$CUSTODIAN_REPO_ROOT/artifacts/api-server/node_modules/.bin/esbuild"
CUSTODIAN_OUTPUT="$CUSTODIAN_REPO_ROOT/artifacts/api-server/dist/gpt02-reader-custodian-runtime.cjs"

if [[ ! -x "$CUSTODIAN_ESBUILD" ]]; then
  echo "GPT02_DBA_CUSTODIAN_BUILD=BLOCKED code=ESBUILD_REQUIRED" >&2
  exit 2
fi

mkdir -p "$(dirname "$CUSTODIAN_OUTPUT")"
"$CUSTODIAN_ESBUILD" "$CUSTODIAN_REPO_ROOT/scripts/dev/gpt02-reader-custodian-runtime.ts" \
  --bundle --platform=node --format=cjs --target=node18 \
  --external:pg-native --outfile="$CUSTODIAN_OUTPUT"
chmod 0755 "$CUSTODIAN_OUTPUT"
node --check "$CUSTODIAN_OUTPUT"
printf 'GPT02_DBA_CUSTODIAN_BUILD=PASS\n'
