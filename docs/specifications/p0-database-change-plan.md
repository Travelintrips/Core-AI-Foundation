# P0 Database Change Plan

Companion to `p0-enterprise-foundation-implementation-spec.md`. Describes conceptual DB changes only — no migration files, no DDL. Ordering matters: within each P0, additive changes always precede enforcement changes, and enforcement changes always precede destructive/blocking changes (NOT NULL, RLS, dropping the ability to write).

---

## 1. Tenant isolation — schema changes

### 1.1 Add `tenant_id` (nullable, indexed) to tables that don't yet have it
Domains and tables per spec §3.3: Project (`creativeProjectsTable`, `creativeProjectStepsTable`, `aiExecutionPlansTable`), Quotation (`creativeProjectQuotationsTable` — read-time join to parent project only, not a new column, per spec §6.5; `aiQuotationItemsTable` inherits via its parent `aiQuotationsTable`), Job/Worker (`aiJobsTable`, `aiWorkersTable`, `aiWorkloadTable`, `aiTaskAssignmentsTable`), Human-task (`aiHumanTasksTable`, `aiHumanTaskHistoryTable`), Customer (`customerProfilesTable`, `customerSupportTicketsTable`, `customerSupportMessagesTable`, `aiCustomerSegmentsTable`, `aiCustomerDocumentsTable`, `aiCustomerHealthScoresTable`), Asset/brand (`aiAssetLibraryTable`, `aiBrandKitAssetsTable`).

Tables that already have a nullable tenancy column (`aiQuotationsTable.tenantId`, `aiCommercialGatesTable.tenantId`, `aiServicePackagesTable.tenantId`, `aiInstalledPackagesTable.tenantId` (currently `NOT NULL DEFAULT 'default'` — already effectively backfilled, treat as reference pattern), `aiExecutionLogsTable.companyId`, `aiClientMemoryTable.clientId`) need no new column, only enforcement (§1.3) — note `aiExecutionLogsTable`/`aiClientMemoryTable` use differently-named columns (`companyId`/`clientId`); these should be treated as synonyms for tenant identity for enforcement purposes rather than renamed, to avoid an unnecessary column rename touching working code.

Explicitly excluded (platform-global, no tenant column added): `aiAgentsTable`, `aiModelsTable`, `aiProvidersTable`, `aiPromptsTable`, `aiPromptVersionsTable`, `aiSkillsTable`, `aiToolsTable`, `aiWorkflowsTable`, `aiWorkflowExecutionsTable`, `aiCapabilitiesTable`.

Audit/Event tables (`aiAuditLogsTable`, `aiEventsTable`, `aiDecisionLogsTable`, `aiExecutionLogsTable` — latter already has `companyId`) get `tenant_id` as part of §2 below, not duplicated here.

### 1.2 Backfill
Single default-tenant value written to every existing row across all newly-tenanted tables in one backfill pass (matches the current real-world state: one operating agency). Backfill must run before context resolution (WP-01) goes live, so shadow-mode comparisons in WP-02 have something non-null to compare against.

### 1.3 Enforcement-readiness index
`CREATE INDEX` on `tenant_id` for every table in §1.1/§1.2's list before Phase B (progressive enforcement) begins for that table — every enforcing query adds a `tenant_id` predicate, and without an index this silently degrades performance across the board rather than failing loudly, making it easy to miss until production load exposes it.

