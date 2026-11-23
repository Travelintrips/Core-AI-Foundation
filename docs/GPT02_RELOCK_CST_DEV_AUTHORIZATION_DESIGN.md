# GPT02 CST-DEV Relock — Delegation and Owner Authorization Design

Status: **design proposal; not deployed and not an execution authorization**  
Related work: Core-AI-Foundation #1782; AI-Task-Hub #208  
Target only: Supabase CST-DEV project `xssrfshdrtdfupgqwfdw` and VPS `srv1792369`.

## 1. Purpose and non-goals

This design lets the Owner appoint the canonical OpenClaw VPS worker as the PIC for a narrowly scoped GPT02 security relock. It preserves a separation between (a) the Owner's delegation of coordination and (b) an explicit, short-lived approval decision authenticated by a fresh CST Hub-signed Google Super Admin session and bound to the exact immutable action manifest. This is a session-authenticated Owner decision, not a detached signature over the manifest.

It does **not** grant OpenClaw a general administrator identity, arbitrary shell, general database access, access to secrets, signing-key custody, dispatch authority, GitHub merge/deploy authority, or any PROD capability. It does not reuse Task #189 approval records, request IDs, nonces, digests, or release markers.

## 2. Identities and authority layers

### 2.1 Canonical worker principal

The CST-DEV registry snapshot identified `openclaw-vps-main` as the active, healthy OpenClaw VPS principal, with role `bounded_orchestration_agent` and capabilities `task:coordinate` and `tools:bounded`. `openclaw-vps-dev-consumer` was not present in the checked registry snapshot. Registration must re-check the live registry immediately before activation; do not hard-code a guessed alias.

### 2.2 Owner delegation (assignment only)

Persist a delegation record with:
- verified Owner/delegator subject from the trusted CST identity/Hub chain;
- principal `openclaw-vps-main` (must be present, healthy, canonical, and lease-active at registration and use time);
- fixed task scope `GPT02_RELOCK_CST_DEV`;
- environment `DEV` and exact Supabase project ID `xssrfshdrtdfupgqwfdw`;
- exact host identity `srv1792369`;
- allowed non-mutating operations: inspect the four role attributes without reading password/hash values, count role sessions, count open watchdog windows, inspect systemd unit properties, inspect credential-file metadata only, prepare evidence, and coordinate the authorized run;
- expiry, issuer, creation time, unique delegation ID, revocation timestamp/status, and append-only audit reference.

Delegation allows OpenClaw to coordinate and perform the explicitly listed read-only checks. It does not authorize security mutations by itself.

### 2.3 One-use Owner mutation authorization

Before any mutation, the Owner must review the exact immutable manifest in the trusted CST Owner interface and submit an explicit `APPROVE` decision while holding a fresh, cryptographically verified CST Hub-signed Google Super Admin session. The session verifier must validate the Hub signature/issuer/audience/expiry and the actor claims; a separate read-only eligibility check must prove the exact active Owner operator link. The action is then bound server-side to:
- request ID, delegation ID, canonical worker ID, Owner subject and Supabase Auth user ID;
- environment `DEV`, exact project ID, exact VPS identity;
- exact four role names and target states;
- exact systemd timer and service unit names;
- exact permitted operation identifiers (not caller-supplied shell strings or free-form SQL);
- required preconditions and postconditions from section 3;
- issue/expiry timestamps, unique 256-bit nonce, manifest digest, challenge ID, and hash of the verified signed session.

The challenge expires after 120 seconds. The Owner approval endpoint re-verifies the signed Hub session and active Owner eligibility, requires the exact manifest digest displayed to the Owner, and consumes the nonce atomically before recording the decision. Duplicate, concurrent, expired, cross-Owner, cross-project, or digest-mismatched approvals fail closed. Only the signed-session hash is retained; the bearer token is never stored or logged. The decision ledger is append-only and the database trigger verifies that the decision matches a previously consumed challenge.

