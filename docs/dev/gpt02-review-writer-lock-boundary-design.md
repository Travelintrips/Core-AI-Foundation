# GPT02 DEV — trusted review writer and command locking boundary (RFC / NOT DEPLOYED)

## Verified facts
- The authenticated review-verification endpoint is read-only and always returns mayIssueGrant=false.
- The ordinary runtime has scoped review SELECT through RLS but no audit INSERT/UPDATE/DELETE.
- Current persistence uses an application DB transaction and SELECT FOR UPDATE on command, then guarded INSERT with a fresh READ COMMITTED snapshot.
- PostgreSQL 16 isolated tests prove the proposed separate writer (without command UPDATE) cannot acquire FOR UPDATE or FOR KEY SHARE locks. Do not replace the lock with a nonlocking read.

## Required security boundary before real signing
1. Preserve internal authenticated owner/admin identity, explicit acknowledgement, server-trusted Ed25519 verification, native checkpoint ACK and latest BLOCKER validation in a trusted backend.
2. Use a dedicated DEV-only write execution boundary and independently scoped credentials. No generic SQL/JSON write endpoint may be exposed, and no user-supplied identity may replace backend verification.
3. Acquire the command lock and record the review within one transaction. Any privileged database function requires restricted EXECUTE, fixed search_path, fixed ownership, no dynamic SQL, and independent review. The privileged function itself is not Ed25519 signature verification.
4. After lock acquisition, take a fresh response snapshot; recheck terminal state, operator, ACK, latest BLOCKER, expiry, nonce, and command metadata before append-only insert.
5. Test concurrent command status UPDATE, terminal response INSERT, replay, role revocation, invalid signature, unavailable DB, and missing key. A historical review must never authorize execution.
6. Require independent security review before applying to CST-DEV. PROD and auto-resume remain NO-GO.

## Decision
The proposed role-only SQL is NOT a complete writer implementation: its permissive INSERT RLS policy accepts an unsigned synthetic row in isolated testing. Do not deploy it, issue writer credentials, or activate signing until a signature-bound atomic writer design is implemented and verified.

## Isolated command-lock prototype (2026-11-08)

The new synthetic PostgreSQL 16 prototype demonstrates a narrow SECURITY DEFINER function with fixed search_path, explicit EXECUTE restriction, command row lock and historical append. The main runtime lacks EXECUTE; a dedicated NOLOGIN writer role can execute it without direct command UPDATE or audit INSERT. Concurrent terminal-first status changes prevent append, while append-first then terminal produces only an immutable historical fact with no authority. Tests use synthetic table names and a disposable network-isolated container.

**Not production-ready:** the synthetic function accepts a caller-supplied nonce without verifying a real signed proof, operator authority, response history, ACK, BLOCKER or expiry. Do not transplant this function into a live database. An untrusted client with access to that writer credential could otherwise forge audit rows. Before implementing the real trusted writer, review a credential boundary, signature verification and fresh native evidence validation, plus concurrency and replay tests. PR is Draft and auto-resume remains NO-GO.

## Additional negative tests — no authorization inferred
The isolated regression now demonstrates terminal-command rejection, missing-command rejection, duplicate-nonce rejection, and unchanged row count on replay. Crucially, it also proves that an authorized synthetic writer can still append an unsigned arbitrary nonce when the command status is PROCESSING. This is an intentional fail-open *prototype finding*, not successful real-review validation. This capability MUST remain confined to the disposable isolated test and never be deployed or granted to the runtime. A production-grade design must verify the full Ed25519 proof and operator/ACK/BLOCKER evidence before any append, under an independently reviewed trusted boundary.

## Verified application-side proof rejection — 2026-11-08
The existing signed-review persistence function was tested with additional deterministic negative cases using a disposable test keypair and mocked database transaction. Missing/mismatched trusted Ed25519 key, malformed signature, changed signed nonce, expiry, mismatched operator role, and production mode are rejected **before** any transaction call. Local focused Vitest completed 15/15 PASS. This does NOT establish that the standalone SQL prototype is signature-bound; the raw synthetic writer remains NO-GO. A real dedicated writer still requires a trusted execution boundary that performs this verification and all fresh operator/ACK/BLOCKER checks inside the approved flow.

