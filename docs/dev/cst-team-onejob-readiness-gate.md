# CST AI Team — one-job DEV preflight (read-only)

This diagnostic is **not** a launcher, scheduler, credential provider or GPT02
approval mechanism. It refuses to claim pilot readiness until the **DEV-only**
blue-green candidate, database identity, fresh Company-1 model job and worker,
DNS route, enrollment guard and runtime source provenance are independently
observable. On any missing evidence it prints JSON `pilotAdmissionReady=false`,
exits **2**, and never creates jobs, roles, workers, signers or tokens.

Run on the authorized VPS from the exact checked-out Core PR source:

```bash
node scripts/dev/cst-team-onejob-readiness-gate.mjs core-ai-dev:cst-onejob-9fabedcd-qa
```

The optional image argument must be an exact tagged QA candidate; the probe
verifies its embedded source commit, or an ancestor whose intervening changes
have **no** differences in backend runtime or the bounded pilot RLS templates.
It checks the candidate container `cst-core-onejob-dev-candidate`, requiring
healthy status, identical image ID, non-host/non-production Docker network and
no ports bound publicly. The existing unified DEV endpoint
`dev.cstlogistic.co.id` must resolve, but its shared `/api/` Nginx route must
**remain on the existing healthy Core DEV container** during pilot preparation.
The candidate must instead bind port 3000 to a distinct 127.0.0.1-only port,
respond to a direct loopback `/api/healthz` request, and report an exact source
commit header (`x-cst-source-commit` or `x-cst-commit-sha`) matching the candidate
image label. This is a prelaunch provenance check, not an authorization to dispatch.
Do not cut over the shared DEV `/api/` merely to make a readiness check pass. The retired `dev-aicore.cstlogistic.co.id` Nginx vhost
must remain HTTP 410 (quarantined since 31 October 2026). Never re-enable
that retired endpoint or substitute the PROD hostname merely for a pilot.

For database verification the probe executes a *SELECT-only* PostgreSQL
transaction **inside the existing DEV container or healthy candidate**. It
reads the already-connected DEV DSN only in that container, first rejects a
project mismatch, and prints no DSN/password/token. It requires exactly one
safe, valid, short-lived dedicated pilot role and a fresh, **queued** Company-1
`ollama_model_invocation` job, never historic job #482. Worker identity must be
new and match `cst-dev-dell-onejob-YYYYMMDD-8hex`; role enrollment and exact
single-job guards must be active. A role that is expired, privileged, absent,
or invisible due to RLS is **not** treated as ready.

The diagnostic intentionally cannot verify independent agent delivery or QA
Final ACK, and always reports `operationalE2EVerified=false`,
`subscriberReceiptVerified=false`, `independentFinalAckVerified=false` even
when all preflight inputs are valid. Being ready for a controlled single-job
pilot does **not** authorize PROD, signer activation or multi-agent release.

## First live preflight, 19 November 2026 WIB

Read-only probe on VPS returned `pilotAdmissionReady=false` / exit 2. The
candidate image was correctly built from Core source `9fabedcd`, but there
was no running blue-green candidate, no verified routing of the active
unified DEV host to that candidate, no dedicated one-job role, and no newly
queued Company-1 model pilot. The retired host remains HTTP 410. Existing Core DEV still uses the older image and job #482 remains
untouched. **No attempt to bypass these blockers should be made.**

Unit regression: `node --test scripts/dev/cst-team-onejob-readiness-gate.test.mjs`.

## Shared DEV API isolation update, 19 November 2026

The VPS Nginx config currently points the unified DEV `/api/` route at the
existing healthy Core DEV runtime on loopback 18082. An initial stricter gate
incorrectly required routing the shared API to the candidate before the pilot.
This requirement was removed: the gate now refuses a premature shared-route
change and requires a separate, healthy candidate loopback endpoint with source
provenance. The retired `dev-aicore` HTTP 410 quarantine remains mandatory.
No candidate launch or shared Nginx change was performed as part of this edit.

## Dedicated network membership (19 November 2026)

The candidate must run on a Docker bridge named `cst-core-onejob-dev-net` with **exactly one member**, `cst-core-onejob-dev-candidate`. The gate verifies this via Docker network inspection, rejecting shared worker, QA and production bridges. Candidate HTTP port 3000 must bind to a distinct 127.0.0.1 host port; shared DEV Nginx continues pointing to the existing healthy Core DEV port 18082. **A dedicated bridge alone does not restrict outbound destinations**: verify approved DEV database destinations and egress controls separately before creating an authenticated pilot role or allowing job execution.

Live read-only CST-DEV catalog check: database `postgres`; role anchors `dev_gpt02_relock_catalog_auditor` and `aicore_dev_runtime` exist; RLS enabled on jobs/workers/events/audit_logs, all four expected sequences exist, no `cst_team_model_pilot_%` roles or `cst_model_pilot_%` policies; historical completed job #482 is the only job matching the pilot request prefix. Therefore do **not** provision the short-lived login yet or reuse #482. No database mutations performed.
