# P0 Test and Rollout Plan

Companion to `p0-enterprise-foundation-implementation-spec.md` and `p0-work-package-plan.md`.

---

## 1. Test matrix

### 1.1 Tenant isolation

| Test | Type | Detail |
|---|---|---|
| Cross-tenant read blocked | Security/integration | Session for tenant A requests a resource id known to belong to tenant B (project, quotation, job, human task) → expect `NotFoundError`/404, never the data, never a distinguishable-from-"doesn't exist" error that would leak existence. |
| Cross-tenant write blocked | Security/integration | Tenant A attempts to update/soft-delete a tenant B resource by id → same as above. |
| Forged `tenantId` in request body/query has no effect | Security/regression | Directly targets the WP-00 vulnerability; send `tenantId` for another tenant in body/query on an endpoint that used to trust `parseTenantId`; expect the context-resolved tenant to win, not the supplied value. |
| Public-token resolution derives correct tenant | Integration | Resource-token → project → tenant chain returns the project's actual owning tenant, not a default/fallback. |
| Worker payload carries correct `tenantId` | Integration | Enqueue a job as tenant A, inspect the persisted `payloadJson.tenantId` before the worker claims it. |
| Scheduler-created job inherits schedule's tenant | Integration | Trigger a due schedule owned by tenant A, assert the resulting job's tenant matches. |
| SSE subscription cross-tenant rejected | Integration | Tenant A's session attempts to subscribe to tenant B's project channel by guessing/reusing a project id → connection refused. |
| Shadow-mode mismatch report is empty (or fully explained) | Operational/manual | Run the shadow-mode comparison (WP-02) over a full day of real traffic before flipping any domain to enforcing. |
| RLS fail-closed with no session tenant set | Security | Connect without `app.tenant_id` set → query returns zero rows, not an error that could be misread as "not configured, allow all." |
| Unindexed enforcing query does not exist | Performance | Before enabling enforcement per table, `EXPLAIN` the enforcing query shape and confirm the `tenant_id` index is used. |

### 1.2 Shared repository foundation

