# GPT02 DEV — one integrated delivery contract and release gates

**Scope:** AI Task Center → AI Core lifecycle → authenticated human review → signed intent → isolated trusted writer → atomic audit and exclusive grant/lease → GPT02 worker ACK/results → AI Task Center timeline. **As of 2026-11-08:** PR #1660 is Draft. No live promotion, no real resume, no production permission. **Source inspection and synthetic tests are not a launch certificate.**

## Decisive architecture

1. **Work intake and ownership:** AI Task Center allocates an immutable job ID, task ID, responsible person, assigned human/AI actor, attempt ID, and correlated command ID. Event stream must preserve ordered state transitions and evidence rather than polling UI as the source of truth.
2. **Recovery and checkpoint:** lifecycle controller saves server-owned state and trusted native receipt/ACK, latest CHECKPOINT and BLOCKER; terminal FAILED/COMPLETED cannot be silently reopened. Recovery uses a **new attempt/command identity** with explicit provenance rather than replaying a FAILED command.
3. **Human security boundary:** authenticated owner/admin session and explicit acknowledgement; approved review is signed using server-custodied Ed25519 key. Public key rotation/revocation, anti-CSRF, audience, freshness, role revocation and nonce binding must be reviewed together. A proof is **not** a grant.
4. **Isolated writer:** separate OS/container identity and independent database login, with no DB credential in public web API/worker/frontend. Strict input surface (proof only), authenticated caller identity (e.g. short-lived mTLS workload identity), request limits, replay prevention, fixed trust anchors and no arbitrary SQL, arbitrary role, SSRF, child process control, or caller-configured adapter. Fail closed if any secret or trust material is absent.
5. **Atomic database boundary:** SECURITY DEFINER stored routine with schema-qualified objects, fixed search_path and exact EXECUTE role. Within a transaction: lock command, obtain **fresh** response snapshot, verify command/attempt relationships, operator currently active, signed proof binding, latest BLOCKER, native ACK, expiry, rate/retry/circuit state and idempotent nonce. Do not trust an HTTP request boolean or synthetic SQL-only shape check as crypto validation. Both SQL and writer must be reviewed against concurrency/time-of-check races.
6. **Grant and lease issuer:** distinct reviewed issuer after durable human proof; grant is short-lived, scoped to attempt/command, native ACK and exact worker; claim single-winner with row lock and monotonic fencing. Explicit 429 Retry-After, circuit-open and retry budgets. Neither review verifier nor audit insert may issue a grant.
7. **Worker and completion:** only dispatch after uniquely claimed lease; worker must ACK with command ID, attempt ID, owner and fence; all progress/completion writes guarded by the current fence; retries idempotent; crashed/replaced workers cannot overwrite newer results.
8. **Monitoring:** emit auditable progress/blocker/assignment/owner/human action/retry/failure/completion events, correlation keys, timestamps and percentage computation to AI Task Center. Dashboard must not infer 100% from a test, receipt or audit row; surfaces unavailable/blocked states and manual escalation.
9. **Operations and promotion:** privileged secrets from a dedicated secret manager; least privilege; no inherited env secrets; secure rotation/incident revocation, telemetry with redaction, rollback, backup, schema drift check, alerting and audit retention. DEV live drill with readback must pass before production is even considered, and production requires a separate decision.

## Single acceptance matrix (run together; no partial PASS substitution)

| Area | Required evidence | Current basis | Release status |
|---|---|---|---|
| Cryptography and human auth | Real server signer, verified live session, audience/rotation, revocation, replay | Unit and isolated verifier tests | **BLOCKED** |
| Trusted service and secrets | authenticated private service, isolated credentials and unauthorised direct SQL denied | guarded test subprocess / SCRAM synthetic roles | **BLOCKED** |
| Actual database transaction | live schema lock, native ACK, latest BLOCKER, append-only readback, replay/race | PostgreSQL 16 isolated prototype | **BLOCKED** |
| Grant and fenced lease | real authenticated issuer, grant/claim on DEV, single winner and rollback | synthetic lease/issuance tests, live proposal inert | **BLOCKED** |
| GPT02 worker execution | native ACK, fence checked at every write, 429 control, crash recovery | worker tests and partial bootstrap | **BLOCKED** |
| AI Task Center monitoring | job→attempt→command trace with owner/assignee/%/blocker/review | not demonstrated E2E | **BLOCKED** |
| End-to-end DEV run | one approved real task, complete evidence and audit trail, rollback proof | no approved live drill | **BLOCKED** |
| PROD approval | independent security acceptance and deliberate promotion | expressly prohibited | **BLOCKED** |

