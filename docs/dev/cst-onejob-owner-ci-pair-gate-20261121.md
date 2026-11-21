# CST-DEV Owner UI/API pair — source-only CI artifact admission

## Context

The existing DEV site dev.cstlogistic.co.id currently serves frontend build
858efc5a3a3a588f5a638ed40aec6168c69e3a83 on the existing healthy
core-ai-dev container. The Owner page and API are present in Core draft
PR #1769 but **not** in the active DEV deployment.

The conventional VPS DEV release helper starts autonomous/dispatcher
capabilities. Do **not** use that generic deployment helper to make the
Owner button visible. The new one-job pilot is a strictly bounded,
single-Owner-action workflow with independently approved signer custody,
no KMS, and no PROD changes.

## New read-only gate

`scripts/dev/cst-onejob-ci-pair-readonly-gate.py` verifies the immutable
GitHub Actions artifact **before** any isolated promotion. It never extracts
or deploys the ZIP. Its invocation requires:

- GitHub run result SUCCESS, verified CI head SHA, current Draft PR head SHA
  (must be equal to the CI head), and independently verified PR **merge
  commit SHA** used by GitHub's pull_request runner.
- The SHA-256 of the downloaded artifact ZIP must equal GitHub Actions
  published artifact digest.
- One and only one main frontend JavaScript asset, frontend `index.html`,
  frontend `build-meta.json` with the exact CI merge SHA, and the **matching
  compiled API** `api-server/dist/index.mjs` inside that **same ZIP**.
- Compiled frontend must contain `Setujui satu job DEV`, Owner GET
  readiness and Owner POST action markers. Compiled API must contain both
  endpoints. Unsafe ZIP paths, duplicate names and symlinks are rejected.

The output always retains `releaseDecision=NO_GO`, even when the source
pair is consistent: a coherent, authenticated and formally approved DEV
deployment plus an actual Owner session are separate requirements.
It does not inspect passwords, approve a job, grant DB roles, start a
signer or dispatcher, or touch PROD.

## Actual local proof, 21 Nov 2026

- **13/13** synthetic positive/negative tests pass.
- A previously downloaded, hash-verified artifact for PR head
  `9aabc876f435d5276236b4846419002d55d1384d` / GitHub merge
  `f12c516d7aa5ad2f8c74e7be17f86fdf10cd3301` is confirmed internally
  consistent with matching frontend and API, but the gate **DENIES** it
  against the newer live PR head
  `c7dce4cb6f53961824c257007cebdfda0e9c8285` as
  `STALE_CI_HEAD_NOT_CURRENT_DRAFT`.
- The previous frontend and API were HTTP smoke-tested together on VPS
  using only localhost / a network-disabled synthetic-DB container;
  authenticated Owner E2E was **not** performed and the preview was removed.

## Next bounded operational sequence (not implemented by this tool)

1. Obtain the latest verified CI artifact, verify the PR head and merge SHA,
   and run the read-only gate.
2. Only after a DEV release review, stage matching frontend+backend into a
   separate loopback-only preview with background jobs/dispatcher OFF,
   authentication enforced, and rollback. Do not change the existing DEV
   static files or container until the paired preview passes.
3. Separately obtain legitimate operator root/approved per-role signer keys,
   auditable Owner approval, bounded writer/login policy, and one single
   Company-1 DEV job up through the independent 4+1 Hub Final ACK.
4. No use of Google KMS and never call this source-only result an
   operational PASS.