This proof is **not a detached Ed25519 signature made by an Owner private key**. It is an explicit Owner decision authenticated by the existing trusted CST Hub-signed session and bound to the exact action digest/nonce. It must never be described as a detached signature. If the Owner identity/session chain cannot be independently verified, the approval is rejected.

A GitHub comment, chat message, WhatsApp reply, boolean metadata flag, generic `SECURITY_CHANGE` token, Task #189 approval record, or an OpenClaw statement is not a substitute for this fresh, challenge-bound Owner decision.

## 3. Exact relock manifest and gates

### 3.1 Database role targets

Read-only preflight must establish all four roles exist. The Owner-approved manifest may authorize only these targets:

| Role | `rolcanlogin` | `rolconnlimit` | Password-presence state |
|---|---:|---:|---|
| `dev_gpt02_relock_catalog_auditor` | false | 0 | present (`rolpassword IS NOT NULL`) |
| `dev_gpt02_attestor_evidence` | false | 0 | absent (`rolpassword IS NULL`) |
| `dev_gpt02_issuer_evidence` | false | 0 | absent (`rolpassword IS NULL`) |
| `gpt02_issuer_evidence_reader` | false | 0 | absent (`rolpassword IS NULL`) |

Only presence booleans may be read; never select, print, export, or log password/verifier material. No other role, grant, membership, owner, schema, table, function, or policy may be changed.

### 3.2 Database preconditions and postconditions

Preflight must return exactly 4/4 target roles and verify target project identity. Count active `pg_stat_activity` sessions for the four roles; expected count is 0 before the change. Count `gpt02_relock_audit.writer_issuance_watchdog` rows with `cleaned_at IS NULL`; expected count is 0. If either count is non-zero or cannot be read, refuse execution and report evidence; do not terminate sessions or clean rows automatically.

After execution, repeat every role invariant, session count, and watchdog count. Any mismatch is `FAILED/NEEDS_OWNER_REVIEW`; do not attempt an automatic compensating mutation.

### 3.3 VPS systemd and credential metadata

The only systemd targets are:
- `gpt02-issue159-relock-catalog-auditor.timer` — expected `inactive` and `disabled` after the authorized operation;
- `gpt02-issue159-relock-catalog-auditor.service` — must be idle/inactive before any stop action is considered.

Before touching the timer, inspect timer/service state and recent activation metadata. If the service is running/activating, or a new trigger is unexplained, refuse timer mutation and escalate for investigation. Do not kill a process or stop a running service as a workaround.

Credential verification is metadata-only: prove the configured `LoadCredentialEncrypted` source is an existing regular file (not symlink), owner `root:root`, mode exactly `0600`, and expected encrypted-file classification/size bounds if the service contract defines them. Never decrypt, read, copy, hash for display, or print its content. If the source path cannot be identified from trusted unit metadata, report `UNVERIFIED` and do not guess.

### 3.4 Atomicity, idempotency, and one-use execution

The approval service must atomically consume the one-use challenge nonce when the Owner submits the challenge-bound decision; a separate executor must verify the recorded decision and bind it to the same immutable manifest digest before any mutation. Duplicate, concurrent, or replayed calls must be rejected. Each operation must be an enumerated constant mapped to fixed SQL/systemd helper code; no raw SQL, shell command, unit name, role name, project ID, or path may come from worker-controlled free-form input.

Record an append-only audit trail with request/delegation IDs, actor, worker ID, manifest digest, action IDs, timestamps, before/after booleans/counts, and terminal result. Do not place secrets in the audit payload.

## 4. Execution architecture