## Application signer-to-persistence integration tests (2026-11-08)
Added focused tests that create a short-lived proof using the actual DEV signer with an ephemeral Ed25519 test keypair, pass that proof to the actual persistence service, verify that the pre-transaction signature check permits a simulated DB write, and separately show that post-signing tampering fails before any SQL transaction. Focused suite: 17/17 PASS locally. Database calls remain Vitest mocks: these tests DO NOT establish genuine DB writer privileges, actual persisted review, worker ACK authenticity, or live resume readiness. Standalone SQL writer prototype still accepts unsigned input and MUST remain undeployed.

## Read-after-lock evidence-fencing prototype — 2026-11-08
Added a new disposable PostgreSQL 16 regression with a synthetic command, checkpoint, ACK, BLOCKER, operator, and append-only audit. Its restricted stored routine acquires a command lock, then reads response/operator evidence before appending. Tests independently reject a revoked operator, downgraded operator role, missing checkpoint ACK, superseded BLOCKER, terminal response, and terminal command. The historical audit row count stays constant after every denied attempt; the ordinary runtime cannot execute this procedure.

This is a **proof-of-concept only**: the synthetic procedure still does not validate Ed25519, user session, actual worker receipts, proof expiration or real production schemas. Its acceptance of synthetic unsigned data is a known NO-GO condition. Do not apply it to CST-DEV or PROD; keep signer disabled until a trusted credential boundary and complete proof verification are implemented.

## Signing-route fail-closed API regression — 2026-11-08
Added HTTP-level route regressions for database persistence throwing after a proof is signed (HTTP 503, no proof disclosure, no execution authority), missing trusted Ed25519 public key (HTTP 409, no persistence), and a revoked/non-admin session operator (HTTP 403 before command evidence reads). Focused route plus persistence suites passed 48/48 locally with mocked DB, synthetic server keys and real Express middleware. These tests do not create a real signed audit or authorize a worker. Dedicated writer credentials and atomic DB signing boundary remain NO-GO.

## Hard fail-closed signing activation guard — 2026-11-08
The signing HTTP route now checks an explicit `isTrustedDevReviewWriterReady()` gate after authenticated request validation and before retrieving command evidence. This gate deliberately returns false in real source code because no independently credentialed, proof-bound atomic writer exists. Enabling `AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED=true` alone consequently yields 503 `TRUSTED_REVIEW_WRITER_NOT_IMPLEMENTED`, without fetching command evidence, creating a signature, opening a persistence transaction, or exposing a proof. Focused HTTP and service tests passed 49/49 locally; API bundle build passed. Tests simulate a future writer via a test-only mock, but real readiness stays false. Replacing the guard with a true implementation requires an independently verified deployment, not merely changing environment flags or granting INSERT to the main runtime.

## Refuse accidental execution of unsafe writer RFC — 2026-11-08
The checked-in role-only SQL RFC now throws an unconditional SQLSTATE 0A000 before any grants, roles or policies are applied. The isolated PostgreSQL regression verifies the **exact original file fails closed and creates no writer role**. It then removes that explicit blocker only in a disposable local copy within the network-isolated container test, so its role/RLS behavior remains covered without introducing a deployable migration. This addresses the immediate risk of a reviewer copying the incomplete SQL proposal into CST-DEV and accidentally granting raw unsigned INSERT.

