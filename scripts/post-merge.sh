#!/bin/bash
set -euo pipefail

# Keep imported workspace setup deterministic and validate the shared runtime
# before Replit reconciles the artifact-owned workflows.
pnpm install --frozen-lockfile
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run build