1. Owner registers the bounded delegation; system confirms exact canonical OpenClaw principal and stores expiry/revocation state.
2. OpenClaw uses its own principal to conduct read-only preflight and prepare a redacted evidence packet.
3. The Owner reviews the exact manifest in the trusted CST Owner interface and submits `APPROVE` using a fresh Hub-signed Google Super Admin session, under a **new GPT02-specific request ID, nonce and digest**.
4. A server-side GPT02-specific verifier checks Hub session signature/claims, exact Owner operator eligibility, owner subject, delegation, scope, manifest digest, nonce, preconditions and expiry.
5. A dedicated least-privilege executor exposes only the enumerated role and timer operations. It must not provide an interactive shell or generic SQL execution.
6. OpenClaw observes execution and runs the independent postflight. It cannot rewrite the approval or postflight result.
7. The system marks completion only after exact postflight evidence; otherwise it remains failed/blocked for Owner review.

The generic `agent:work` queue may carry coordination/read-only jobs only. It must not be treated as the security mutation gate. The `criticalActionsRequireAiCoreApproval` metadata flag is informational unless the server actually enforces it.

## 5. Required fail-closed test matrix

- Valid fresh Hub-signed Owner session, exact Owner link, exact manifest, active delegation, correct DEV project/host, unused nonce, passing preflight: decision record accepted.
- Missing/invalid/expired Hub session, wrong Owner, wrong issuer/audience, failed Owner link, or verification service unavailable: reject.
- Wrong project ID, PROD environment, wrong host, wrong role, extra role, wrong timer/service unit, or free-form command input: reject.
- Delegation expired/revoked, worker lease expired/unhealthy, wrong canonical client ID: reject.
- Expired/replayed/duplicate nonce or concurrent consume: reject exactly once.
- Non-zero role sessions, open watchdog row, service activating/running, or missing credential metadata: refuse mutation and preserve evidence.
- Task #189 request ID, approval, signature, marker or evidence packet supplied to GPT02 flow: reject.
- Owner decision submitted with a different action digest or stale before/after snapshot: reject.
- Postflight mismatch, partial database changes, timer still active/enabled, service not idle, or credential metadata mismatch: report failure; no automatic cleanup/rollback.

## 6. Release gates

- Isolated worktree and PR from current `origin/main`.
- Unit, integration, negative-security, concurrency/replay and typecheck tests pass.
- Security review verifies the Owner trust chain and action binding independently.
- DEV-only deployment with a recorded exact SHA and an independent, read-only test of the authorization path.
- Non-secret activation receipt and exact route/operator instructions recorded in AI-Task-Hub #208.
- No PROD deployment, no signer/dispatch activation, and no live GPT02 mutation as part of implementing this design.

## 7. Current blockers / facts

- Canonical OpenClaw VPS principal found: `openclaw-vps-main`; read-only registry snapshot showed active/healthy lease and bounded task coordination.
- Generic work-claim path uses `agent:work` and assignment/lease checks; its approval metadata flag is not a cryptographic authorization check.
- Existing Task #189 Owner review path is bound to Task #189 request/decision/release evidence. It must not be repurposed for GPT02.
- No GPT02-specific assignment, Owner decision record, one-use nonce record, or dedicated executor/activation receipt has been verified yet.
- The live relock remains NO-GO until the new path is implemented, independently tested, and deployed to DEV under its own release gate.

## 8. Critical compatibility finding: auditor NOLOGIN vs recurring supervisor

The current installed supervisor opens PostgreSQL as `dev_gpt02_relock_catalog_auditor` on every timer activation. It verifies `session_user` equals that role and invokes the four cleanup RPCs. The requested final state for that same role is `NOLOGIN`, `CONNECTION LIMIT 0`, while retaining a non-NULL password. These requirements are incompatible with a still-enabled recurring supervisor using that identity: once `NOLOGIN` is applied, the supervisor cannot reconnect on the next 5-second cadence.

The current timer is configured with `OnBootSec=30s` and `OnUnitInactiveSec=5s` and is live `active/enabled`. A recent sanitized journal sample captured 75 runs over 15 minutes. In those runs, writer Phase A/B and reader Phase A/B counts were all zero; the Task183 lane reported `roleLocked=true`, no canary/operational window, zero sessions remaining, no preparation attempted, and dispatch false. Current read-only watchdog counts were 0 open rows for both writer and reader tables. Thus the service is repeatedly connecting and evaluating cleanup lanes, but the sampled period contained no pending watchdog rows to process.

