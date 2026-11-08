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
