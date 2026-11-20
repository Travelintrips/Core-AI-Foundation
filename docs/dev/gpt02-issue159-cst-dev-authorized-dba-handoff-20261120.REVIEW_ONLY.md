# GPT02 Issue159 — CST-DEV one-task broker: DBA/custody handoff

**Status:** REVIEW ONLY • **NO APPLY / NO DEPLOY / NO SIGNER / NO DISPATCH / NO PROD**  
**Environment:** Supabase project `xssrfshdrtdfupgqwfdw` (CST-DEV).  
**Evidence baseline:** Core AI PR #1754 at `b275d6b12cb31b16d2b4d177df1bc93d5ae8289d`; AI Task Hub PR #207 at `ef50a8b5ca6c813fae1b5b0ab7c3a03884294319`.  
**Purpose:** Identify the first **authorized live-DEV technical change** without confusing source CI with operational authority. This page is an audit/release handoff, **not an install script**.

## 1. Live read-only state, 20 November 2026

Supabase read-only `BEGIN READ ONLY … ROLLBACK` confirmed:

- Task #183: 1 expected assigned PIC, 1 `gpt02_pic_assigned` audit; **0** execution jobs, preparations, Owner approvals. Never assign another PIC or generate a fresh Task183 duplicate.
- Historical Task #171 is immutable; do not replay its expired preparation.
- Five currently protected GPT02 technical roles are `NOLOGIN`, connection limit 0; the issuer evidence reader has no active password verifier.
- Existing `gpt02_relock_audit` schema and `dev_gpt02_relock_catalog_auditor` role **already exist**. The two installed PostgreSQL writer relock Phase A/B functions remain present.
- All five issuer-reader SELECT policies on private lineage relations are **PERMISSIVE threshold-based** (multiple tasks in company `default`), not database-enforced one-task scope. **Never unlock/reuse that general reader as a shortcut.**
- Missing: `reader_issuances`, `reader_consumptions`, `reader_approval_fences`; `scoped_reader_fully_locked`, `consume_reader_once`, `reader_consumption_persisted`, `canonical_reader_current_guard`; dedicated claim-consumer and admission-guard roles; all `dev_gpt02_task_%` roles; owner-held private reader grant-revoker helper.
- `postgres` on this connected management route is CREATEROLE but not superuser. It has ADMIN OPTION for `gpt02_store_owner` **but no SET privilege**. The private table owner is an independent `NOLOGIN` identity. Do not self-grant `SET` to circumvent this boundary.

On authorized VPS `srv1792369`, active AI Task DEV container remains healthy with HTTP 200. Legacy systemd AI Task, issuer reader and relock auditor timer are intentionally OFF. No service is to be started merely to obtain green status.

## 2. Exactly what is already proven — and what is not

