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
