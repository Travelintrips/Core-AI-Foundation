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

## Duplicate-job defense (19 November 2026)

Live CST-DEV indexes on `ai_platform.ai_jobs` have unique constraints for ID and `job_code`, **not** on `payload_json->>'requestId'`. A pilot RLS INSERT filter on requestId alone therefore cannot enforce exactly one job. The pilot role template no longer grants job INSERT (nor `ai_jobs_id_seq` usage). An authorized application workflow must first create one fresh, approved, queued Company-1 model job. The dedicated role may only read/update that exact request; attempts to INSERT even a duplicate request are denied by SQL privileges. The disposable PostgreSQL rehearsal now seeds the approved job as the owner, checks duplicate INSERT denial under the pilot role, and tests the original job-worker-event-audit flow plus full role/policy rollback. CI runs that isolated rehearsal with Docker `--network none`, without any CST-DEV or PROD database credentials.

Do not activate the role until an authorized fresh job exists and the runtime-specific identity/egress checks are independently established.

## 19 November 2026 — startup and exact-one-request audit

Isolated VPS boot attempts against candidate `9fabedcd` did not reach healthy status: the first small-memory boot hit V8 OOM; after raising the memory limit, the application correctly rejected missing/unverifiable Supabase DEV configuration. The failed containers and dedicated bridge were removed. Existing Core DEV remained healthy and Nginx routing unchanged. Do not bypass `assertDevelopmentDatabaseIsolation`, inject the old shared application DSN or assert runtime readiness from this test.

Read-only CST-DEV query confirms **zero queued** Company-1 pilot jobs. The readiness gate now requires exactly **one** database row per approved `requestId` (checked from the scoped connection), and Docker network inspection must prove `Internal=true`, `Driver=bridge` and exactly one candidate member. An externally routed bridge or duplicate matching job rejects admission. The original `9fabedcd` image predates the modified role SQL templates, so source equivalence must continue to fail until a fresh matching image is built and verified. This change is code-only: no DEV DB role/job creation, runtime activation, DNS/Nginx change, or PROD deployment.

## Database-wide requestId uniqueness prerequisite

An RLS-scoped login cannot establish uniqueness across rows it cannot see. The
one-job gate therefore requires a **valid, ready unique PostgreSQL index**
`ai_jobs_company1_pilot_request_unique` that covers the exact
`cst-ai-team-company1-dev:pilot-%` requestId namespace independent of job
type. The narrow additive index DDL is staged at
`scripts/dev/cst-team-onejob-unique-request-index.sql` and **has not been
applied to CST-DEV**. The disposable PostgreSQL rehearsal runs this DDL and
tests that a privileged fixture owner cannot insert a second request with a
different job type. Current live CST-DEV duplicate audit found no duplicate
pilot requestId, but this alone does not substitute for an enforced index.

Preflight must report `PILOT_DB_UNIQUE_REQUEST_CONSTRAINT_MISSING` until a
separately reviewed, authorized DEV-only migration exists and PostgreSQL
catalog readback shows the index is `indisunique`, `indisvalid`, and
`indisready`. No PROD index is required or authorized by this work.

## Image provenance mismatch discovered in VPS QA image (19 November 2026)

A no-network, no-credential one-shot inspection of image
`core-ai-dev:cst-onejob-9fabedcd-qa` found **different** provenance:
the Docker image label `cst.qa.source_commit` was
`9fabedcd4c10644d589e880cb62f583561c89a1c`, but its embedded
`/app/.cst-build-sha` was the old Core DEV SHA
`c26921475bf947614dd27f8e3e94720931942877`.
The image must **not** be admitted for a one-job pilot. Its API health
header can legitimately report the embedded older SHA, which is why label
verification alone was insufficient.

The read-only gate now reads `/app/.cst-build-sha` only from an already
running isolated candidate and requires exactly the same 40-character SHA as
the image label. Missing, malformed, or stale marker fails with
`IMAGE_BUILD_SHA_MARKER_MISMATCH`. The new Dockerfile stamping logic must be
used in a **fresh candidate image** and independently verified before
introducing a short-lived CST-DEV database role. This change does not start
workers or authorize job execution.

## Portable prelaunch Docker provenance verification

The GitHub QA image job from exact commit `fb1a6f258c87335d038e40e10ee4a6503b8eddab`
passed label/embedded source-marker readback on the hosted runner, with no deploy.
That image was not uploaded to the VPS. Historical VPS candidates `9fabedcd`
and `f9c3b61f` both retain old internal marker `c2692147` and are ineligible.

Once an exact-source image has been transferred by an authorized immutable
artifact mechanism, run the new non-deploy check before any boot:

```bash
node scripts/dev/cst-team-onejob-image-provenance.mjs \
  core-ai-dev:cst-onejob-<source8>-qa <40-character-source-sha>
```

The command reads Docker labels and an embedded marker via a throwaway
`--network none --entrypoint cat` container. It will not start the Core
application, connect to a database, issue a credential or alter services.
Never tag an old image as a new source to pass this test.

VPS capacity during audit: filesystem free approximately 38 GiB; system swap
approximately 6053/6143 MiB used. Avoid resource-heavy source/image builds on
the shared VPS until capacity is demonstrably available; prefer an independently
built, immutable QA image artifact with cryptographic identity verification.
The GitHub workflow does not presently publish an artifact, so image transfer
is still a separate unresolved step. No production promotion is authorized.
