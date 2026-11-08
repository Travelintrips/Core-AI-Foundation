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
