# Issue238 — CST-DEV read-only claim verification

Deploy baseline: certified exact `develop` commit `82c0bba416329d1c7ddc9c5ff495efa83b557769`,
which matches the live `core-ai-dev` Docker image, its source router hash and
`/opt/cst-vps-dev-release/source` checkout. Do not deploy from the dirty
`/opt/core-ai-workers` checkout or the older `main` branch.

This patch adds only the scoped read-only Issue238 active-claim GET, seven
isolated tests and two agent-runtime router lines. The existing worker-issuer
route, GPT02 Owner ledger functionality and all other DEV routes remain intact.
The endpoint reads authoritative, unexpired matching AI Core command/task
IDs and does not issue Owner consent, permits or QA runs.

Production financial tables and actor enablement are outside this change.
The immutable develop-SHA release process must pass all CI, verified canary,
exact SHA health, rollback and unchanged PROD checks before declaring deployment.
A successful deployment does NOT mean QA PostgreSQL or Invoice #108 E2E PASS.