## Actual readiness module regression (2026-11-08)
An additional focused Vitest imports the **actual** `isTrustedDevReviewWriterReady()` implementation (not the route's mock) and checks that DEV, test, and production environments remain false even if signing is enabled. The full route suite and actual-readiness suite passed 36/36 locally. This prevents a purely environment-driven activation from being mistaken for a trusted writer.

## Defense-in-depth check at persistence service boundary — 2026-11-08
The exported application persistence service now independently checks the actual trusted-writer readiness gate **before signature parsing or starting any database transaction**. A future internal caller cannot bypass the route's HTTP readiness guard merely by invoking the persistence service with the signing flag enabled. Existing isolated signer/persistence tests mock only that gate for hypothetical positive paths; an explicit new negative test proves direct service invocation returns TRUSTED_REVIEW_WRITER_NOT_IMPLEMENTED with zero transactions. Three focused Vitest suites passed 54/54 locally. The live readiness implementation remains hard false. This does not implement or authorize a real writer.

## Separate credential contract (2026-11-08)
A pure preflight `assessDevReviewWriterCredentialBoundary()` now models requirements for a **future independently deployed writer service**: DEV environment only; writer identity must differ from the runtime identity and password; same target database and host; dedicated login `gpt02_dev_review_writer_login`; no startup role/search_path override. It neither connects, provisions login roles, grants privileges nor logs secrets. The function reports *eligible for independent security review*, explicitly **not ready**. Twelve focused unit cases passed. The ordinary API must NEVER receive the writer secret. The actual `isTrustedDevReviewWriterReady()` remains always false; no SQL writer is enabled.

## Credential URL canonicalization and libpq override safety (2026-11-08)
The future-writer credential preflight now compares percent-decoded usernames and passwords rather than raw URL-encoded text, blocking credential reuse obscured through encoding. It also rejects all query parameters on both the runtime and proposed writer database URLs, preventing unreviewed libpq host, user, database, options, role, and search_path override settings. This is still a preflight for independent review only; it never authorizes writer connection or audit INSERT. Focused regression 18/18 PASS and API bundle build PASS locally. Full repository TypeScript checking is not yet PASS in this detached worktree because workspace build outputs (including lib/db declaration files) are absent and trigger unrelated compiler errors; CI remains the authoritative full check.

## Real Ed25519 verifier -> isolated PostgreSQL test handoff (2026-11-08)

The existing disposable PostgreSQL evidence-fencing regression now exercises a test-only Node/TypeScript harness importing the **actual application Ed25519 verifier**, with a new ephemeral keypair and properly command/checkpoint/BLOCKER-bound proof. Only after the verifier accepts it does the harness expose a synthetic nonce to the isolated PostgreSQL writer routine. Tampered signed BLOCKER binding and expired proof are denied before SQL; the historical row count remains one. The remainder of the PostgreSQL test continues to refuse revoked operator, downgraded role, missing ACK, superseded BLOCKER and terminal conditions.

**Security boundary is still missing**: this validates test harness control flow, not an independently authenticated writer process. The synthetic SQL function can still be called directly without a signature by anyone granted its EXECUTE privilege. Do not deploy this function, harness, writer role or credentials. Actual GPT02 writer integration and grant issuance remain disabled/NO-GO.

## Proof JSON binding and deliberate signature-reuse attack test (2026-11-08)
The disposable PostgreSQL evidence-fencing prototype now accepts and stores the *full verified test proof JSON* rather than only the nonce. PostgreSQL independently compares the signed document's action, command, operator, checkpoint, BLOCKER, worker, nonce shape, and signature encoding to synthetic row identities before an append. The actual application verifier still checks Ed25519 before forwarding a valid test proof. A database-bypass case with mismatched operator identity is rejected, and tampered/expired proofs are denied by the application verifier before SQL.

**Critical deliberately demonstrated remaining vulnerability:** a direct call to the synthetic SQL routine with a changed nonce but an old signature still inserts a second audit row. This proves the SQL-side checks are not cryptographic verification. The second row exists ONLY in the disposable PostgreSQL instance to make the risk explicit. Do not deploy this function, issue its EXECUTE privilege to a real client, or mistake any positive row count for a real grant/review approval. The independent trusted writer execution boundary is still required.