The exact installed writer/reader function bodies were inspected read-only. They are postgres-owned `SECURITY DEFINER VOLATILE` functions. Writer Phase A sets only expired, allowlisted evidence roles to `NOLOGIN`, connection limit 0, password NULL and restores `VALID UNTIL`; writer Phase B verifies those states, terminates sessions for those expired roles, and marks watchdog rows cleaned. Reader Phase A/B apply analogous checks to exact task-scoped `dev_gpt02_task_<task>_<suffix>` roles; reader Phase B also calls the existing grant-revocation helper and verifies the target no longer has access to named private evidence tables. No auditor role is altered by these four functions. The exact code is in the installed function definitions; no function was executed during this review.

### Required architecture decision before live relock
Choose and review one design:

**Option A — one-shot finalizer:** run the approved cleanup exactly once under a dedicated, narrow execution window; verify postconditions; then stop/disable the recurring timer and ensure the service is idle; finally set the auditor to `NOLOGIN` / limit 0 while retaining its password. The final state must prove no background process requires that auditor to reconnect.

**Option B — separate ongoing read-only monitor:** keep recurring monitoring only if a new dedicated `NOLOGIN`-ineligible monitor identity with least-privilege catalog reads is introduced, and separate that identity from all mutation/SECURITY DEFINER execution. The old auditor must no longer be the recurring service login. The old cleanup executor must have a distinct, exact, short-lived, one-shot Owner authorization and no unattended cadence.

Do not implement both paths partially. The design must also state whether `OnUnitInactiveSec=5s` is intentionally desired; it conflicts with the requested final inactive/disabled timer state. A generic worker task assignment or `agent:work` capability does not resolve this DB/systemd identity conflict.

### Current observed state (read-only)
- Four target roles found; auditor invariant fails (`LOGIN`, connection limit 1, password present); three evidence roles are `NOLOGIN`, limit 0 but password present 3/3.
- Current follow-up snapshot: role sessions 0, open watchdog rows 0 (writer + reader).
- Credential source metadata PASS: regular file, not symlink, mode 0600, owner/group root:root; contents untouched.
- Timer remains active/running/enabled; service is activating during recurring run.

No role/password/timer/service changes are made by this design update. No signing, dispatch, or PROD capability is included.

## 9. Preferred implementation for the requested target: one-shot finalizer (Option A)

Because the requested final state explicitly requires the timer `inactive/disabled` and auditor `NOLOGIN` while retaining its password, **Option A is the preferred implementation**. Option B is deferred unless the Owner separately requests continued unattended monitoring after relock.

### 9.1 Preconditions

- Dedicated GPT02 Owner session-approval path is implemented, independently reviewed, and passes all negative tests.
- A one-use Owner-approved manifest and challenge-bound decision record explicitly authorize the exact one-shot sequence below; a broad delegation or GitHub comment is not sufficient.
- Target is verified as Supabase CST-DEV project `xssrfshdrtdfupgqwfdw`, database `postgres`; VPS is `srv1792369`.
- The four target roles are exactly present, no extra target is inferred, and credential metadata is verified as already specified.
- Both writer and reader watchdogs are queried; open/expired row counts and the service's current in-flight state are captured. If unexpected rows exist, they must be handled only by the approved scoped cleanup contract, never by broad/manual SQL.
- The supervisor's current 5-second cadence and the reason it was enabled are reviewed by the system owner. No run may overlap the one-shot finalizer.

### 9.2 Approved one-shot order

