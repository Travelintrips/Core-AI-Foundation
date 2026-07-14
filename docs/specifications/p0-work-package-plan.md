# P0 Work Package Plan

Companion to `p0-enterprise-foundation-implementation-spec.md`. Sequencing mandate: **WP-00 → P0-1 packages → Shared Repository packages → P0-3 packages → P0-2 packages → P0-4 packages**, with a few explicitly-flagged parallelizable exceptions noted per package.

Legend: **Depends on** lists hard prerequisites (cannot start before). **Parallel-safe with** lists packages with no ordering constraint against each other.

---

## WP-00 — Close the tenant-spoofing vulnerability
- **Scope**: Replace `marketplace.ts`'s client-supplied `parseTenantId` usage in `packageManagerService.ts` with a placeholder single-default-tenant constant (not yet context-resolved — that comes in WP-01) so the trust boundary is closed immediately rather than waiting for the full rollout.
- **Depends on**: nothing.
- **Acceptance criteria**: no code path derives `tenantId` from request body/query/headers; a request supplying a forged `tenantId` has no effect on which rows are returned.
- **Risk**: Low. Isolated, single-service change.

## WP-01 — Request/Tenant Context resolution
- **Scope**: Implement `RequestContext` resolution (§2.1 of the spec) for each entry point: internal/admin session, customer-portal session, public-token routes, worker enqueue-time capture, scheduler tick, SSE subscription admission. Add the new tenant-context middleware into the chain from `p0-database-change-plan.md`'s ordering.
- **Depends on**: WP-00 (conceptually continues it), schema changes in `p0-database-change-plan.md` Phase A (nullable `tenant_id` columns + default-tenant backfill) must land first so context resolution has something to resolve against.
- **Acceptance criteria**: every request/job/schedule-tick/SSE-subscribe produces a `RequestContext` with a non-null `tenantId`; unit tests cover all five resolution strategies including the "no signal available" failure case (must fail closed, not default to a guessable tenant).
- **Risk**: Medium — touches every entry point, but additive (no enforcement yet).

## WP-02 — Tenant isolation: shadow mode
- **Scope**: Repository tenant-filtering added in log-only mode across all tenant-scoped domains; mismatches between filtered and unfiltered results logged for review.
- **Depends on**: WP-01, Shared Repository Foundation skeleton (WP-05) must exist enough to host the filtering logic — see note in WP-05 about the two being co-developed.
- **Acceptance criteria**: a full production-traffic day produces a shadow-mode mismatch report with zero unexplained mismatches (any mismatch is either a known single-tenant artifact or a genuine bug found and fixed before Phase B).
- **Risk**: Low (no user-facing behavior change) but requires log-review discipline — the acceptance criterion is a human review step, not just "code deployed."

## WP-03 — Tenant isolation: progressive enforcement
- **Scope**: Flip repository tenant-filtering to enforcing, domain by domain, in the order Job/Worker → Audit/Event → Customer/Human-task → Commercial/Quotation (per spec §3.7).
- **Depends on**: WP-02 clean shadow report for the domain being flipped; Audit/Event sub-step additionally depends on P0-3's audit schema changes being in place (so audit rows written during/after this step already carry tenant data).
- **Acceptance criteria**: for each domain, cross-tenant read/write attempts (tested explicitly, e.g. tenant A's session requesting tenant B's project id) return `NotFoundError`/403, not data.
- **Risk**: Medium-high for the Commercial/Quotation sub-step specifically (interacts with P0-4); low-medium for the others.

