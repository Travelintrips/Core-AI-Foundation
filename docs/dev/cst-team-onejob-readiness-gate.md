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
no ports bound publicly. The future dedicated DEV endpoint
`dev-aicore.cstlogistic.co.id` must resolve and return `x-cst-source-commit`
matching the current source commit or an independently proven code-equivalent
ancestral candidate. Do **not** substitute the PROD hostname.

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
was no running blue-green candidate, no DNS record for the dedicated DEV
hostname, no dedicated one-job role, and no newly queued Company-1 model
pilot. Existing Core DEV still uses the older image and job #482 remains
untouched. **No attempt to bypass these blockers should be made.**

Unit regression: `node --test scripts/dev/cst-team-onejob-readiness-gate.test.mjs`.
