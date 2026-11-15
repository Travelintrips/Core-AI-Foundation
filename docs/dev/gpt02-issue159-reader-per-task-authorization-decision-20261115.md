# Issue159 — per-task database authorization decision gate (15 Nov 2026)

**Draft decision only. NO APPLY, NO DEPLOY, NO PROD, NO credential or signer activation.**

## What is established

- Existing verifier is active and authenticates to a private lineage reader Unix socket as UID 995 / GID 999. The socket rejects unauthorized peer UID and its directory/socket modes are 0750/0660. This proves peer custody, not database single-task isolation.
- Existing `dev_gpt02_lineage_login` inherits from `dev_gpt02_lineage_reader`. All five underlying lineage tables have column-level SELECT grants, although `has_table_privilege(...,'SELECT')` returns false. The correct inventory uses `has_any_column_privilege`.
- Current lineage RLS allows multiple tasks in company `default` (threshold `task_id>139`). The receipt policy uses `USING (true)`. Therefore a holder of the dedicated database login may enumerate same-company records outside a specific verified command even if the normal socket query uses exact bound parameters.
- Existing issuer reader has strict native role/TLS/transaction identity checks, including `no_privileged_routines=true`; granting it EXECUTE on a SECURITY DEFINER read function makes this guard fail. A synthetic fixed-capability SECURITY DEFINER proof is not a deployable replacement.
- The dedicated lineage reader is already deployed, and the installed runtime source was brought into this PR byte-for-byte. Do not build a parallel service.

## Decision

**No live grant/policy change should be made yet.** A safe solution must distinguish *application-level exact lookup* from *database-enforced isolation after credential compromise*. The two are not interchangeable.

A viable candidate for independent design review is a **separate, time-bounded database identity for each exact authorized task/attempt**, with row policies bound to immutable task/company/command/attempt (and relevant receipt/fence IDs), no ability to choose scope via caller-controlled GUC, no role membership escalation, no privileged routines, and no broad inherited reader grants. It would require a reviewed credential issuance and revocation path, preventing overlapping authority and preserving the existing source/claim verification. This is a candidate, NOT approval to provision per-task roles.

A second possible candidate is a privately authenticated server-owned read broker which makes the exact claimed task binding authoritative while denying general reader credentials direct table visibility. Any privileged code must receive an independent review, must not bypass FORCE RLS casually, and must not disable the original native privilege guard.

## Required pre-merge evidence

1. Independent security review of the proposed trust boundary, including how the task claim is authenticated *before* any DB read and how credentials cannot be reused for another task.
2. Disposable PG tests with **two legitimate tasks from the same company**, wrong command, attempt, receipt/fence, expired lease, missing/swap approval, and a direct DB enumeration attempt from the credential itself.
3. Native reader contract tests for TLS, pinned role, one session, no privileged routines, no write grants, no replay, and exact existing signed evidence/digest shape.
4. Explicit rollback and credential invalidation proof that leaves the role(s) locked and zero sessions.
5. A separately authorized live DEV-only one-shot authentication proof only AFTER the above are PASS. Such a proof does not authorize signer, dispatch, or Final ACK.

## Status

Existing source tests: PASS. Existing socket custody tests: PASS. Scoped synthetic capability test: PASS for its synthetic model but incompatible with the current issuer role guard. **Actual database-enforced one-task security: NOT PROVEN.** E2E Final ACK: NO_GO.

No change to active DEV roles, RLS, service, credentials, signer, dispatch or PROD was made when authoring this decision.

## Disposable signed-scope issuance and relock evidence — 15 Nov 2026

Synthetic test source: scripts/dev/test_gpt02_issue159_signed_scoped_issuance_pg.py.

- Reuses four-root synthetic signed packet, mock persisted readback, and exact five-table RLS. A disposable network-isolated PostgreSQL 16 database models a privileged issuance actor. No live accounts, roles, credentials or records are touched.
- One atomic transaction records a scope/packet/command-unique issuance ledger and enables a generated synthetic LOGIN with CONNECTION LIMIT 1. Simultaneous replay requests produce only one committed issuance. A different scope cannot reuse the same command.
- Native one-task PostgreSQL login proves original canonical SQL works, other task and writes fail, and the credential cannot read the issuance ledger. After use, SELECT/USAGE are revoked, the role becomes NOLOGIN with CONNECTION LIMIT 0 and password NULL, an active backend is terminated, zero sessions remain, and new LOGIN fails.
- These results prove synthetic mechanism feasibility, NOT live authentication, real credential custody, approval-to-issuance authority or release.

### Blocking conditions for any operational activation

1. One connection is NOT one read. A compromised password may be reused sequentially before revocation, and an active session may issue repeated SELECTs. A pinned one-shot broker must execute a single approved read, close it, then force backend termination. The database must independently fence issuance and consumption.
2. The source candidate has credentialIssuancePermitted=false and releaseDecision=NO_GO. Neither a hash nor a caller-supplied proof authorizes role creation. Require fresh, persisted, independently verified Super Admin approval, four independent signed roots, exact five-table lineage, and approved one-use issuance transaction.
3. The active lineage reader pins the existing shared database identity in both DSN and connection user checks. Never swap a per-task password into that unit or weaken the identity guard. A separately reviewed compatible path must preserve the active service until cutover PASS.
4. Scoped credentials must not inherit dev_gpt02_lineage_login's broad column SELECT or RLS task-threshold / unconditional policies. Test direct SQL enumeration from the credential, not just the application's bound query.
5. Lease expiry, revocation, crash after granting, concurrent issuance, partial rollback and stale active sessions must all fail closed to NOLOGIN, password NULL and zero sessions. Signer, dispatch, DELL and PROD remain untouched.

Outcome: SYNTHETIC ISSUANCE PASS; LIVE CREDENTIAL ISSUANCE NO_GO; FINAL ACK NO_GO.