| Test | Type | Detail |
|---|---|---|
| Repository read auto-filters tenant + soft-delete | Unit | Default `find`/`list` calls never require the caller to remember either filter. |
| `withoutTenantScope()`/`includeDeleted()` require elevated role | Unit | Calling either escape hatch without the required role throws before any query runs. |
| Nested transaction is rejected | Unit | Passing an already-open transaction handle into a repository method that also tries to open its own top-level transaction throws, rather than silently nesting. |
| Typed errors map to correct HTTP status | Unit | `NotFoundError`→404, `TenantMismatchError`→404 (not 403 — avoid leaking existence, per §1.1's cross-tenant test), `AlreadyDeletedError`→409/410, `ConflictError`→409. |
| Repository write auto-emits exactly one audit row | Integration | No duplicate emission, no missing emission, across create/update/softDelete/restore. |

### 1.3 Canonical audit log

| Test | Type | Detail |
|---|---|---|
| Every repository-mediated write is audited | Integration | For the pilot domain and each subsequently migrated domain, generate one of each write type and assert an audit row exists with correct `tenantId`/`actorId`/`actorType`. |
| Audit rows are immutable | Security | Application service role cannot `UPDATE`/`DELETE` `ai_audit_logs` rows (test against the actual DB grants, not just application code paths). |
| Audit survives source-row purge | Integration | Purge a soft-deleted row (per §3.4 of the DB plan) and confirm its historical audit rows remain intact and still meaningful (denormalized fields present). |
| `ai_events` and audit log remain independent | Regression | Confirm no code path writes audit-only data into `ai_events` or vice versa — the two must not silently merge over time. |
| Sensitive fields excluded from audit diff capture | Security | Writes involving prompts/API keys/tokens do not leak raw secret values into the audit `details`/diff payload. |

### 1.4 Soft delete

| Test | Type | Detail |
|---|---|---|
| Default reads exclude soft-deleted rows | Unit/integration | Per migrated table. |
| Cascading soft-delete covers documented child relationships | Integration | Parent soft-delete → children soft-deleted in the same transaction; verify via a mid-transaction failure injection that neither parent nor children end up partially deleted. |
| Restore requires elevated role and is audited | Security/integration | Non-privileged actor cannot restore; privileged restore produces an audit row. |
| Restore does not resurrect children by default | Regression | Matches spec §5 (WP-10) — explicit design choice, must be tested so it isn't "fixed" accidentally later. |
| Each of the 8 migrated hard-delete call sites behaves identically from the caller's perspective | Regression | Route/service response shape and status code unchanged after migrating from `db.delete` to `softDelete`. |
| Purge dry-run reports accurately, changes nothing | Operational | Run dry-run against a seeded set of aged soft-deleted rows; assert report matches expected set and no rows are actually removed. |
| Live purge only removes rows past retention and already soft-deleted | Integration | Rows soft-deleted but within the retention window are untouched; rows never soft-deleted are untouched regardless of age. |

### 1.5 Canonical quotation

| Test | Type | Detail |
|---|---|---|
| Legacy creation endpoints are disabled post-freeze | Regression | `routes/quotations.ts` creation endpoints return an explicit "frozen" error, not a silent success that writes nowhere or a confusing 500. |
| Legacy reads remain fully functional post-freeze | Regression | Existing legacy quotations remain readable through every consumer indefinitely. |
| Legacy-branch project conversion still works | Regression | `checkAndMaybeConvert` (legacy branch) continues to resolve correctly for gates created before the freeze. |
| Canonical-branch project conversion still works | Regression | `checkAndMaybeConvertByServiceQuotation` unaffected. |
| All four updated consumers resolve both sources correctly | Integration | For one legacy-path project and one canonical-path project, verify `commercialGateService`, `customerWorkspaceService`, `routes/public-review.ts`, `routes/customer-portal.ts` all display consistent, correct status. |
| Non-catalog project quotation path works per the resolved business decision | Integration | Whatever the product owner decides in spec §6.4, cover it with a test before implementation is considered complete. |

---

## 2. Feature flags

All enforcement-level behavior changes (not additive schema changes) go behind flags so they can be toggled per-domain without a deploy:

- `tenant_isolation.enforce.<domain>` — one flag per domain (job_worker, audit_event, customer_human_task, commercial_quotation), default off, flipped per WP-03's ordering.
- `tenant_isolation.rls_enabled` — global, default off, flipped only after all `enforce.*` flags are on and NOT NULL constraints are live.
- `soft_delete.active.<domain>` — governs whether that domain's hard-delete call sites have been switched to soft-delete yet (WP-11 tracks this per site).
- `soft_delete.purge_live.<domain>` — default off (dry-run only) until a human has reviewed at least one dry-run report for that domain.
- `quotation.legacy_writes_frozen` — single global flag, default off until WP-13 ships, then permanently on (this one is not expected to ever be flipped back).

Flags should be checked at the repository/service layer, not scattered across route handlers, so a single toggle reliably changes behavior everywhere that matters.

---

## 3. Deployment gates

1. **Gate before WP-02 (shadow mode)**: WP-00 and WP-01 fully deployed and stable for at least one full traffic cycle; default-tenant backfill (DB plan §1.2) verified complete (row count check: zero NULL `tenant_id` post-backfill on every migrated table).
2. **Gate before any WP-03 domain flip**: that domain's WP-02 shadow report reviewed with zero unexplained mismatches; index in place (DB plan §1.3) and confirmed used via `EXPLAIN`.
3. **Gate before WP-04 (hardening)**: all WP-03 domain flips complete and stable for at least one full traffic cycle each; no remaining direct (non-repository) queries against any tenant-scoped table (grep-verified).
4. **Gate before WP-08 (automatic audit emission) goes live for a domain**: WP-07's schema change deployed; sensitive-field exclusion logic (test 1.3's last row) reviewed and passing.
5. **Gate before WP-11 (any hard-delete→soft-delete migration)**: WP-09/WP-10 stable for the domain; the specific call site's cascade relationships (if any) documented and tested.
6. **Gate before WP-12 live purge for a domain**: at least one dry-run reviewed and explicitly signed off by a human for that domain — this is the single hardest gate in the whole plan and should not be softened under schedule pressure, since it is the only genuinely irreversible step.
7. **Gate before WP-13 (freeze legacy quotation writes)**: product-owner decision on spec §6.4 (non-catalog projects) documented and implemented; Commercial/Quotation domain's WP-03 flip is at least underway (spec §6.6).
8. **Gate before WP-14 consumers are considered done**: all four consumers pass the dual-source integration test (test matrix §1.5) against real historical legacy data, not just synthetic canonical-path data.