### 1.4 New columns for propagation points
- `aiSchedulesTable.tenant_id` (nullable at first, backfilled with default tenant, same treatment as above) — needed so scheduler-created jobs/events inherit tenant identity instead of having none.
- `aiJobsTable.payloadJson` gains a conventionally-named top-level `tenantId` key (no schema change needed — it's already JSONB — but this is a **contract** change: every enqueue call site must start populating it, tracked as part of WP-01/WP-03, not a separate schema migration).

### 1.5 Constraint tightening (hardening phase only — last)
`ALTER ... SET NOT NULL` on every `tenant_id`/synonym column above, only after Phase B enforcement is verified complete for that table's domain (spec §3.7 ordering). Attempting this earlier risks breaking any remaining unmigrated code path that still writes rows without a tenant.

### 1.6 Row-Level Security (hardening phase only — last)
Enable RLS on every tenant-scoped table; policy: `USING (tenant_id = current_setting('app.tenant_id')::text)`. Application connection pool must `SET app.tenant_id` per request/job (derived from `RequestContext`) before any query runs in that session/transaction — this is a new piece of connection-handling plumbing, not just a DB-side change, and must be built and tested alongside RLS activation, not assumed to "just work" once policies exist. RLS is strictly a second layer — the repository foundation's filtering is not removed once RLS lands.

---

## 2. Canonical audit log — schema changes

- `ai_audit_logs` gains: `tenant_id` (nullable at first, backfilled with default tenant for historical rows, then NOT NULL for new rows once WP-07 lands — note existing rows may reasonably stay with the default tenant value forever, this is historical data, not a live-enforcement concern the way business tables are) and `actor_type` (`internal_user | customer | public_token | system | worker`, nullable at first for the same reason). `actor_id` already exists — no change needed there, only a change in how consistently it gets populated (application-layer, not schema).
- No new tables are introduced for audit itself. `ai_events` is explicitly left unchanged in shape/purpose (spec §4.2) — only its existing role as the automation event bus continues.
- Application-layer permission change (not a DDL change but must be enforced consistently, e.g. via a dedicated DB role or repository-layer restriction): the service account used by the application should not have `UPDATE`/`DELETE` grants on `ai_audit_logs` once WP-07 completes, providing a real (not just conventional) guarantee of immutability. This is the one item in this plan that is a privilege change worth calling out explicitly, since forgetting it would make "immutable" purely a documentation claim.

---

## 3. Soft delete — schema changes

### 3.1 Add `deleted_at` (nullable timestamp) and `deleted_by` (nullable, references the actor — internal user id or customer profile id, no FK constraint enforced across the two possible actor tables; store as a plain id + a companion `deleted_by_type` if disambiguation is needed at read time) to:
- Every table with a confirmed hard-delete call site (spec §1.4): `aiInstalledPackagesTable`, `aiWorkflowsTable`, `aiCapabilitiesTable`, `aiProvidersTable`, `aiModelsTable`, `aiPromptsTable`, `aiServicesTable`, `aiServicePackagesTable`, `aiServicePriceRulesTable`, `aiAgentsTable`, `aiAgentCapabilitiesTable`, plus the tables touched by the fixture cleanup script (`cpPageCommentsTable`, `creativeAiClientReviewsTable`, `cpDocumentVersionsTable`, `creativeAiAssetsTable`, `creativeProjectsTable`) even though the fixture itself keeps using hard delete (test-only) — production code paths touching these same tables should still gain the safety net.
- Forward-looking additions (no current hard-delete call site, added because they are the highest-damage tables if one is ever introduced): `creativeProjectsTable` (already covered above), `aiQuotationsTable`, `aiQuotationItemsTable`, `creativeProjectQuotationsTable`, `aiInvoicesTable`.

### 3.2 Index
`CREATE INDEX` on `deleted_at` (partial index `WHERE deleted_at IS NULL` is the more useful form for the hot path — default reads filter for exactly this) for every table above, added at the same time as the columns since soft-delete filtering activates immediately in WP-09, unlike tenant isolation's longer shadow period.

### 3.3 No constraint tightening phase
Unlike tenant isolation, soft-delete columns stay nullable forever by design (`NULL` = not deleted is the whole mechanism) — there is no hardening/NOT NULL phase for these columns.

### 3.4 Purge
Purge (WP-12) is a `DELETE ... WHERE deleted_at < now() - retention_interval`, i.e. an actual hard delete, but one that only ever targets rows already marked soft-deleted past a review window — no schema change required beyond what's in §3.1, but the retention interval per domain should be stored in one small config table or the scheduler's own config JSON rather than hardcoded per job, so retention policy changes don't require a code deploy.

---

## 4. Canonical quotation — schema changes

- **No new columns on `creative_project_quotations`** (it is frozen for writes, not actively evolved — adding columns to a table you're trying to retire sends the wrong signal and creates more surface area to migrate away from later).
- **No structural merge of the two quotation tables.** They remain two separate tables indefinitely; `ai_quotations` is canonical for all new commercial activity, `creative_project_quotations` is a permanently-readable historical archive. This avoids a large, risky one-time data-migration DDL effort that the source blueprints and roadmap do not actually require (the decision is "stop writing to the old one," not "merge the old one into the new one").
- **`aiQuotationsTable.tenantId`** (already nullable, per §1.1) follows the same backfill/enforcement/NOT NULL/RLS lifecycle as every other tenant-scoped table, timed to Commercial/Quotation's position (last) in the Phase B domain order (spec §3.7).
- No FK is added from `ai_quotations`/`ai_quotation_items` to `creative_project_quotations` or vice versa — the two systems are related only through the application-layer fork logic in `serviceRequestConversionService.ts` (`gate.quotationId` vs `gate.serviceQuotationId`), which itself is unchanged by this plan (spec §6.2).

---

## 5. Migration ordering (all four P0s combined, DB-change-only view)

1. Backfill default tenant + add nullable `tenant_id`/synonym columns across all tenant-scoped tables (§1.1, §1.2) — additive, zero behavior change.
2. Add `tenant_id`/`actor_type` to `ai_audit_logs` (§2) — additive.
3. Add `deleted_at`/`deleted_by` across the tables in §3.1 — additive.
4. Add indexes (§1.3, §3.2) — additive, but should land before the corresponding enforcement phase turns on, not after (an enforcing query hitting an unindexed column in production is the single most likely self-inflicted incident in this entire program).
5. Add `aiSchedulesTable.tenant_id` (§1.4) — additive.
6. (Application-layer, not DDL) revoke `UPDATE`/`DELETE` grants on `ai_audit_logs` for the service role — timed with WP-07.
7. Progressive enforcement rolls out purely at the application/repository layer (no further schema changes) per spec §3.7's domain order, ending with Commercial/Quotation.
8. Only after step 7 is fully complete for a given table: `ALTER ... SET NOT NULL` on its `tenant_id` (§1.5).
9. Only after step 8 is complete for all tables: enable RLS (§1.6).
10. Purge DDL is just parameterized `DELETE`s against already-nullable `deleted_at` columns — no new DDL, but gated by the dry-run review process in the rollout plan.

---

## 6. Rollback considerations

- Every additive step (1–5) is trivially reversible (`DROP COLUMN`/`DROP INDEX`) with no data-loss risk since nothing has started depending on the new columns being populated correctly yet.
- Enforcement flips (step 7) are reversible in the application layer (feature-flag the repository's enforcing mode back to log-only) without any DB rollback — this is the primary reason enforcement is implemented as an application-layer switch rather than, say, a DB trigger: it needs to be instantly reversible under incident pressure.
- `NOT NULL` (step 8) is only reversible by dropping the constraint — safe, but any code that was relying on the constraint for correctness (e.g. skipping a null-check) must be reviewed before rollback, not just the DDL undone.
- RLS (step 9) is reversible (`ALTER TABLE ... DISABLE ROW LEVEL SECURITY`) but should be treated as a last-resort rollback — disabling it removes the defense-in-depth layer while leaving the primary (repository) layer as the only protection, which is the same posture as before step 9, so rolling it back is safe, just not something to do reflexively for unrelated incidents.
- Purge (step 10) is **not** reversible once executed — this is why it is the only step in this entire plan gated by a mandatory human-reviewed dry-run rather than an automated flag flip.
