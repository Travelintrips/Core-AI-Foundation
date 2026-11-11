#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ESBUILD="$ROOT/artifacts/api-server/node_modules/.bin/esbuild"
OUTPUT_DIR="${GPT02_ISSUER_READER_OUTPUT_DIR:-$ROOT/dist/issuer-reader-runtime}"
OUTPUT="$OUTPUT_DIR/gpt02-issuer-reader-runtime.mjs"

if [[ ! -x "$ESBUILD" ]]; then
  echo "GPT02_ISSUER_READER_ESBUILD_REQUIRED" >&2
  exit 2
fi

mkdir -p "$OUTPUT_DIR"
"$ESBUILD" "$ROOT/scripts/dev/gpt02-issuer-reader-runtime.ts" \
  --bundle \
  --platform=node \
  --format=esm \
  --target=node18 \
  --external:pg \
  --outfile="$OUTPUT"

chmod 0755 "$OUTPUT"
node --check "$OUTPUT"
printf 'GPT02_ISSUER_READER_RUNTIME_BUILD=PASS\n'