**SOURCE/ISOLATED PASS:** Original PR1754 has a six-stage add-only **PG16 and PG17** installation-chain regression (GitHub Positive Permit #44614770684). It seeds an already-existing relock schema, locked auditor, writer Phase A/B and separately owned five FORCE-RLS tables. It proves no historical role/schema/function OID or writer ACL replacement, absence of PUBLIC EXECUTE on the four new privileged functions, three empty FORCE-RLS ledgers, dormant service roles, and refusal on migration replay.

**NOT PROVEN / NO-GO:** Any of those objects installed on hosted CST-DEV; independent owner-held private grant revocation; a native one-use credential broker/secret custodian; authenticated four-signer runtime; genuine current command-bound Owner decision in the canonical PostgreSQL approval fence; independent crash-safe relock; single real DELL command and receiver-owned Final ACK.

**Important:** the canonical PostgreSQL `reader_approval_fences` proposal is a **synthetic authority model**, *not* a validated live mirror of the existing persisted Issue159 Owner approval in SQLite. No signed/revoked cross-store authority bridge is installed. Creating the table alone must **not** cause a consumer to trust owner approval.

## 3. Approved technical release needs an independent DBA/custodian

This is an **infrastructure/security change approval**, not a second business approval for invoice/task execution. Task183 ultimately requires exactly one fresh command-specific Owner/Super Admin consent, through the **existing** Issue159 persisted-intent interface, **after** infrastructure is proven ready.

Before requesting any live DDL, the designated custodian must authorize the **exact project, exact source SHA(s), permitted object list, off-hours/maintenance scope, maximum risk window, rollback owner, and verification evidence storage location**. The assistant cannot infer this consent from a generic `lanjut` message or from synthetic CI.

Only after that approval and independent code review may the custodian consider these **six original, review-only source proposals**, in their tested order:

1. `docs/dev/gpt02-issue159-minimal-catalog-auditor-existing-role.REVIEW_ONLY.sql` — **add-only** auditor boolean; do **not** run the older migration that recreates the auditor role/schema.
2. `docs/dev/gpt02-issue159-one-read-consumption-attestation.PROPOSED.sql` — private issuance and one-read consumption ledgers.
3. `docs/dev/gpt02-issue159-one-read-consumer-rpc.PROPOSED.sql` — dedicated dormant claim-consumer and RPC.
4. `docs/dev/gpt02-issue159-reader-issuance-server-clock.PROPOSED.sql` — database-time 3.5–15-second issuance policy.
5. `docs/dev/gpt02-issue159-canonical-approval-fence.PROPOSED.sql` — model of a revocable canonical approval fence, **not** permission to start using a synthetic authority.
6. `docs/dev/gpt02-issue159-canonical-reader-guard.PROPOSED.sql` — held-row current approval guard and dormant role.

**Do not apply six migrations merely because their isolated test passes.** Their owner/SECURITY DEFINER review and production-compatible signer/approval provenance remain independent gates. The owner-held private revocation helper from `docs/dev/gpt02-issue159-store-owner-relock-helper-maintenance.REVIEW_ONLY.sql` requires a **separately authenticated and precisely audited** maintenance identity; it cannot be applied by silently broadening the current `postgres` SET privilege.

## 3A. Supabase-supported temporary SET route: **preserve the actual TWO grants**

**New evidence, 20 Nov 2026:** Supabase's official role-membership guidance explains a bounded `SET ROLE` grant on a custom role can be made by a holder of ADMIN OPTION and then undone. Supabase does **not** give the ordinary `postgres` user superuser permission. Official reference: https://supabase.com/kb/troubleshooting/cant-revoke-a-role-membership-granted-by-supabase_admin-d08922 .

**Important current CST-DEV difference from earlier synthetic fixtures:** READ ONLY `pg_auth_members` confirmed **TWO existing rows** for `gpt02_store_owner → postgres`:

| Grantor | ADMIN | INHERIT | SET |
| --- | --- | --- | --- |
| `supabase_admin` | TRUE | FALSE | FALSE |
| `postgres` | FALSE | FALSE | FALSE |

The latter is **already present** in CST-DEV. A `REVOKE gpt02_store_owner FROM postgres GRANTED BY postgres` would delete that pre-existing second row. Consequently **do not copy the older one-grantor cleanup procedure or casually REVOKE** just because it passed a fixture with no original self-grant.

A SOURCE-ONLY isolated regression `scripts/dev/test_gpt02_issue159_dual_grantor_owner_custody_pg.py` was added to Core AI PR1754. It verifies that a separate custom-role membership can be temporarily given SET=TRUE in one transaction, used for an exact owner-context protected function, and restored to SET=FALSE before COMMIT, preserving **both** original grantor records; faults roll back completely and restore the baseline; the old REVOKE would remove the existing self-grant. It has no hosted DB connection. CI PG16/PG17 must succeed independently before any use.

**Release policy is unchanged:** official Supabase functionality is not independently authorized custody by itself. A deliberately appointed DBA/security custodian must review and approve the exact CST-DEV source, scope, scheduled window, SQL, role baselines, and postflight session termination. No assistant self-grant, live DB mutation, new password, or transaction carrying a temporarily usable SET on the shared management connection may be inferred from generic `lanjut`. A hosted trial is still **NO-GO** without that authorization.

**Postflight for an authorized future change must independently verify** both original grantor rows including `admin_option`, `inherit_option`, `set_option`, `pg_has_role('postgres','gpt02_store_owner','SET')=false`, owner remains NOLOGIN, zero privileged maintenance sessions, exact helper OID/owner/SECURITY DEFINER/path/ACL, and no unrelated member. If any value drifts, stop the release and perform a reviewed rollback/relock.

## 4. Operational broker and runtime acceptance — separate from installation

A native supervisor, currently uninstalled, must provide all of the following **before any per-task role LOGIN**:

- Verify genuine, fresh, immutable **Owner decision + exact task/command/attempt/nonce**, using original pinned public keys and the already-existing trusted SQLite/persisted reader; deny revoked, missing, replayed or cross-store-divergent authority.
- Derive a fresh isolated `dev_gpt02_task_<task>_<digest>` role from signed scope, not from a browser parameter or shared issuer reader. Enforce exact task, company, command, attempt, approval digest, receipt, fence, worker, expiry by database RLS across all five original lineage tables.
- Native TLS verification and pinned *public* CST-DEV root CA. Dedicated encrypted credentials with no plaintext in chat, CI logs, git commits, common environment variables or reuse of current issuer/Core/attestor credentials.
- Commit exactly one ledger claim before opening the read session; independently attest it through the minimal auditor. The original canonical approval guard must hold a current row lock across the bounded read and recheck validity before releasing it.
- Perform **one bounded canonical read**, no extra statement or role membership escalation. Original proposal's **15-second database issuance TTL is stricter than any operator maintenance window**; a proposed 10-minute maintenance window must never become a 10-minute reader credential.
- Crash/replay/timeout/revocation paths must force **durable NOLOGIN, CONNECTION LIMIT 0, PASSWORD NULL, revoke private column/schema grants, terminate old sessions**, independently read back zero sessions and a clean issuer state. A self-reported JSON cleanup receipt is insufficient.
- Only after these passes: four operational signer custody/transports, non-circular issuer startup ordering with original ledger checks intact, issuer lease, native DELL command/callback and receiver-owned Final ACK. None of these can be assumed from source/CI success.

## 5. Required go/no-go evidence and rollback boundary

**STOP / NO-GO** for wrong project or credential target, owner/admin privilege drift, unknown migration version, existing rows in the private one-read ledgers, unexpected PUBLIC/API EXECUTE, FORCE-RLS or column-grant drift, general-reader reuse, missing immutable signed authority, any residual privileged session, timeout/crash without independently verified terminal relock, signer/source identity mismatch, or any attempt to run historical Task171.

For an approved change, capture independent pre- and post-state snapshots: exact project/ref, source commit and migration checksums, schema and role OIDs/ACLs, function owners and SECURITY DEFINER settings, RLS/policies, number of issuance/consumption/approval rows, privileged session count, native TLS identity, and a full rollback/recovery trial in isolated PostgreSQL before live installation.

Rollback is **not** a blind `DROP SCHEMA CASCADE`, role recreation, owner-grant widening or automatic deletion of append-only evidence. If a live change fails, stop issuance immediately, lock every new temporary role, revoke new grants, end active sessions and verify zero sessions; then let the authorized DBA choose a reviewed object-level rollback that preserves preexisting Phase A/B and immutable records. If proof fails, retain **NO-GO**.

## 6. Current decision and handoff

- **Code/isolated PostgreSQL 16+17 installation-chain compatibility:** PASS.
- **Real CST-DEV DBA-approved owner/credential custody and six-stage installation:** NOT DONE.
- **Real one-use broker + current signed Owner provenance + terminal relock:** NOT DONE.
- **Task183 one legitimate business consent, issuer/DELL/Final ACK:** NOT DONE.
- **Release:** `GPT02_LIVE_E2E=NO_GO`; PRs remain Draft; **PROD untouched**.

The next actionable handoff is to the independently authorized CST-DEV database/security custodian for review and a restricted release plan. **Do not repeat successful synthetic tests instead of closing this external operational dependency.**