1. Present the exact `GPT02_RELOCK_CST_DEV` manifest to the Owner. Obtain an explicit `APPROVE` from a fresh Hub-signed Google Super Admin session with a fresh one-use challenge nonce and action digest. Validate delegation, Owner identity/link, scope, expiry, replay state and DEV target server-side.
2. Capture read-only preflight evidence. Confirm no active supervisor run, no in-flight cleanup, no open watchdog rows requiring unapproved work, and zero sessions for all four target roles. If any precondition fails, stop before mutation.
3. Confirm both writer and reader watchdog tables contain zero open rows. If either has a row, abort and require a separate reviewed manifest for those exact eligible rows; do not call the recurring cleanup RPC from this GPT02 relock flow.
4. Stop and disable the timer using the fixed unit identity only after verifying the current service run is finished and no dependent task requires another scheduled cleanup. Stop/disable is recorded as an enumerated operation inside the same Owner-approved manifest; no free-form shell command is accepted.
5. Verify the timer is `inactive` and `disabled`, the service is idle/inactive, and no MainPID remains.
6. Set only the three evidence roles to `NOLOGIN`, connection limit `0`, password `NULL`.
7. Change only `dev_gpt02_relock_catalog_auditor` to `NOLOGIN`, connection limit `0`, preserving its existing password verifier (do not read or display it). This must be the final role mutation after all actions requiring that login are complete.
8. Independently verify all four role invariants, session count 0, writer+reader watchdog open-row count 0, timer inactive/disabled, service idle, and encrypted credential metadata. The credential file remains present as protected custody material; no decryption is performed.
9. Consume and close the one-shot authorization, persist a redacted receipt, and mark complete only if every postcondition passes. Any mismatch is `NO_GO/OWNER_REVIEW_REQUIRED`; do not automatically retry, rollback, restart, or re-enable the timer.

### 9.3 Explicit prohibitions

- Do not apply `NOLOGIN` to the auditor before the one-shot cleanup and timer shutdown are complete; the current supervisor needs that login to connect.
- Do not leave the 5-second timer enabled after locking its service identity.
- Do not change the evidence-role passwords except through their exact target state and a separately approved manifest.
- Do not kill sessions as a shortcut; preflight must show zero sessions or stop for review.
- Do not run the existing four SECURITY DEFINER functions manually outside the approved one-shot orchestrator.
- Do not re-use Task #189 approval identifiers, nonce, decision records, or release marker.
- Do not make any PROD, signing, dispatch, signer-custody, or unrelated GPT02 Task183 changes.

### 9.4 Completion definition

The work is complete only when every target invariant is true simultaneously and independently verified after the service has been stopped and the auditor is NOLOGIN. A successful supervisor run or `roleLocked=true` for a separate Task183 lane is not completion evidence for the four target roles or timer final state.


## 10. GPT02-specific Owner approval implementation (draft code added)

The implementation draft adds these isolated components in Core-AI:
- `artifacts/api-server/src/services/gpt02RelockOwnerApprovalService.ts`: builds an immutable manifest for the fixed DEV project/host/four role targets/timer; checks a fresh Google Super Admin actor plus a required trusted Owner-eligibility callback; issues a 120-second nonce challenge; canonicalizes the complete manifest; verifies the exact manifest, owner subject, Supabase Auth user ID, expiry and nonce; atomically consumes the challenge and records an append-only approval decision with only the SHA-256 hash of the verified Hub session. The decision returns `executionPermitted=false`, `signingPermitted=false`, `dispatchPermitted=false`, and `releaseDecision=NO_GO`; approval alone does not run the relock.
- `artifacts/api-server/src/routes/gpt02-relock-owner-approval.ts`: an injectable Express router factory with strict same-origin/host/content-type/body checks. It requires a trusted CST Hub signed-session verifier and a separate eligibility verifier to be injected. It does not use generic `adminAuth`, API keys, worker tokens, or client-supplied actor claims.
- `scripts/migrations/ai-gpt02-relock-owner-approvals.sql`: dedicated challenge/decision tables, 120-second TTL, unique pending challenge, immutable manifest fields, one-time consumption, decision/challenge consistency trigger, append-only decision records, and no PUBLIC grants. Runtime DDL is deliberately not used.
- `artifacts/api-server/src/services/__tests__/gpt02RelockOwnerApprovalService.test.ts`: challenge issuance after Owner eligibility, denied Owner, exact-scope/digest mismatch, one-use nonce consumption/replay rejection, and digest binding.

