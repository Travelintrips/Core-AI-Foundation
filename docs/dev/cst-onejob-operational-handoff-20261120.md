# CST-DEV one-job: operational handoff and evidence gates

Status: **NO-GO**. This is a review checklist, not a provisioning script, credential, migration, authorization, or deployment instruction. It does not grant permission to merge PR #1767.

## Verified baseline (20 Nov 2026)

- Exact source head before this documentation: `0bb5db158c9999058d98660a32b12b0edabdf601`. CI #44610813309: build, full suite, static/typecheck, Final CI Verify SUCCESS; deploy skipped.
- CST-DEV Supabase project: `xssrfshdrtdfupgqwfdw` (never PROD). `cst_team_model_pilot_stage_login` and `cst_team_model_pilot_writer` exist, both NOLOGIN.
- Owner approval count 0; global waiting/queued ai_jobs count 0; receipt and nonce-consumption tables not installed.
- VPS `srv1792369`: existing `core-ai-dev` healthy. Staging secret file and QA trust directories absent. No matching one-job/independent-QA systemd service identified in unit-file listing.
- Existing generic enqueue denial, Ed25519 check, signed-claim/locked-row review, sequential replay, rollback, and concurrent replay have synthetic CI coverage; these are **not live permissions**.

## Required independent authorizations before any live change

1. An authorized security/operations custodian must approve a **dedicated CST-DEV-only** secret provisioner and access path. The previous bootstrap was stopped by an execution safety control: do **not** retry it using another account, CLI, tunnel or workaround. Do not put passwords or connection URLs into GitHub, chat, logs, shell history, or migration files.
2. Separate independent QA custodian must approve verifier identity, key generation/custody and evidence acquisition. Never reuse GPT02 signers or Core AI application identity, and never place a private QA signing key on the inspected service.
3. A separate reviewer must approve receipt RLS privileges, broker transaction design, row-locking and audit/event/subscriber ownership before applying proposed receipt SQL. Never treat a valid signature alone as authorization.
4. Only after those approvals can an operator schedule a scoped DEV change with rollback and change record. Keep PR Draft and active Core AI runtime unchanged until change window; no PROD access.

## Acceptance sequence — all evidence is needed

A. **Staging service identity:** approved secret custody; verify exact DEV project, transaction pooler port 6543, TLS verify-full, dedicated login only, max one connection. Verify no login from shared `aicore_dev_runtime`, `anon`, or `authenticated`; role changes limited to `SET LOCAL ROLE` inside an authorized transaction. Do not activate dispatcher, signer, or queue transition. Credentials must never appear in evidence.
B. **Independent QA:** prove pinned public key root-owned and not writable by the application; source evidence obtained outside inspected app; verifier identity, image SHA/digest, worker, nonce, expiration, approval and job IDs bound. QA private key stays separate; record independent reviewer.
C. **Receipt/broker in isolated DEV:** reviewed migration and grants; prove FOR UPDATE/atomic receipt consumption + job/approval/audit, rejection of forged, expired, replayed and concurrent receipts, error rollback and RLS from actual dedicated roles. Broker must remain fail-closed until independently verified.
D. **Controlled one-job E2E:** authenticate one Owner once, stage exactly one new waiting job (never historic #482), independent pre-admission verification, authorized waiting->queued only after gates, then observe execution/event/subscriber receipt and independent final reconciliation/Final ACK. No blanket worker/signer activation.
E. **Release decision:** retain NO-GO unless each gate has a named reviewer, exact runtime/source hashes, timestamps, independently captured logs, rollbacks and zero unexpected jobs. A healthy container or CI PASS does not satisfy the gate.

## Blockers at this baseline

`DEDICATED_STAGING_LOGIN_DISABLED`, `STAGE_SECRET_NOT_INSTALLED`, `INDEPENDENT_QA_PUBLIC_ROOT_MISSING`, `INDEPENDENT_QA_ISSUER_NOT_VERIFIED`, `ONE_USE_BROKER_NOT_VERIFIED`, `SUBSCRIBER_RECEIPT_NOT_VERIFIED`, `INDEPENDENT_FINAL_ACK_NOT_VERIFIED`.

No human second approval of the Owner business action is required. Independent QA reviews technical evidence, not the Owner's decision.