---

## 4. Canary / staged rollout

- Tenant isolation enforcement (WP-03) and soft-delete activation (WP-09/WP-11) are inherently already staged per-domain — there is no single "canary percentage" needed on top of that, since each domain flip *is* the canary step for the next one. Treat the first domain flipped in each program (Job/Worker for tenant isolation, whichever hard-delete site is lowest-blast-radius for soft-delete) as the de facto canary and hold it for a full traffic cycle with active monitoring before proceeding to the next domain.
- Audit auto-emission (WP-08) should canary on its pilot domain the same way, watching specifically for write-latency regression (extra insert per write) and audit-table growth rate before rolling to remaining domains.
- Purge (WP-12) has no canary in the traditional sense — dry-run mode *is* its canary, applied per domain, and is mandatory rather than optional (see gate 6 above).
- Quotation freeze (WP-13) is a single global flip, not staged — staging it would mean some new quotations go to the frozen table and some don't, which is more confusing than a clean cutover; its "staging" equivalent is instead the sequencing dependency on WP-03's Commercial/Quotation flip and the business-decision gate.

---

## 5. Observability

- **Tenant isolation**: log every shadow-mode mismatch with enough detail to reconstruct the query (table, resolved tenant, row's actual tenant, endpoint) without logging full row content; dashboard counting mismatches per domain per day, target zero before flip. Post-enforcement, log and alert on every `TenantMismatchError` thrown in production (should be rare-to-never; a spike indicates either an attack attempt or a resolution bug).
- **Repository foundation**: metric for query count/latency before/after repository migration per domain, to catch the unindexed-query risk called out in the DB plan before it becomes a customer-visible incident.
- **Audit log**: growth-rate metric (rows/day) per domain once auto-emission goes live, compared against the previous manual-call-site baseline — a large unexplained jump suggests over-emission (e.g. emitting on reads, not just writes); a flat line where writes are known to be happening suggests under-emission.
- **Soft delete**: count of soft-deleted-but-not-yet-purged rows per domain per age bucket, to make retention-window tuning and purge-readiness visible before flipping `purge_live`.
- **Quotation**: count of new attempts to write to the frozen legacy table post-WP-13 (should be zero; any nonzero count means a consumer was missed) and a dashboard split of "projects resolving via legacy quotation" vs "via canonical quotation" over time, expected to trend toward all-canonical without ever needing to hit zero-legacy (frozen historical data persists by design).

---

## 6. Rollback triggers

| Signal | Rollback action |
|---|---|
| Cross-tenant data exposure detected in production (any severity) | Immediately flip the relevant `tenant_isolation.enforce.<domain>` flag — but note: since enforcement only *adds* filtering, exposure is more likely a sign that enforcement is **not yet on** for the affected domain than that it needs to be rolled back; the actual action is usually "expedite that domain's flip," not "roll back an existing flip." If a rollback candidate is the RLS layer causing an outage (over-restrictive), disable RLS globally (`tenant_isolation.rls_enabled = false`) while leaving repository-layer enforcement on, per DB plan §6. |
| Sustained latency regression after a repository migration or index change | Roll back that domain's repository migration (flip enforcement flag off, revert to direct queries if still present) while the index/query issue is diagnosed. |
| Audit-table write failures causing primary-write failures | Audit emission must never block the primary write it's describing — if this coupling is discovered in production, treat it as a bug (emission should be best-effort/async relative to the primary transaction's success, though still transactionally consistent for the data it does capture) and roll back WP-08 for the affected domain until fixed. |
| Soft-delete cascade leaves orphaned non-deleted children | Roll back WP-10 for the affected relationship; do not attempt a live data-fixup as part of the same incident response — fix forward with a reviewed, separate cleanup step. |
| Purge dry-run report shows unexpected rows scheduled for removal | Hold `purge_live` flip (do not proceed) and treat as a blocking bug in retention-window logic, not a rollback of anything already live (since dry-run has not deleted anything, there is nothing to roll back — this is the entire point of the gate). |
| Quotation consumer shows incorrect status for either source after WP-14 | Roll back WP-14's specific consumer change (each of the four is independently revertable) while WP-13's freeze itself stays in place (freezing writes is safe and should not be reverted just because a read-side consumer bug was found). |
