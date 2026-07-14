# P0 Enterprise Foundation — Implementation Specification

Status: Draft specification (no code, no migrations). Derived from `docs/audit/enterprise-readiness-audit-2026-07-14.md`, `docs/audit/enterprise-readiness-audit-validation-2026-07-14.md`, `docs/roadmap/enterprise-platform-roadmap-2026-07-14.md`, the four `docs/blueprints/p0-*` documents, and direct source-code inventory of `lib/db/src/schema/*`, `artifacts/api-server/src/**`. Companion documents: `p0-work-package-plan.md`, `p0-database-change-plan.md`, `p0-test-and-rollout-plan.md`, `p0-file-impact-matrix.md`.

Sequencing mandate for this spec: **P0-1 Tenant Isolation → Shared Repository Foundation → P0-3 Canonical Audit Log → P0-2 Soft Delete → P0-4 Canonical Quotation.** This order differs from the roadmap's "parallel" framing because the repository layer is the mechanism that makes tenant filtering, soft-delete filtering, and audit emission enforceable in one place instead of three uncoordinated efforts. Building it right after tenant isolation lands, and before audit/soft-delete/quotation, avoids having to retrofit three domains twice.

---

## 1. Source Inventory Summary (Tahap 1 — verified against code, not docs)

### 1.1 Tables by domain (from `lib/db/src/schema/*.ts`)

| Domain | Tables |
|---|---|
| Project | `creativeProjectsTable`, `creativeProjectStepsTable`, `aiExecutionPlansTable` |
| Quotation (dual) | `aiQuotationsTable`, `aiQuotationItemsTable`, `creativeProjectQuotationsTable` |
| Commercial | `aiCommercialGatesTable`, `aiInvoicesTable`, `aiPaymentSchedulesTable`, `aiPaymentMilestonesTable`, `aiCostRecordsTable`, `aiWorkflowCostsTable`, `aiCouponsTable`, `aiCouponUsagesTable` |
| Job/Worker | `aiJobsTable`, `aiWorkersTable`, `aiWorkloadTable`, `aiTaskAssignmentsTable` |
| Audit/Event | `aiAuditLogsTable`, `aiEventsTable`, `aiEventSubscriptionsTable`, `aiDecisionLogsTable`, `aiExecutionLogsTable`, `salesFunnelEventsTable` |
| Customer | `customerProfilesTable`, `customerSupportTicketsTable`, `customerSupportMessagesTable`, `aiCustomerSegmentsTable`, `aiCustomerDocumentsTable`, `aiCustomerHealthScoresTable` |
| Human task | `aiHumanTasksTable`, `aiHumanTaskHistoryTable` |
| Workforce | `aiEmployeesTable`, `aiDepartmentsTable`, `aiEmployeePerformanceTable`, `aiEmployeeSkillsTable` |
| Marketplace/Catalog | `aiServicePackagesTable`, `aiServiceRequestsTable`, `aiServicePriceRulesTable`, `aiServicePortfoliosTable`, `portfolioReviewsTable`, `aiServiceFaqsTable`, `aiLivePreviewsTable`, `aiInstalledPackagesTable` |
| AI platform core | `aiAgentsTable`, `aiModelsTable`, `aiPromptsTable`, `aiPromptVersionsTable`, `aiSkillsTable`, `aiToolsTable`, `aiWorkflowsTable`, `aiWorkflowExecutionsTable` |
| Asset/brand | `aiAssetLibraryTable`, `aiBrandKitAssetsTable` |
| Client memory | `aiClientMemoryTable` |