## Integrated delivery workstreams (build and test as one milestone)

**A. Trust boundary:** dedicated service package, workload authentication, key custody, scoped DB account, contract and negative security cases. Keep API readiness false until B–D E2E verified.

**B. Persistence + issuance:** reviewed migration and lock/append/claim with transactional native ACK, latest BLOCKER, status/attempt/role checks, nonce and expiry; all PostgreSQL replay, race, rollback and privilege tests. Never grant UPDATE/INSERT to ordinary runtime.

**C. Worker + operator + monitoring:** grant claim/fence in executor, event-driven ACK and correlated lifecycle activity on AI Task Center; blocked/manual escalation UX; one real DEV-only test attempt with authorisation, reconciliation and readback.

**D. Launch evidence:** run full unit/integration/negative/security/CI suite and a documented live DEV drill. Store actual command/attempt/ACK/grant/lease/event readback. All checks must PASS before a reviewer may intentionally flip a reviewed readiness implementation and consider promotion. No assumed auto-approval.

## Command and release behavior

`node --test scripts/dev/gpt02-integrated-acceptance.test.mjs` verifies the **source/safety gates** in CI. `node scripts/dev/gpt02-integrated-acceptance.mjs --json` reports both source gates and blocked external acceptance. `node scripts/dev/gpt02-integrated-acceptance.mjs --require-release-ready` exits **2**, not PASS, until a separately evidenced release readiness path exists. This is a deliberately read-only static inspection; **it cannot attest live DB state or independently verify all dependency behavior**. Existing GitHub CI PostgreSQL, JS and TypeScript suites must also pass.

## Release decision

**NO-GO** until the eight blocked E2E requirements have direct measured DEV evidence and an independent security review. PR remains Draft, SQL RFC throws deliberately, `isTrustedDevReviewWriterReady()` remains hard-false. No PROD edits.

## Combined synthetic review → grant → lease → fenced result regression (2026-11-08)

The disposable evidence-fencing PostgreSQL 16 CI harness now executes the **whole sequence within one instance**, instead of claiming full integration from four disjoint databases:

- Isolated verifier child, actual application Ed25519 proof verifier and authenticated synthetic PostgreSQL login append a fresh review audit; invalid proof, expiry and extra SQL fields are refused before the adapter.
- A separate `issuer_login` can create a one-shot grant bound to an existing audit, currently authorized command/operator, latest CHECKPOINT/ACK and BLOCKER. Nonexistent audit is rejected; ordinary worker cannot issue and issuer cannot claim. Duplicate issuance fails.
- Three independent `lease_worker_login` sessions concurrently claim the same grant. Exactly one acquires a lease; replay fails. A stale fence cannot commit the synthetic worker result, while the current fence can.
- Previously verified invalid operator, stale ACK/BLOCKER, terminal command, wrong DB password, replay and expired/future proof tests continue to pass.

**Critical outstanding vulnerability (NO-GO):** the test intentionally proves a compromised `verified_service` database login can insert an audit with a reused Ed25519 signature and different nonce. Since the synthetic issuer checks the audit row but **cannot cryptographically distinguish that forged audit from a valid one**, this is NOT an approved or deployable grant issuance path. Production work must separate and constrain the writer process/secret, add a reviewed authentic audit-to-issuance trust binding and protect issuer credentials and API authentication. The synthetic checks do not establish a native real worker ACK, real attempt correlation, or AI Task Center E2E monitoring.
