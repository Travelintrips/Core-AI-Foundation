# GPT02 CST-DEV Relock — Delegation and Owner Authorization Design

Status: **design proposal; not deployed and not an execution authorization**  
Related work: Core-AI-Foundation #1782; AI-Task-Hub #208  
Target only: Supabase CST-DEV project `xssrfshdrtdfupgqwfdw` and VPS `srv1792369`.

## 1. Purpose and non-goals

This design lets the Owner appoint the canonical OpenClaw VPS worker as the PIC for a narrowly scoped GPT02 security relock. It must preserve a separation between (a) the Owner's delegation of coordination and (b) the Owner's cryptographic authorization of exact security mutations.

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

Before any mutation, the Owner must approve one canonical, immutable action manifest via the trusted CST Owner session/signing flow. The signed payload must include:
- request ID, delegation ID, canonical worker ID, signer/Owner subject;
- environment `DEV`, exact project ID, exact VPS identity;
- exact four role names and target states;
- exact systemd timer and service unit names;
- exact permitted operation identifiers (not caller-supplied shell strings or free-form SQL);
- required preconditions and postconditions from section 3;
- issue/expiry timestamps, unique nonce, and a monotonic/replay-protection identifier;
- manifest digest and signature algorithm/key ID.

Verify the signature server-side against the trusted Owner identity/key chain. The verifier must fail closed on missing/unknown key, non-Owner, wrong subject, invalid signature, altered manifest, expired request, revoked delegation, unhealthy/non-canonical worker, wrong environment/project/host, reused nonce, or any action/resource mismatch. The raw signature, private key, password hashes/verifiers, tokens, or credential contents must never be logged or returned.

A GitHub comment, chat message, WhatsApp reply, boolean metadata flag, generic `SECURITY_CHANGE` token, Task #189 approval, or an OpenClaw statement is not a substitute for this exact signed authorization.

## 3. Exact relock manifest and gates

### 3.1 Database role targets

Read-only preflight must establish all four roles exist. The signed manifest may authorize only these targets:

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

The executor must atomically consume the signed authorization nonce before the first mutation and bind it to one immutable manifest digest. Duplicate, concurrent, or replayed calls must be rejected. Each operation must be an enumerated constant mapped to fixed SQL/systemd helper code; no raw SQL, shell command, unit name, role name, project ID, or path may come from worker-controlled free-form input.

Record an append-only audit trail with request/delegation IDs, actor, worker ID, manifest digest, action IDs, timestamps, before/after booleans/counts, and terminal result. Do not place secrets in the audit payload.

## 4. Execution architecture

1. Owner registers the bounded delegation; system confirms exact canonical OpenClaw principal and stores expiry/revocation state.
2. OpenClaw uses its own principal to conduct read-only preflight and prepare a redacted evidence packet.
3. The Owner reviews and signs that exact packet/manifest using the existing trusted CST Owner identity/signing chain, under a **new GPT02-specific request ID, nonce and digest**.
4. A server-side GPT02-specific verifier checks signature, owner subject, delegation, scope, nonce, preconditions and expiry.
5. A dedicated least-privilege executor exposes only the enumerated role and timer operations. It must not provide an interactive shell or generic SQL execution.
6. OpenClaw observes execution and runs the independent postflight. It cannot rewrite the approval or postflight result.
7. The system marks completion only after exact postflight evidence; otherwise it remains failed/blocked for Owner review.

The generic `agent:work` queue may carry coordination/read-only jobs only. It must not be treated as the security mutation gate. The `criticalActionsRequireAiCoreApproval` metadata flag is informational unless the server actually enforces it.

## 5. Required fail-closed test matrix

- Valid Owner signature, exact manifest, active delegation, correct DEV project/host, unused nonce, passing preflight: authorization accepted.
- Missing signature, invalid signature, wrong Owner, untrusted key, or verification service unavailable: reject.
- Wrong project ID, PROD environment, wrong host, wrong role, extra role, wrong timer/service unit, or free-form command input: reject.
- Delegation expired/revoked, worker lease expired/unhealthy, wrong canonical client ID: reject.
- Expired/replayed/duplicate nonce or concurrent consume: reject exactly once.
- Non-zero role sessions, open watchdog row, service activating/running, or missing credential metadata: refuse mutation and preserve evidence.
- Task #189 request ID, approval, signature, marker or evidence packet supplied to GPT02 flow: reject.
- Owner signature valid for a different action digest or stale before/after snapshot: reject.
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
- No GPT02-specific assignment, signed manifest, one-use nonce record, or dedicated executor/activation receipt has been verified yet.
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