**Tenancy today:** only a minority of tables carry a nullable `tenantId`/`companyId`/`clientId` column (`aiQuotationsTable`, `aiCommercialGatesTable`, `aiServicePackagesTable`, `aiInstalledPackagesTable`, `aiExecutionLogsTable`, `aiClientMemoryTable`, and the domains named in the blueprint: `aiServiceRequestsTable`, `aiServicePriceRulesTable`, `aiWorkflowCostsTable`). None of the Project, Job/Worker, Audit/Event, Human-task, or AI-platform-core tables have any tenancy column. No `WHERE tenant_id = ...` enforcement exists anywhere except an ad-hoc, request-trusting check in `packageManagerService.ts` (via `marketplace.ts`'s `parseTenantId`, which reads tenant identity from client-supplied body/query — a spoofable trust boundary, confirmed vulnerability).

**Soft delete today:** does not exist as a generic mechanism. What looks like it (`archived` boolean on `aiAssetLibraryTable`/`aiBrandKitAssetsTable`, `status: 'expired'/'cancelled'/'waived'` enums elsewhere) is business-state, not lifecycle-state — none of it means "this row should be excluded from all default reads and eventually purged." Confirmed hard deletes exist in at least 8 call sites across the codebase (see §1.4), spanning fixtures, package management, workflow deletion, registry deletion, prompt deletion, catalog deletion, and agent deletion — i.e. hard delete is the default pattern for "remove," not the exception.

**Audit today:** `aiAuditService.logAudit(module, action, resourceId, resourceType, status, details)` writes to `ai_audit_logs`. The live table (verified in `ai-audit-logs.ts`) already has `actorId` as a column — one blueprint assumption ("no actorId column") is **out of date**; however `actorId` is optional/not populated by most call sites, and there is still no `tenantId`, no `actorType`, and no enforcement that every mutation calls `logAudit`. It is opt-in, per-call-site, "fire and forget" (try/catch swallow), confirmed at 8+ call sites (zipDeliveryService, jobWorkerService, brandKitEnterpriseService, assetLibraryService, workerClusterService, customer-workspace, agents, cp-review) out of a much larger set of mutating routes/services — most mutations are **not** audited today.

**Two distinct event mechanisms already exist and must not be conflated:**
- `aiEventsTable` (`ai-events.ts`): a real, persisted event-bus table with `eventId`, `eventType`, `sourceModule`, `sourceId`, `correlationId`, `causationId`, `payloadJson`, `metadataJson`, `status`, `publishedAt`, `processedAt`, `createdAt` — this is the Phase 5.5 event bus backbone (`publishSafe`, scheduler `publish_event` target type), used for cross-service dispatch/automation, not for human-readable audit trails.
- `canonicalEventService.ts` ("Canonical Runtime Event Model v4.0C"): **not a table** — a virtualized read-side projection/adapter that synthesizes `CanonicalEvent` objects on the fly from `creative_projects`, `creative_project_steps`, `creative_ai_assets`, `creative_ai_client_reviews`, with deterministic `eventId`s and a customer-safe metadata filter. It feeds the customer workspace activity feed (`customerWorkspaceService.getProjectDetail`).

These are three different things (`ai_audit_logs`, `ai_events`, `canonicalEventService`'s projection) that the roadmap's "converge on canonical event model" language could easily cause someone to merge incorrectly. §5 resolves this explicitly.

### 1.2 Routes, middleware, auth (from `artifacts/api-server/src/routes/index.ts`, `src/middleware/*.ts`)

Mount order: `healthRouter` (`/healthz`) → `storageRouter` (`/storage`) → `internalAuthRouter` (`/internal/auth`) → `internalCatalogRouter` (`/internal/catalog`) → `agentsRouter`/`registryRouter`/`orchestratorRouter`/`workflowsRouter`/`promptsRouter`/`knowledgeRouter`/`memoryRouter` (all under `/ai/*`) → `creativeAiRouter` (`/ai/creative-projects`) → `customerPortalRouter` (`/api/customer-portal`) → `publicReviewRouter` (`/api/public/creative-review`) → `portfolioPublicRouter` (`/ai/portfolio`).

Middleware:
- `adminAuth.ts`: accepts `ADMIN_API_KEY` (header) OR internal-user session cookie; attaches `req.internalUser` when session-based.
- `internalAuth.ts`: `requireAuth` validates the session cookie and loads the internal user; `requireInternalRole` checks role/active status against DB; `requirePasswordChanged` blocks stale-password sessions.
- `paymentGate.ts`: `requirePaymentVerified` / `requireFilesUnlocked` check `creativeProjectsTable.status`/`filesUnlocked` directly — no identity attached, purely a project-state gate.
- `rateLimiter.ts`: tiered IP-based limits (global 200/15min, tighter tiers for payments/AI/login).
- `ssrfGuard.ts`: validates outbound URL fields in request bodies against private-IP/cloud-metadata ranges.

Public token-based routes: `artifacts/api-server/src/routes/public.ts`, identity resolved by hashing the supplied token and looking it up against `creativeAiClientReviewsTable.reviewTokenHash` — no session, no tenant context, purely resource-token → row.

**Structural fact with direct tenant-isolation consequence:** there is no middleware, anywhere in this chain, that resolves or attaches a tenant identity to `req`. `req.internalUser` exists; `req.tenantId` does not. This confirms the blueprint's "zero enforcement" finding and fixes the exact insertion point: a new middleware must sit after `adminAuth`/`internalAuth`/token-resolution and before route handlers, populating `req.tenantContext` from whichever identity signal is already present (internal session, resource token, or schedule/worker-internal call).

### 1.3 Dual quotation flow (from routes/services, verified)

- **Legacy path** (`creative_project_quotations`, `routes/quotations.ts`): CRUD, issuance, customer feedback all still live. Consumers: `serviceRequestConversionService.ts` (`checkAndMaybeConvert`, legacy branch, resolves `gate.quotationId`), `customerWorkspaceService.ts` (workspace views), `commercialGateService.ts` (links `quotationId` to gates), `routes/public-review.ts`, `routes/customer-portal.ts` (`getCustomerReviewData`).
- **Canonical path** (`ai_quotations` + `ai_quotation_items`, `routes/aiQuotations.ts`, `aiQuotationService.ts`): full lifecycle (insert/update/status transitions/token-based public access), created automatically from `routes/catalog.ts` when a service request is quoted, consumed by `serviceRequestConversionService.ts`'s second branch (`checkAndMaybeConvertByServiceQuotation`, resolves `gate.serviceQuotationId`, and — unlike the legacy branch — can **create** a new `creativeProjectsTable` row from `briefJson` if none exists yet), and by the customer-portal/ai-platform frontends (`use-catalog.ts`, `service-requests.tsx`).
- Both branches converge in `serviceRequestConversionService.ts` (common flow ~L211-305): generate payment schedule, set `aiServiceRequestsTable.status = converted_to_project`, `logAudit`, trigger `runCreativeBriefWorkflow`.

This confirms the blueprint's decision is sound and gives an exact fork point (`gate.quotationId` vs `gate.serviceQuotationId`) that P0-4's migration plan must handle explicitly rather than assuming a clean cutover.

### 1.4 Hard delete inventory (verified, not exhaustive of every future call site but of everything found in current source)

| File:Line | Table(s) | Trigger |
|---|---|---|
| `cp-review-fixture.ts:44-50` | `cpPageCommentsTable`, `creativeAiClientReviewsTable`, `cpDocumentVersionsTable`, `creativeAiAssetsTable`, `creativeProjectsTable` | test/fixture cleanup script |
| `packageManagerService.ts:215` | `aiInstalledPackagesTable` | package removal |
| `workflows.ts:83` | `aiWorkflowsTable` | `delete_workflow` route |
| `seed.ts:227` | `aiCapabilitiesTable` | system reset |
| `registry.ts:138, 305` | `aiProvidersTable`, `aiModelsTable` | registry deletion routes |
| `prompts.ts:85` | `aiPromptsTable` | `delete_prompt` route |
| `portfolio.ts:241, 280, 760` | `aiServicesTable`, `aiServicePackagesTable`, `aiServicePriceRulesTable` | catalog deletion routes |
| `agents.ts:98, 147` | `aiAgentsTable`, `aiAgentCapabilitiesTable` | `delete_agent` route |
| (previously confirmed) `cp-review.ts:611` | client review row | rejection/cleanup path |

None of these are business-critical creative-project or commercial-record deletes today (the highest-risk ones — projects, quotations, invoices — are not hard-deleted in the live paths), which lowers urgency but does not remove the requirement: catalog/agent/workflow/prompt/registry deletes are admin-triggered, low-frequency, but still destroy audit-relevant history with no recovery path.

### 1.5 Job/worker/scheduler/SSE mechanics (relevant to tenant-context propagation and audit)

- `aiJobsTable` claiming uses `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction (`jobWorkerService.claimJob`), filtered by `status`, `scheduled_at`, and JSONB-contains on `required_capability`. `payloadJson` is an untyped `Record<string, unknown>` bag (common fields: `prompt`, `systemPrompt`, `modelId`, `temperature`, `maxTokens`, `projectId`, `deliveryId`, `portfolioAssetId`, `sourceUrl`, `storagePath`) — there is no `tenantId` field in the payload today, which is exactly the "captured-at-enqueue-time" gap the tenant-isolation blueprint flags for workers.
- SSE (`sseManager.ts`) channels are keyed by `projectId` (not tenant), with per-IP/per-token/per-project connection caps — safe today only because there is no tenant boundary to cross; once tenant isolation lands, channel subscription must additionally verify the subscriber's tenant matches the project's tenant, or a token from tenant A could subscribe to tenant B's project stream if it ever guessed/leaked a project id.
- Export workers (`creativeDocumentWorkerService.ts`, `creativePresentationWorkerService.ts`) read `creativeProjectsTable` by internal `projectDbId` with **no explicit ownership/tenant check in the worker itself** — they trust that whatever enqueued the job already validated ownership. This is the textbook "resource-derived, captured-at-enqueue-time" tenant resolution case from the blueprint: the fix belongs in the enqueue path (attach `tenantId` to the job payload) and in a repository-layer read guard, not in each worker.
- `aiSchedulerService.ts` `targetType` enum: `create_job`, `publish_event`, `webhook`, `audit_log`. Schedules claim due rows via the same `FOR UPDATE SKIP LOCKED` pattern (`tick()`), then dispatch to `createJobFromSchedule` etc. Schedules are the other "no live request" identity source the blueprint calls out — tenant identity must be stored on the schedule row itself and copied forward into whatever it creates.

---

## 2. Shared Foundation Design

This is the piece inserted between P0-1 and the other three P0s per the sequencing mandate. Its job is to make tenant filtering, soft-delete filtering, and audit emission *structural* (enforced by the data-access layer) rather than *conventional* (relying on every future developer remembering three separate rules on every query).

### 2.1 Request/Tenant Context

A single `RequestContext` object, resolved once per request/job/schedule-tick and threaded explicitly (not via ambient global state — this codebase has no request-scoped storage today and introducing `AsyncLocalStorage` as a new implicit-context mechanism is a bigger, riskier change than the P0 scope justifies) through service and repository calls:

```
RequestContext {
  tenantId: string            // resolved, never client-suppliable
  actorId: string | null      // internal user id, customer profile id, or null for system/worker
  actorType: 'internal_user' | 'customer' | 'public_token' | 'system' | 'worker'
  requestId: string           // correlation id, generated per request/job
  source: 'http' | 'worker' | 'scheduler' | 'sse'
}
```

Resolution strategy by entry point (confirms and formalizes the blueprint's hybrid model against the actual middleware chain in §1.2):
- **Internal/admin routes** (session via `internalAuth.requireAuth`): tenant resolved from the internal user's own tenant assignment (today: implicit single-tenant; the internal-user schema needs a `tenantId` — see database change plan). `actorType = internal_user`.
- **Customer-portal routes**: tenant resolved from `customerProfilesTable` row backing the session. `actorType = customer`.
- **Public-token routes** (`routes/public.ts`, `routes/public-review.ts`): tenant resolved by walking token → resource (e.g. review → project) → project's tenant. Never accept a `tenantId` from body/query (this is precisely the `parseTenantId` vulnerability pattern in `marketplace.ts` that must be eliminated, not extended). `actorType = public_token`.
- **Workers**: tenant resolved at **enqueue time** from the enqueuing request's context and stored as a first-class `tenantId` field on `aiJobsTable`/`payloadJson` (not inferred later from the target row, which is the current implicit behavior and the exact gap named in §1.5). `actorType = worker`.
- **Scheduler**: tenant resolved from the schedule row's own `tenantId` (schedules must gain this column) and copied into any job/event/audit record they create. `actorType = system` unless the schedule was created on behalf of a specific tenant, in which case `actorId` may still be null but `tenantId` must not be.
- **SSE subscriptions**: tenant resolved the same way as the request that opened the connection (session or public token), then checked against the target project's tenant before the subscription is admitted — closing the gap in §1.5.

### 2.2 Shared Repository Foundation

A thin repository layer per tenant-scoped table (not a generic ORM replacement, not applied to platform-global tables like `aiProvidersTable`/`aiModelsTable`/`aiAgentsTable` that have no tenant concept and are intentionally shared across the whole platform). Responsibilities, all enforced centrally so no call site can opt out silently:

1. **Tenant filtering**: every read/update/delete method requires a `RequestContext` and injects `WHERE tenant_id = :ctx.tenantId` automatically; there is no method signature that allows omitting it. Cross-tenant reads (e.g. an internal admin dashboard that legitimately needs to see multiple tenants) go through an explicitly-named `withoutTenantScope()` escape hatch that requires an elevated role check and is itself audited.
2. **Soft-delete filtering**: default read methods add `WHERE deleted_at IS NULL`; a separate `includeDeleted()` opt-in exists for restore/admin flows. This is deliberately colocated with tenant filtering (both are "silent WHERE clause injection" concerns) so one review of the repository layer covers both invariants at once — this is why the repository foundation is sequenced immediately after tenant isolation and before soft-delete's own rollout.
3. **Audit emission**: every write method (`create`/`update`/`softDelete`/`restore`) that goes through the repository automatically emits a canonical audit record carrying `tenantId`, `actorId`, `actorType`, `action`, `resourceType`, `resourceId`, `before`/`after` diff (best-effort, JSON-serializable fields only) — this is what turns audit from "8 call sites remembered it" into "every repository-mediated write gets it for free." Call sites that must bypass the repository (raw SQL for performance, bulk operations) retain a manual `logAudit`-equivalent call, but the number of such call sites should shrink over time, not grow.
4. **Transaction boundaries**: the repository's write methods accept an optional transaction handle so multi-step service operations (e.g. quotation approval → gate update → project creation) can be composed inside one `db.transaction(...)`. Repository methods must never open their own top-level transaction if called with one already provided (no nested-transaction footguns).
5. **Error model**: repository methods throw a small set of typed errors (`NotFoundError`, `TenantMismatchError`, `AlreadyDeletedError`, `ConflictError`) instead of letting raw driver/Postgres errors leak to route handlers; route handlers map these to HTTP status codes in one place instead of each route re-deriving status codes from error messages.

Rollout order within each domain migrated to the repository layer: introduce the repository alongside existing direct-query code (no behavior change) → migrate reads → migrate writes → remove direct table access for that domain. This mirrors the "additive, then progressive enforcement, then hardening" 3-phase shape used by both the tenant-isolation and soft-delete blueprints, applied once at the shared-layer level instead of three times independently.

### 2.3 Why this ordering resolves the audit/quotation/soft-delete dependencies

- **Audit before soft-delete**: soft-delete's own blueprint requires that every soft-delete and restore action be audited with actor/tenant attached; that only works cleanly if the audit path already accepts `tenantId`/`actorId` as first-class fields (P0-3 delivers this) before soft-delete (P0-2) starts emitting through it.
- **Soft-delete before quotation canonicalization**: the quotation blueprint's decision to freeze (not delete) the legacy `creative_project_quotations` table for new writes, while keeping reads available, is exactly the soft-delete-adjacent pattern (mark as legacy/inactive, never hard-delete historical commercial records) — having the soft-delete convention and repository support already in place gives P0-4 a ready-made mechanism instead of inventing a one-off "legacy" flag.
- **Tenant isolation before quotation canonicalization** (two-way dependency the roadmap itself flags): `ai_quotations` already has a nullable `tenantId`; `creative_project_quotations` has none. Any migration that reconciles the two tables must decide tenant attribution for historical legacy rows, which is only answerable once P0-1's tenant-resolution rules (in particular, "resource-derived from project" for historical/orphan rows) exist.

---

## 3. Tenant Isolation Specification

Scope: adopt the blueprint's target model (hybrid resolution, defense-in-depth via repository + RLS, 3-phase rollout: shadow mode → progressive enforcement → hardening) with the concrete resolution rules in §2.1 and these codebase-specific additions:

1. **Tenant identity model**: tenant = the agency/org operating the platform (confirmed, not the agency's end customers). Practically, for the current single-agency deployment this may resolve to a single default tenant row everywhere at first (shadow mode), which is intentional — the goal of P0-1 is not "support multiple agencies tomorrow," it's "make it structurally impossible to leak data across tenants once there are more than one," matching the roadmap's framing of tenant isolation as a reputational/legal risk-reduction measure, not a new-market feature.
2. **Eliminate the existing vulnerability first**: `marketplace.ts`'s `parseTenantId` (trusts client-supplied tenant id) must be replaced by context-resolved `tenantId` from §2.1 as the very first change in Phase 1 (shadow mode) — this is a real spoofing vector today and should not wait for the full rollout to close.
3. **Which tables get `tenant_id`**: every table in the Project, Quotation, Commercial, Job/Worker, Human-task, Customer, Asset/brand domains (§1.1) needs a `tenant_id` column. Platform-global catalog tables (`aiAgentsTable`, `aiModelsTable`, `aiProvidersTable`, `aiPromptsTable`, `aiSkillsTable`, `aiToolsTable`, `aiWorkflowsTable`) are explicitly **out of scope** — they are shared platform configuration, not tenant data, and adding tenant scoping to them would be over-engineering not supported by evidence (consistent with the roadmap's "don't add unrequested capability" principle). Audit/Event tables (`aiAuditLogsTable`, `aiEventsTable`, `aiDecisionLogsTable`, `aiExecutionLogsTable`) need `tenant_id` as part of P0-3, tracked there rather than duplicated in this section.
4. **Enforcement mechanism**: repository-layer filtering (§2.2) is the primary enforcement; Postgres RLS policies keyed on a session-local `app.current_tenant_id` setting are the defense-in-depth secondary layer, activated only in the hardening phase once every table has a backfilled, NOT NULL `tenant_id` — turning on RLS before backfill is complete would break every existing query, which is why RLS is explicitly sequenced last in `p0-database-change-plan.md`.
5. **Worker/schedule propagation**: `aiJobsTable.payloadJson` gains a top-level `tenantId` field populated at enqueue time (never re-derived by the worker from the target resource, since that is precisely today's unenforced trust assumption in `creativeDocumentWorkerService.ts`/`creativePresentationWorkerService.ts`). `aiSchedulesTable` gains a `tenant_id` column.
6. **SSE**: `sseManager.ts` subscription admission gains a tenant-match check between the subscribing context's tenant and the target project's tenant, in addition to the existing per-IP/per-token/per-project caps.
7. **Migration phases** (adopting blueprint's 3-phase shape, made concrete):
   - Phase A (shadow): add nullable `tenant_id` columns everywhere per §3.3 (already true for a subset), backfill a single default tenant value for all existing rows, add context resolution (§2.1) and repository tenant-filtering in **log-only** mode (filter computed and compared against what an unfiltered query would have returned, mismatches logged, no request ever blocked or altered).
   - Phase B (progressive enforcement): flip repository tenant-filtering to enforcing, one domain at a time, in this order: Job/Worker → Audit/Event (needed before P0-3 can rely on it) → Customer/Human-task → Commercial/Quotation (last domain, deliberately after P0-4's canonical decision is implemented, since quotation is the domain with the two-way dependency).
   - Phase C (hardening): make `tenant_id` `NOT NULL` on every migrated table, enable RLS policies as the second enforcement layer, remove any remaining direct (non-repository) queries against tenant-scoped tables.

---

## 4. Canonical Audit Log Specification

1. **Target model**: `ai_audit_logs` gains first-class `tenantId` and `actorType` columns (`actorId` already exists per §1.1's corrected finding, but is rarely populated — the repository foundation's automatic emission (§2.2.3) is what actually gets it populated consistently, not a schema change alone).
2. **`ai_events` stays what it is** (event-bus/automation backbone) and is not repurposed as the audit table — conflating "internal system event used to trigger downstream automation" with "human/security audit trail" would compromise both: audit needs to be append-only and long-retained; the event bus needs to support consumption/processing-state transitions (`status`, `processedAt`) that an immutable audit log should not have.
3. **`canonicalEventService`'s projection stays a read-side adapter for the customer-facing activity feed**, explicitly out of scope for the audit log itself (it already strips sensitive metadata for customer consumption, which is the opposite of what an internal audit trail needs — audit must capture full detail, feed must show only safe detail). Do not merge these two purposes into one table; keep two independent representations reading from a common set of underlying mutations.
4. **Emission path**: primary emission moves from "developer remembers to call `logAudit` at ~8 scattered call sites" to "repository foundation writes automatically on every create/update/soft-delete/restore" (§2.2.3). `logAudit` remains available for the minority of writes that must bypass the repository (bulk/raw-SQL operations), but its call sites should be enumerated and tracked as debt, not treated as the primary path going forward.
5. **Immutability**: no `UPDATE`/`DELETE` permission on `ai_audit_logs` at the application layer once P0-3 lands (repository foundation never exposes update/delete methods for this table); this is what makes it usable as an actual audit trail rather than a mutable log table.
6. **Retention**: audit records are exempt from the soft-delete/purge cycle that applies to business data (P0-2) — audit history must outlive the records it describes, including records whose owning tenant or project has since been purged (store enough denormalized context — tenant id, resource type/id, actor id — directly on the audit row so it remains meaningful after the source row is gone).

---

## 5. Soft Delete Specification

1. **Columns**: `deleted_at` (nullable timestamp) and `deleted_by` (nullable actor reference) added to every table currently subject to a real hard-delete call site (§1.4) plus the core business tables the blueprint calls out (`creativeProjectsTable`, quotation tables, invoices) as forward-looking protection even though they have no hard-delete call site today — these are the tables where an accidental hard delete would be the most damaging, so the safety net goes in ahead of any actual incident, not after one.
2. **Cascading**: children of a soft-deleted parent (e.g. `creativeProjectStepsTable` rows under a soft-deleted `creativeProjectsTable` row) are soft-deleted in the same transaction as the parent, using the transaction-boundary support in §2.2.4 — never a separate best-effort follow-up step.
3. **Default filtering**: repository foundation (§2.2.2) auto-excludes soft-deleted rows from all default reads; restore/admin flows use the explicit `includeDeleted()` opt-in.
4. **Restore flow**: requires an elevated role check (reusing `internalAuth.requireInternalRole`, not a new parallel permission system) and is itself an audited action (P0-3 dependency — this is why audit lands before soft-delete).
5. **Replacing existing hard-deletes**: each of the 8 confirmed call sites in §1.4 is migrated one at a time to call the repository's `softDelete` instead of `db.delete(...)`, in ascending order of blast radius (fixture cleanup script is exempt — test-only — then package/prompt/registry/workflow/catalog/agent deletion routes, in that order, lowest-traffic admin routes first).
6. **Retention/purge**: a scheduler-driven purge job (reusing `aiSchedulesTable`'s `create_job` target type, §1.5) permanently removes rows past a configurable retention window after `deleted_at`, but only after a mandatory dry-run mode (reports what it would purge without purging) has been run and reviewed at least once per domain before that domain's purge is activated for real.

---

## 6. Canonical Quotation Specification

1. **Decision** (already made in blueprint, confirmed against code in §1.3): `ai_quotations` + `ai_quotation_items` is canonical. `creative_project_quotations` is frozen for new writes (no new rows created via `routes/quotations.ts`'s creation endpoints once this lands) but remains readable indefinitely and is never hard- or soft-deleted as a table — it is historical commercial record, subject to the same "never destroy commercial history" principle as invoices.
2. **The fork point that must be handled explicitly**: `serviceRequestConversionService.ts` currently branches on `gate.quotationId` (legacy) vs `gate.serviceQuotationId` (canonical). Freezing legacy writes does not remove the legacy branch — gates created before the freeze still carry `quotationId` and must keep resolving correctly forever. The legacy branch in `checkAndMaybeConvert` is not deleted; it becomes read-only-forever code, documented as such.
3. **Consumers requiring explicit handling, not silent breakage**: `commercialGateService.ts` (dual `quotationId`/`serviceQuotationId` linkage stays dual, not collapsed to one column), `customerWorkspaceService.ts` (workspace views must keep resolving whichever quotation type a given project actually has), `routes/public-review.ts` and `routes/customer-portal.ts` (both currently read legacy quotation status directly — must be updated to check canonical quotations first and fall back to legacy only for projects that predate the freeze).
4. **Non-catalog projects still on the legacy path** (flagged in blueprints as needing a business decision, confirmed still open — not something this spec can resolve unilaterally since it is a product/data question, not an architecture question): projects created outside the service-catalog flow have no `ai_quotations` row to attach to. This spec's recommendation, to be validated by the business owner before P0-4 implementation begins: allow direct creation of an `ai_quotations` row without a preceding `ai_service_requests` row for these cases (relax the current implicit assumption that canonical quotations always originate from the catalog flow), rather than keeping the legacy table open for a second, narrower class of new writes indefinitely.
5. **Tenant attribution for historical legacy rows** (the two-way P0-1/P0-4 dependency): `creative_project_quotations` rows have no tenant column and, per §3.7's ordering, Commercial/Quotation is the last domain to reach tenant enforcement — by the time it does, historical legacy quotation rows attribute their tenant via their parent `creativeProjectsTable.tenant_id` (already backfilled by then), never a column on the quotation table itself, since the table is frozen and should not receive new columns purely for this purpose beyond what's needed for read-time joins.
6. **Sequencing relative to P0-1**: P0-4's implementation work (freezing legacy writes, updating the four consumers above) can begin once Phase B (progressive enforcement) reaches the Commercial/Quotation domain per §3.7 — not before, and not deferred indefinitely after, since further delay only grows the number of legacy-path writes that must be reconciled later.

---

## 7. API / Service Contract Changes (cross-cutting)

- Every internal-facing service function that currently takes `(id, ...)` and performs a direct table query must be re-expressed as taking `(ctx: RequestContext, id, ...)` once migrated onto the repository foundation — this is a mechanical but wide-reaching signature change across `services/*.ts`, tracked per-domain in the work package plan, not attempted as one global rename.
- Route handlers gain one new shared piece of middleware (tenant-context resolution, §2.1) inserted after existing auth/token-resolution middleware and before route logic; this is additive to the existing chain in §1.2, not a replacement of any existing middleware.
- No public API response shape changes are required by tenant isolation or soft-delete (both are enforced server-side, invisible to clients) except: (a) audit log admin-read endpoints, if any are added, would expose the new `tenantId`/`actorType` fields; (b) quotation-status-reading endpoints (`public-review.ts`, `customer-portal.ts`) must be updated per §6.3 to check both quotation sources, which is a behavior fix, not a contract-breaking shape change.

## 8. Frontend Impact

- `artifacts/ai-platform` (admin/internal): no visible UX change required by P0-1/P0-2/P0-3 themselves; the only visible surface is if/when an admin "trash/restore" UI is added for soft-deleted records (recommended but not mandatory for P0 completion — tracked as an optional work package). Any UI that today creates records via the legacy quotation flow (`use-catalog.ts` already targets canonical `/api/public/quotations/` per §1.3, so exposure here appears limited — confirm before implementation, since it's stated as "the audit found" rather than a 100%-verified exhaustive frontend grep).
- `artifacts/customer-portal`: `routes/customer-portal.ts` and `routes/public-review.ts` server-side changes (§6.3) are internal; no customer-facing UI copy or flow changes are implied as long as both quotation sources resolve to the same displayed status semantics.

## 9. Definition of Done (for the P0 program as a whole)

- Every tenant-scoped table (§3.3) has a backfilled, NOT NULL `tenant_id`; RLS is enabled; the request-trusting `parseTenantId` vulnerability is removed.
- The shared repository foundation is the only write path for all migrated domains; direct `db.insert/update/delete` against those tables outside the repository is gone except documented, reviewed exceptions.
- `ai_audit_logs` carries `tenantId`/`actorId`/`actorType` populated automatically on every repository-mediated write; it is immutable at the application layer.
- Every table in §5.1's list has `deleted_at`/`deleted_by`; every one of the 8 hard-delete call sites in §1.4 (excluding the test fixture) has been replaced with soft-delete; purge is running in dry-run-reviewed, then live, mode per domain.
- `ai_quotations` is the only quotation table accepting new writes; the four consumers in §6.3 correctly resolve both quotation sources; the non-catalog-project business decision (§6.4) has been made by the product owner and implemented accordingly.
