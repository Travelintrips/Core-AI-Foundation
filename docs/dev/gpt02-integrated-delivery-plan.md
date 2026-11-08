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

## Independent cryptographic audit attestation — isolated integration, 2026-11-08

The same disposable PostgreSQL integration now has a **separate `attestor_login`**, distinct from `verifier_login`, grant `issuer_login` and worker login. A grant can be created only if a protected, one-shot attestation exists for its immutable audit row and matches the PostgreSQL-calculated proof digest. Both the verifier login and the issuer login are denied `attest_review` execution. A deliberately forged audit (a prior direct use of the verifier database credential with a reused signature) is now **rejected for grant issuance** because it has no attestation.

To avoid relying on manual success flags, the sandbox creates an ephemeral signing key, stores a signed proof, re-reads **that exact audit's JSON** and verifies it independently with the application's Ed25519 proof verifier and the pinned ephemeral public key. The forged audit is independently rejected by Ed25519. Only after valid verification does the test-only attestor role write a one-shot attestation bound to the persisted proof hash. A mismatched hash and attestation replay fail. The subsequent one-grant, three-client single-winner lease and fenced completion tests remain PASS.

**Critical scope:** this is a network-disabled, throwaway PostgreSQL 16 **integration test**, not a deployed attestation service. The attestor login still has direct execution capability, and its synthetic secret is present in the test harness. The reviewer must ensure an actual independently authenticated service protects attestor credentials, securely pins/rotates public keys, prevents arbitrary direct attestation and binds attestation and grant issuance to an atomic immutable snapshot. None of this test activates GPT02 signing or resume, and no real CST-DEV/PROD database is altered.

## Independent attestor test subprocess (2026-11-08)

A new **test-only** child entrypoint `devReviewAttestorChild.ts` narrows the synthetic test flow further. It accepts only a decimal audit ID on stdin, reads the corresponding persisted JSON proof back from the disposable network-disabled PostgreSQL container, verifies real Ed25519 using a pinned ephemeral trusted public key, then uses a *different* `attestor_login` to record a one-shot digest-bound attestation. A replayed or forged stored signature never reaches attestor SQL. The unified test demonstrates: valid stored proof verified and attested; forged stored audit denied; attestation replay denied; grant issuance succeeds only after attestation; lease single-winner and fenced result remain correct. The complete integration harness exited zero.

**NO-GO limitations:** this subprocess is a proof-of-concept using Docker test credentials, a privileged local PostgreSQL readback for convenience, and environment-supplied test trust key. It is not authenticated workload transport or a safe production secret boundary. A compromised attestor credential can still call the raw SQL procedure directly; digest matching is not Ed25519 verification in the DB. No deployment, real DEV migration, human approval, real worker execution, or PROD changes occurred. Hard-disabled review writer and claim guard remain unchanged.

## Least-privilege attestor audit reader and single-snapshot readback (2026-11-08)

The disposable PostgreSQL integration now provisions a distinct non-superuser `audit_reader_login` with a separate SCRAM test credential, `SELECT(id,proof_json)` column privileges on `isolated.audit`, and a read-only RLS policy. The attestor child no longer queries PostgreSQL using the container superuser. Its proof and PostgreSQL digest are fetched together in a single SELECT/snapshot; Ed25519 verifies the persisted proof before the distinct attestor role is invoked. The attestation procedure checks the current digest again as part of its insertion transaction.

Adversarial tests confirm the reader cannot select the unauthorized `nonce` column, select `isolated.commands`, update or delete audit rows, and that the session is not superuser. Valid Ed25519 proof → attestation → one-shot grant → single-winner lease → fenced result remains PASS; forged proof remains denied. This is still synthetic with hard-coded test credentials, and the attestor's direct SQL ability, service authentication, key custody, immutable production audit binding and real DEV E2E remain release blockers. No CST-DEV or PROD migration or dispatch.

## Two-factor synthetic attestation credential boundary (2026-11-08)