## WP-04 — Tenant isolation: hardening (NOT NULL + RLS)
- **Scope**: `NOT NULL` constraints on all `tenant_id` columns; Postgres RLS policies as the second enforcement layer; removal of any remaining direct (non-repository) queries against tenant-scoped tables.
- **Depends on**: WP-03 complete for all domains.
- **Acceptance criteria**: RLS enabled and verified via a test that connects with a session lacking `app.current_tenant_id` set and confirms zero rows are visible (fail-closed check); no remaining grep hits for direct table imports on tenant-scoped tables outside the repository layer.
- **Risk**: High if attempted before Phase B fully lands (this is explicitly why it's sequenced last) — low if the prerequisite is respected.

## WP-05 — Shared Repository Foundation: skeleton + tenant/soft-delete filtering
- **Scope**: Build the repository base class/pattern (§2.2) with tenant filtering, soft-delete filtering, transaction-boundary support, and the typed error model. Migrate one pilot domain (recommend: Job/Worker, since it's first in the enforcement order and has a bounded set of call sites) end-to-end as the reference implementation.
- **Depends on**: WP-01 (needs `RequestContext` to filter by). Can be developed in parallel with WP-02 (shadow mode needs the filtering logic to exist, so in practice WP-02 and WP-05's skeleton are co-developed — WP-05's skeleton lands first, WP-02 configures it in log-only mode).
- **Acceptance criteria**: pilot domain fully on repository access, zero direct table queries remaining for it; repository unit tests cover tenant filter, soft-delete filter (even though soft-delete columns don't exist yet — filter logic should be written once and activated when columns land in P0-2), transaction composition, and each typed error.
- **Risk**: Medium. Architecturally the highest-leverage package — mistakes here get replicated everywhere else.

## WP-06 — Repository Foundation: migrate remaining domains
- **Scope**: Roll the repository pattern out to Commercial, Customer, Human-task, Project domains (Audit/Event and Quotation get their own packages below since they carry P0-3/P0-4-specific concerns).
- **Depends on**: WP-05.
- **Parallel-safe with**: can be split per-domain across separate implementers since domains don't share call sites (Commercial, Customer, Human-task, Project can proceed independently of each other once WP-05's pattern is proven).
- **Acceptance criteria**: same as WP-05's pilot, per domain.
- **Risk**: Low-medium per domain; mechanical once the pattern is proven.

## WP-07 — Canonical audit log: schema + immutability
- **Scope**: Add `tenantId`/`actorType` to `ai_audit_logs` (per database change plan); remove application-layer update/delete capability for the table.
- **Depends on**: none beyond baseline schema tooling; does not require WP-05 to be complete, but does require WP-01 (needs `RequestContext` fields to populate the new columns going forward).
- **Acceptance criteria**: schema migration applied; an attempt to `UPDATE`/`DELETE` an audit row through the repository layer (once WP-08 lands) throws; existing 8 manual `logAudit` call sites continue to work unmodified (backward compatible, optional new fields).
- **Risk**: Low.

## WP-08 — Canonical audit log: automatic emission via repository
- **Scope**: Wire the repository foundation's create/update/softDelete/restore methods to auto-emit audit records (§2.2.3).
- **Depends on**: WP-05 (repository must exist), WP-07 (schema must accept the new fields).
- **Acceptance criteria**: for the pilot domain from WP-05, every write produces exactly one audit row with `tenantId`, `actorId`, `actorType`, `action`, before/after diff populated, with no manual `logAudit` call added by the developer.
- **Risk**: Medium — diff-capture logic (before/after) needs care to avoid capturing sensitive fields (prompts, keys) into a table that, unlike the customer-facing canonical event projection, is allowed to hold sensitive internal detail but should still not become a secrets-leak vector if the audit table itself is ever exposed via an admin UI.

## WP-09 — Soft delete: schema + repository filtering activation
- **Scope**: Add `deleted_at`/`deleted_by` to the table list in spec §5.1; activate the soft-delete filtering already scaffolded in WP-05 (was written but inert until columns exist).
- **Depends on**: WP-05, WP-08 (soft-delete/restore actions must be audited from day one, per spec's audit-before-soft-delete ordering).
- **Acceptance criteria**: default repository reads exclude soft-deleted rows; `includeDeleted()` opt-in works and is itself logged as a privileged read (not just a normal audit-write event — a lighter-weight access log is acceptable here, to be decided during implementation, not mandated by this spec).
- **Risk**: Low-medium.

## WP-10 — Soft delete: cascading + restore flow
- **Scope**: Implement cascading soft-delete for parent/child relationships (e.g. project → steps); build the restore flow with role-gated access.
- **Depends on**: WP-09.
- **Acceptance criteria**: soft-deleting a `creativeProjectsTable` row soft-deletes its `creativeProjectStepsTable` children in the same transaction; restoring the parent does not automatically restore children unless explicitly requested (avoids surprising resurrection of business state the restorer didn't intend); restore requires the elevated role check.
- **Risk**: Medium — cascade graphs must be enumerated per table, not assumed.

## WP-11 — Soft delete: replace hard-deletes one at a time
- **Scope**: Migrate each of the 8 confirmed hard-delete call sites (spec §1.4/§5.5) to `softDelete`, in the specified low-to-high blast-radius order, excluding the test fixture (left as a hard delete intentionally — it's test cleanup, not production data).
- **Depends on**: WP-09, WP-10 for any of the 8 sites that have cascading children.
- **Parallel-safe with**: each call site is independent of the others and can be assigned to different implementers in parallel once WP-09/WP-10 land.
- **Acceptance criteria**: for each migrated site, the route/service behavior is unchanged from the caller's perspective (still returns success, resource is "gone" from normal reads) but the row is recoverable via `includeDeleted()`/restore.
- **Risk**: Low per site.

## WP-12 — Soft delete: retention/purge job
- **Scope**: Scheduler-driven purge job per domain, dry-run mode first.
- **Depends on**: WP-11 (need real soft-deleted rows accumulating before purge logic is meaningful to test).
- **Acceptance criteria**: dry-run report reviewed and signed off per domain before that domain's purge is switched to live; live purge only removes rows past the configured retention window with `deleted_at` set.
- **Risk**: High if activated live without the dry-run review step — this is why dry-run is a hard gate, not a suggestion, in the acceptance criteria and in `p0-test-and-rollout-plan.md`.

## WP-13 — Canonical quotation: freeze legacy writes
- **Scope**: Disable creation endpoints in `routes/quotations.ts` (reads remain available); document the legacy branch in `serviceRequestConversionService.ts` as permanently read-only-forever code.
- **Depends on**: WP-03's Commercial/Quotation enforcement sub-step should be underway or complete (spec §6.6) — freezing legacy writes while tenant enforcement for this domain is still in shadow mode is acceptable but the two should not be more than one sub-step apart to avoid a long window where the domain is mid-migration on two axes at once.
- **Acceptance criteria**: no new rows can be created in `creative_project_quotations` via any route; existing reads (public-review, customer-portal, workspace) are unaffected at this point (consumer updates come in WP-14).
- **Risk**: Medium — requires the business decision from spec §6.4 (non-catalog projects) to be resolved first, or this package blocks.

## WP-14 — Canonical quotation: update dual-source consumers
- **Scope**: Update `commercialGateService.ts`, `customerWorkspaceService.ts`, `routes/public-review.ts`, `routes/customer-portal.ts` to correctly resolve both quotation sources per spec §6.3.
- **Depends on**: WP-13.
- **Acceptance criteria**: for a project on the legacy path and a project on the canonical path, both display correct, equivalent quotation status through every one of the four consumers; no consumer silently ignores one source.
- **Risk**: Medium — highest risk of subtle regressions since it touches customer-facing status displays directly.

---

## Sequencing summary (critical path)

WP-00 → WP-01 → WP-05 (skeleton, pilot domain) → WP-02 (shadow) → WP-07 → WP-08 → WP-09 → WP-10 → WP-11 → WP-12 (soft-delete track) **and in parallel** WP-06 (remaining repository domains) → WP-03 (progressive enforcement, ends with Commercial/Quotation) → WP-13 → WP-14 → WP-04 (hardening, last).

Total: 15 work packages (WP-00 through WP-14). Highest-risk packages: WP-04 (hardening, if sequenced early), WP-12 (purge, if dry-run skipped), WP-13/14 (quotation consumer updates, if the business decision in spec §6.4 is skipped or consumers are updated inconsistently).