### Current integration state and activation blockers
1. **The read-only Owner identity verifier has been restored as a separate service.** `cstHubGpt02OwnerIdentityVerifier.ts` first calls `/api/auth/gpt02/operator-session-readiness` and requires a fresh signed Google Super Admin session, then calls `/api/ai-tasks/183/gpt02-owner-identity-readiness?companyId=default`. The endpoint is served by a new GET-only service bound to `127.0.0.1:18509`; it independently asks the existing Hub auth middleware on `127.0.0.1:18499` to verify the exact bearer token, then invokes the existing `task183-owner-identity-readiness.py` reader against the pinned `/opt/ai-coding-standalone-dev/tasks.db` opened in SQLite `mode=ro` with `PRAGMA query_only=ON`. The reader checks the exact enabled Hub operator ID, Supabase Auth user ID, email, active `super_admin` identity and Owner link. It has no POST, approval, decision, signer, issuer or dispatch route, no write method and no database credential. The DB file remains root:root `0600`; aggregate preflight found one active operator link, one active Super Admin and one exact join. Live HTTP checks: no bearer `401`, invalid bearer `403`, methods other than GET `403` at Nginx / `405` directly, sibling GPT02 Task183 APIs remain `410`. No real Owner browser token has yet been used for an end-to-end approval request.
2. **Core API route is now feature-gated and mounted in source.** It mounts only when `NODE_ENV` is not production, `APP_ENV=development`, and `GPT02_RELOCK_OWNER_APPROVAL_ENABLED=true`. Default remains disabled. The route uses the adapter above, same-origin checks and explicit digest-bound `APPROVE`.
3. **Nginx identity allowlist is active; Core-AI approval proxy remains candidate only.** The live global Task183 GPT02 `410` guard now exempts only the exact `/api/ai-tasks/183/gpt02-owner-identity-readiness` path. Its exact Nginx location permits GET only. All sibling GPT02 Task183 endpoints remain `410`. The separate `deploy/nginx/dev-ai-task-gpt02-owner-approval.location.candidate.conf` for Core-AI `prepare` and `approve` is not installed or included in the live vhost. The exact one-line `410`-guard exception is recorded in `deploy/nginx/dev-ai-task-gpt02-owner-identity-guard.patch`.
4. **Owner-facing review UI source is prepared in a separate Draft PR.** AI Task Hub PR #229 adds `/gpt02-owner-approval`, visible only to Super Admin. It displays the full exact manifest, digest, expiry and pre/postconditions, requires an explicit review checkbox, and disables the UI by default unless `VITE_GPT02_OWNER_APPROVAL_ENABLED=true`. It has not been merged or deployed. The identity verifier is now online, but no real Owner login token has yet been tested end-to-end.
5. **The SQL migration is not applied.** The managed DB operator must identify the exact runtime DB principal and grant only the minimum challenge SELECT/INSERT/UPDATE and decision INSERT privileges; there are deliberately no PUBLIC grants.
6. **No executor is connected.** The recorded approval still returns `executionPermitted=false`, `signingPermitted=false`, `dispatchPermitted=false` and `releaseDecision=NO_GO`. A separate one-shot executor must consume and verify the same decision/digest before any mutation.

Until Owner UI PR #229 and Core-AI PR #1784 pass their updated CI/review, the Core-AI approval proxy and backend/frontend feature flags are separately reviewed for DEV, least-privilege migration grants are applied, and a separately reviewed one-shot executor is provided, no relock can execute. This code draft is not deployed and changes no live database, systemd unit, credential, signing or dispatch state.