The independent test-only attestor now requires **both** a non-superuser attestor database login and a keyed HMAC-SHA256 binding of `audit_id:proof_digest`. A per-run 256-bit synthetic MAC key is generated inside ephemeral PostgreSQL 16 using `pgcrypto` and stored in a private table invisible to attestor, verifier and reader logins. A tightly scoped test launcher supplies the secret to the isolated test subprocess (never the ordinary API); the subprocess independently verifies the persisted Ed25519 signature before computing the keyed MAC and calling the atomically checked attestation routine. The routine compares the presented MAC against PostgreSQL's own HMAC using its protected key, then rechecks the stored audit digest and expiry at insert time. An attested audit ID is unique; replay cannot create a second attestation.

The test proves a stolen attestor **database login without the separate MAC key** cannot attest even an existing, correctly signed proof **before any legitimate attestation exists**, leaves zero attestation rows, and cannot read the protected key table. An invalid MAC, forged persisted signature, wrong audit digest, repeat attestation, or mismatched role all fail. A valid attestation still produces one synthetic grant, exactly one winning lease and a fenced worker result. All tests operate in a disposable `--network none` temporary PostgreSQL container.

**This is still NOT a production secret system.** The test-only launcher can inspect the synthetic key and passes it as a subprocess environment variable; same-user process inspection, secret injection and Docker administration are not hardened. The real system needs independent identity and immutable key custody via a secret manager/HSM, secure service-to-service authentication, rotation/revocation, audit logging, minimal privileges, workload/container isolation, and an approved DEV E2E drill. An attacker with both login and MAC key could still mint synthetic attestations without independently checking Ed25519. PR #1660 remains Draft, review readiness hard false and claim SQL inert; no live DEV/PROD modification or GPT02 resume is authorized.

## Bounded HMAC freshness at the separate attestor boundary (2026-11-08)

In the disposable PostgreSQL test, the HMAC payload now binds `audit_id:proof_digest:issued_epoch_seconds` and the SECURITY DEFINER attestor checks its own PostgreSQL clock, rejecting timestamps outside a ±15-second test window. The verifier child computes the keyed proof with its current test clock, while the DB authenticates the full payload using the private synthetic key stored in a protected table. Direct callers holding a stolen attestor login and even a correctly computed, but stale/future MAC cannot create an attestation. A replayed previously accepted MAC is rejected by the unique audit ID. Re-ran the unified PostgreSQL integration: all existing signed audit, forged signature, privilege separation, role revocation, grant, lease concurrency and fencing checks passed with the new negative time checks.

This only bounds exposure of captured test MAC values; it **does not** protect against concurrent secret theft, malicious same-user execution, or privileged Docker/DB access. A real DEV deployment needs independent workload identity and protected per-service secrets, a replay-resistant challenge/audience scheme, authenticated transport, controlled clock skew and key rotation/incident revocation, plus real worker E2E. No signing, grant issuance, or dispatch was enabled outside the isolated test.

## Real DEV E2E acceptance evidence boundary (2026-11-08)

Added `scripts/dev/gpt02-live-evidence-gate.mjs` and its executable negative tests to CI. This gate specifies **eleven** distinct evidence categories covering AI Task Center job identity and ownership, immutable attempt/command lineage, verified native checkpoint and receiver ACK, complete latest BLOCKER, human role/signature/nonce, independently authenticated writer attestation, atomic grant/lease fencing, actual fenced worker completion, event-driven monitoring and DEV privileges/rollback. It does not touch any database or accept a web request or operator-created JSON as an authenticated evidence source.

Even a metadata file claiming `allPass`, `authenticated`, `workerAck`, `grant` or a self-created verification object **cannot authorize release**. Genuine readbacks and independent verifier implementation are still missing, so every individual live requirement is explicitly marked unverified, `maySign/mayIssueGrant/mayDispatchWorker/mayCloseJob` remain false and the release command exits nonzero (`3`). A syntactically acceptable DEV identifier file merely helps correlate the future drill; it is not a readiness certificate. The test suite proves missing evidence, fabricated success, PROD metadata and unrecognized attestation keys all fail closed.

The existing 19 source/prototype checks remain a *separate* indicator of test coverage, not of readiness. A future approved online, independently authenticated verifier must supply corroborated live DEV evidence and bind it to the same job/attempt/command, with negative concurrency and rollback proofs, before anyone can intentionally design a release permit. This PR makes **no** such permit available and does not access real DEV/PROD state.
