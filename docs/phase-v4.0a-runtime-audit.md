# Phase V4.0A — AI Runtime Audit & Data Mapping Report

**Scope:** Read-only investigation only. No frontend or backend code was changed to produce this report. This document is the required deliverable before any V4.0 "AI Runtime Integration" implementation work begins.

---

## 1. Executive Summary

The platform already has **real, working AI execution** for the one path that matters to customers today — the creative-project pipeline (`creativeWorkflowRunner.ts` → `creative_project_steps` → `creative_ai_assets`) makes genuine LLM/image-provider calls and records real output. However, it runs **completely disconnected** from a second, more general-purpose job/worker/dispatcher/queue system (`ai_jobs`, `ai_workers`, `jobDispatcherService`, `workerClusterService`, `queueManagerService`) that was built in earlier phases and is fully wired up (started at boot, polling loops running) but **has no producer** — nothing in the customer-facing flow ever inserts a row into `ai_jobs`.

The customer-portal Workspace UI (AI Workforce panel, Current Task, Live Activity, Timeline, Health) does not read from either of these real systems for its most "alive-looking" elements. It reads real `status`/`stage` data from `creative_projects` and `creative_project_steps` for coarse state, but the AI-workforce roster, per-agent confidence scores, and worker metadata are **hardcoded constants in the frontend** (`WORKER_META`, `FALLBACK_META`, `DEFAULT_TEAM` in `workspace-ai-workforce.tsx`), not derived from any backend table. There is no realtime push channel (no WebSocket/SSE) anywhere in `api-server`; the frontend relies on request-driven fetches / polling.

In short: real execution exists, but it emits into the "wrong" (disconnected) tables from the runtime system's point of view, and the customer-facing UI's "liveness" is partly cosmetic. V4.0 is fundamentally a **wiring and truthfulness problem**, not a from-scratch build: connect the UI to `creative_project_steps`/`ai_cost_records`/`ai_events` (the tables that already hold real data), decide the fate of the disconnected `ai_jobs`/dispatcher/worker-cluster system, and add a real progress/event feed the frontend can trust instead of interpolating from a status string.

---

## 2. Existing Runtime Architecture

Two parallel, non-interacting subsystems exist in `artifacts/api-server/src`:

**System A — Generic job/worker/dispatcher stack** (built across earlier "cluster"/"scheduler"/"event-bus" phases):
- `ai_jobs` (queue) + `ai_workers` (worker registry with heartbeat/lease) + `ai_execution_plans` + `ai_task_assignments`
- `jobDispatcherService.ts` — polls `ai_jobs` every ~1s (`tick()`), claims jobs, dispatches to registered workers
- `workerClusterService.ts` / `queueManagerService.ts` — worker registration, lease renewal, claim/release semantics
- `aiSchedulerService.ts` — polls `ai_schedules` every ~60s, can `create_job` (into `ai_jobs`), `publish_event`, call a `webhook`, or write an `audit_log`
- Started at boot in `index.ts` (both dispatcher and scheduler are explicitly instantiated with graceful shutdown handlers)
- **No code path from the customer-facing flow ever writes to `ai_jobs`.** It runs, polls, finds nothing, and idles.

**System B — Creative workflow runner** (what customers' work actually goes through):
- Triggered by `serviceRequestConversionService.convertServiceRequestToProject` when a service request converts to a project
- `creativeWorkflowRunner.ts` iterates a hardcoded local `PIPELINE` array (Brand Strategist → Creative Director → Copywriter → Quality Control, etc.), writing one row per step into `creative_project_steps`
- Each step executes a **real** LLM call via `executeAI` (`aiExecutionService.ts`), routed through `intelligentRouter.js` / `routeForAgent`, with API keys resolved via `aiSecretService.js`
- Budget-gated via `checkProjectBudget` before execution; cost recorded via `costService.recordCost` into `ai_cost_records`
- Image/design output goes through `imageDesignerService.ts`, writing to `creative_ai_assets`
- Status/progress surfaces at the `creative_projects.status` (project-level) and `creative_project_steps.status` (step-level) granularity only — no sub-step progress percentage, no live token-by-token stream

Supporting infrastructure used by **both** conceptually but wired to System A operationally:
- `ai_events` event bus with `publishSafe()` — used across quotation/gate/scheduler/catalog code for audit-style fire-and-forget notifications, not currently used by System B to announce step progress
- `ai_human_tasks` — manual review/intervention queue, used by the Phase 6.5 Human Task Center, not connected to creative step failures today

---

## 3. Existing Tables

| Table | File | Purpose | Status enum | Linkage |
|---|---|---|---|---|
| `ai_jobs` | `lib/db/src/schema/ai-jobs.ts` | Generic job queue (System A) | queued, waiting, running, retrying, completed, failed, cancelled, blocked | `execution_plan_id`, `department_id`, `employee_id` |
| `ai_execution_plans` | `ai-execution-plans.ts` | Groups jobs/tasks for an objective | draft, active, completed, failed, cancelled | `project_id` |
| `ai_task_assignments` | `ai-task-assignments.ts` | Employee/agent task linkage within a plan | pending, in_progress, completed, failed, cancelled, revision_requested | `execution_plan_id`, `employee_id` |
| `ai_workers` | `ai-workers.ts` | Worker node registry, lease-based | online, offline, maintenance, busy, idle, stale | `cluster_id`, `node_id` |
| `ai_workflow_executions` | `ai-workflow-executions.ts` | Generic workflow run instances | pending + derived | `workflow_id` |
| `ai_schedules` | `ai-schedules.ts` | Cron/interval/event triggers | active, paused, completed, failed, cancelled | `target_type` (create_job / publish_event / webhook / audit_log) |
| `ai_schedule_runs` | `ai-schedules.ts` (companion) | One row per scheduled firing | pending, running, completed, failed, skipped | `schedule_id`, `created_job_id`, `created_event_id` |
| `ai_events` | `ai-events.ts` | Cross-module event bus / audit trail | pending, published, processing, processed, failed, ignored | `correlation_id`, `causation_id`, `source_module`, `source_id` |
| `ai_human_tasks` | `ai-human-tasks.ts` | Manual review/intervention queue | pending, assigned, accepted, in_progress, completed, rejected, cancelled, expired | `execution_plan_id`, `source_module`, `source_id` |
| `ai_cost_records` | `ai-cost-records.ts` | Per-call token/cost accounting | status (call outcome) | `project_id`, `step_id`, `workflow_id`, `client_id`, `agent_slug` |
| `creative_projects` | `creative-projects.ts` | Top-level customer project (System B root) | pending, running, building, internal_review, approved, … | `service_request_id`, `service_quotation_id`, `payment_status`, `files_unlocked` |
| `creative_project_steps` | `creative-project-steps.ts` | **Actual** per-agent execution record for a project | pending, running, completed, failed | `project_id`, `agent_id`, provider/model, token_usage, latency_ms |
| `creative_ai_assets` | `creative-ai-assets.ts` | Generated deliverable files (images/docs) | pending, generating, completed, failed, approved, needs_revision, rejected | `project_id` (via asset linkage), `asset_type`, `category`, storage path |
| `ai_service_requests` | `ai-service-catalog.ts` | Customer-facing request/quotation entry point | draft, quoted, waiting_customer_approval, approved, pending, orchestrating, in_progress, waiting_review, revision_requested, completed, cancelled | `service_id`, `package_id`, `created_project_id`, `completion_links` |

**Note on redundancy:** `ai_jobs`/`ai_execution_plans`/`ai_task_assignments` (System A) and `creative_projects`/`creative_project_steps` (System B) both model "a unit of AI work with a status," independently, with different status vocabularies and no foreign key between them.

---

## 4. Existing Routes

- `routes/aiQuotations.ts` — quotation issue/approve/reject (public, token-based); approval triggers gate creation and conversion check
- `routes/customer-workspace.ts` — `/public/customer/workspace/:token/*` — the routes the Workspace UI actually calls; scoped via `resolveWorkspaceSession(token)`
- `routes/payments.ts` — includes `GET /public/payments/:scheduleId/status`, explicitly commented as a "lightweight polling endpoint" — the only place polling is a first-class, named concept server-side
- `routes/jobs.ts` — CRUD/inspection over `ai_jobs` / `ai_workers` (System A); queries are **not scoped by any owner/tenant** — any caller with route access can query arbitrary job/worker rows by ID or filter
- `routes/dispatcher.ts` — control endpoints for the dispatcher (System A)
- `routes/workforce.ts`, `routes/agents.ts` — Phase 4.8 "digital workforce" simulation routes (`ai_agents`, `ai_workforce_configs`) — a **third**, org-chart-flavored concept of "AI workers," separate again from `ai_workers` (cluster nodes) and `creative_project_steps` (actual execution)
- `routes/human-tasks.ts` — human review queue; includes an `ssrfGuard` on `notificationHookUrl` but no visible authentication check on the routes themselves in the reviewed snippets

---

## 5. Existing Services

| Service | File | Role | Wired at boot? |
|---|---|---|---|
| `jobDispatcherService.ts` | api-server/src/services | Polls & dispatches `ai_jobs` (~1s tick) | Yes — started in `index.ts`, graceful shutdown |
| `workerClusterService.ts` | api-server/src/services | Worker registration/lease/heartbeat | Yes |
| `queueManagerService.ts` | api-server/src/services | Claim/release semantics over `ai_jobs` | Yes |
| `aiSchedulerService.ts` | api-server/src/services | Polls `ai_schedules` (~60s tick) | Yes — started in `index.ts` |
| `creativeWorkflowRunner.ts` | api-server/src/services | Runs the real customer-facing pipeline over `creative_project_steps` | Invoked on-demand from `serviceRequestConversionService`, not a background poller |
| `aiExecutionService.ts` | api-server/src/services | Real LLM/provider HTTP calls (OpenAI, Anthropic, Mistral) | Called by `creativeWorkflowRunner` |
| `intelligentRouter.js` | api-server/src/services | Picks provider/model per agent | Called by `creativeWorkflowRunner` |
| `imageDesignerService.ts` | api-server/src/services | Image generation pipeline (Replicate etc.) | Invoked on-demand |
| `costService.ts` | api-server/src/services | `estimateCost` / `recordCost` into `ai_cost_records` | Called by workflow runner & image designer |
| `eventBusService` (`publishSafe`) | api-server/src/services | Fire-and-forget writes to `ai_events` | Used broadly (quotation, gate, catalog, scheduler) |
| `aiAuditService.ts` (`logAudit`) | api-server/src/services | Mutation audit trail | Used broadly across routes |
| `aiCeoService.ts`, `departmentManagerService.ts`, `salesManagerService.ts` | api-server/src/services | Phase 4.8 workforce simulation logic | On-demand via `routes/workforce.ts` |
| `memoryResolver.ts` | api-server/src/services | Injects agent memory/context | Called during workflow execution |

---

## 6. Existing Worker Processes

`ai_workers` rows are created by `workerClusterService` at boot (confirmed live in current dev logs: `dispatcher-1`/`text_worker`, `dispatcher-2`/`image_worker`, `dispatcher-3`/`storage_worker` registered and leased). These are **System A** workers — generic lease-based pollers with no relationship to the agents (Brand Strategist, Creative Director, Copywriter, QC) that `creativeWorkflowRunner.ts` actually executes as plain in-process async calls. There is no worker-process concept at all inside System B; each step just runs inline within the request/trigger that invoked the runner.

---

## 7. Existing Dispatcher

`jobDispatcherService.tick()` — polls `ai_jobs` for `queued` rows, matches to an available `ai_workers` row by capability, marks `running`, and (per the general design of this class of service) is responsible for retry/backoff via `retry_count`/`max_retry`/`retry_strategy`. It is fully functional but **starved**: nothing in the current customer flow ever inserts an `ai_jobs` row, so in production this dispatcher polls an empty table indefinitely.

---

## 8. Existing Queue

`ai_jobs` is the only real queue table. `ai_schedule_runs.created_job_id` shows the scheduler *can* feed the queue (via `target_type: create_job`), so there is at least one already-wired producer — just not one connected to customer/service-request events. `queueManagerService` provides claim/release; no dead-letter or max-retry-exceeded terminal handling was confirmed in this pass and should be verified before relying on it.

---

## 9. Existing Event System

`ai_events` + `publishSafe()` is a working, broadly-adopted fire-and-forget event bus (`event_type`, `correlation_id`, `causation_id`, `source_module`/`source_id`, `status`: pending→published→processing→processed/failed/ignored). It is currently used for cross-module audit/notification purposes (quotation approved, gate cleared, catalog changes), **not** for per-step progress broadcasting. There is no subscriber/consumer loop confirmed in this pass that turns `ai_events` rows into anything the customer-portal frontend can see — it looks like a write-only audit log today, not a pub/sub backbone feeding the UI.

---

## 10. Existing Artifact Flow

`creative_ai_assets` stores generated deliverables (`imageUrl`, `storagePath`, `thumbnailUrl`, `assetType`, `category`, `status`: pending → generating → completed/failed → approved/needs_revision/rejected). `creative_projects.filesUnlocked` gates customer visibility (paired with payment verification, per prior phases). `ai_service_requests.completionLinks` also appears to carry final-delivery links for the non-creative-project (simpler) service flow. Two slightly different "here's your finished thing" mechanisms exist depending on which commercial flow (fixed-price vs. quotation/enterprise) the request took — worth reconciling but not necessarily a blocker.

---

## 11. Existing Cost Tracking

`ai_cost_records` is real and populated by `costService.recordCost`, called from both `creativeWorkflowRunner` and `imageDesignerService`. However, cost is **estimated, not actual**: `estimateCost()` uses static default pricing ($2.50/1M input tokens, ~$1/1M output tokens equivalent) unless explicit `ModelPricing` is supplied, and `actual_cost_usd` exists as a schema column but is never written — only `estimated_cost_usd` is populated. This means any customer-facing "cost" or margin figure derived from this table today is an approximation, not a reconciled provider invoice figure.

---

## 12. Current Customer Project Linkage

Confirmed trace, quotation → execution:
1. Customer approves quotation → `POST /public/quotations/:token/approve` (`aiQuotations.ts`)
2. `approveByToken` → `createGateForServiceQuotation` (commercial gate, idempotent) → `checkAndMaybeConvertByServiceQuotation`
3. Once the gate clears (payment verified), `serviceRequestConversionService.convertServiceRequestToProject` sets `ai_service_requests.status = converted_to_project` and inserts a `creative_projects` row
4. `runCreativeBriefWorkflow(project.id)` (`creativeWorkflowRunner.ts`) fires, inserting one `creative_project_steps` row per pipeline agent and executing them via real LLM calls
5. Workspace UI (`useWorkspaceProject` / `customer-workspace.ts` routes) reads `creative_projects` + `creative_project_steps` for status, scoped correctly by `resolveWorkspaceSession(token)` → `session.clientEmail`

This is the one linkage path that is real end-to-end. Nothing in this path touches `ai_jobs`, `ai_workers`, or the dispatcher/scheduler at all.

---

## 13. Security Findings

- **Correctly scoped:** Public workspace routes (`customer-workspace.ts`) consistently filter by `resolveWorkspaceSession(token)` → `clientEmail`, preventing one customer's token from reading another customer's project data. This is the pattern any new realtime/runtime endpoint must follow.
- **Not scoped / needs review:** `routes/jobs.ts` (System A) queries `ai_jobs`/`ai_workers` without any ownership/tenant filter — acceptable only if this route is admin-only, but admin-auth enforcement was **not confirmed** on this route in this pass.
- **Inconsistent admin auth:** `jobs.ts`, `dispatcher.ts`, and `workforce.ts` did not show an explicit `adminAuth`-style middleware application in the reviewed code, unlike `customer-workspace.ts` which explicitly references it. This should be verified directly (grep every route file for the admin-auth middleware) before any of these routes are exposed to, or reused by, the redesigned runtime API — do not assume they're protected.
- **`human-tasks.ts`** applies an `ssrfGuard` to `notificationHookUrl` (good — prevents outbound webhook SSRF) but no authentication was visible on the routes themselves in the reviewed snippets.
- **Action for V4.0B:** before building any new "live status" endpoint for the customer portal, explicitly confirm (a) it is scoped by workspace token/session exactly like `customer-workspace.ts`, and (b) any admin/internal runtime endpoint it depends on (job/worker/dispatcher inspection) sits behind the same `adminAuth`/`ADMIN_API_KEY` pattern already used elsewhere, with a route-by-route confirmation rather than an assumption.

---

## 14. Critical Gaps

1. **No realtime channel.** No WebSocket/SSE exists anywhere in `api-server`. All "live" UI elements today are either static/hardcoded or rely on ordinary request/response polling (only one endpoint, the payment-status check, is explicitly designed as a polling endpoint).
2. **UI shows fabricated confidence/roster data.** `WORKER_META`/`FALLBACK_META`/`DEFAULT_TEAM` in `workspace-ai-workforce.tsx` are hardcoded, not derived from `creative_project_steps.provider`/`model`/`tokenUsage` or any real per-agent success-rate metric.
2b. **No sub-step progress.** `creative_project_steps.status` is a 4-value enum (pending/running/completed/failed) with no percentage/phase field, so the UI's progress bars (e.g., "63%") cannot currently be backed by anything real without adding a progress field or deriving it from event/heartbeat timestamps.
3. **`ai_jobs`/dispatcher/worker-cluster stack is unused in production traffic.** It is fully running and consuming resources (polling every 1s/60s) but has zero producers from the real customer flow.
4. **`ai_events` is write-only from the UI's perspective.** No consumer path was confirmed that would let the customer-portal subscribe to or replay events for a project's timeline.
5. **Cost figures are estimates only.** `actual_cost_usd` is never populated; if V4.0 wants to show customers "this is what your project cost to run," today's numbers are model-list-price estimates, not reconciled actuals.
6. **Admin-route authentication needs verification, not assumption**, for `jobs.ts`, `dispatcher.ts`, `workforce.ts` before they're reused as a data source for anything customer-facing (even indirectly, via an admin dashboard).

---

## 15. Duplicate/Overlap Risks

Three independent "what is an AI worker/task doing right now" data models coexist:
- **System A (generic):** `ai_jobs` + `ai_workers` + `ai_execution_plans` + `ai_task_assignments` — cluster/dispatcher flavored, unused by real traffic
- **System B (creative pipeline, real):** `creative_projects` + `creative_project_steps` — what actually runs for customers
- **System C (org-chart simulation):** `ai_agents` + `ai_workforce_configs` (Phase 4.8 "digital workforce") — a separate roster/hierarchy concept, exposed via `routes/workforce.ts`/`routes/agents.ts`

Any V4.0 design must explicitly decide, per concept, which system is canonical:
- "AI worker" as shown in the customer-portal AI Workforce panel should almost certainly be **derived from System B execution data, decorated with System C's agent/role metadata** (name, specialty, avatar) — not from System A's cluster workers, which are a different abstraction (infrastructure lease nodes, not named creative-agent personas).
- System A should either be (a) formally retired/decommissioned if nothing will ever use it, or (b) adopted as the actual execution backbone for System B (i.e., make `creativeWorkflowRunner` submit real `ai_jobs` and let the existing dispatcher/worker-cluster run them) — running it unused indefinitely is wasted complexity and a maintenance trap.

---

## 16. Recommended Canonical Architecture

Recommend **not** merging all three systems into one big-bang rewrite. Instead:

1. Keep `creative_projects` / `creative_project_steps` as the canonical "what happened" record (it's real, it's linked to billing/gating already, and it's the one thing the customer-portal correctly reads today).
2. Extend `creative_project_steps` with a lightweight progress signal (see §18) so the UI can show real percentages instead of a 4-state enum.
3. Introduce a **project-scoped event/notification feed** that both (a) the workflow runner writes to on every step transition, and (b) the workspace API can poll (or eventually push over SSE) — this can be a thin, purpose-built table, or `ai_events` reused with a required `project_id`/`correlationId` convention and an actual polling read-path added to `customer-workspace.ts`.
4. Use System C (`ai_agents`) purely as **display metadata** (name/specialty/avatar/model) joined onto System B's `agentId` — replacing the hardcoded `WORKER_META` in the frontend with a real join.
5. Explicitly decide the fate of System A in a dedicated subphase decision point (§19) rather than silently keeping two systems running forever. Default recommendation: decommission the automatic dispatcher/scheduler ticking in production until/unless a real producer is built, to stop paying the polling cost for nothing; keep the schema for a possible future generalized-job use case.

---

## 17. Data Relationship Map

```
ai_service_requests ──(created_project_id)──▶ creative_projects ──(project_id)──▶ creative_project_steps ──(agent_id)──▶ ai_agents (display metadata)
        │                                              │                                    │
        └─(service_quotation_id)──▶ ai_quotations      ├─(project_id)──▶ creative_ai_assets  └─(step_id)──▶ ai_cost_records
                                                         └─(project_id, via workspace session token)──▶ customer-portal Workspace UI

[Disconnected] ai_schedules ──(target_type=create_job)──▶ ai_jobs ──▶ ai_workers (System A; no edge into the graph above)
[Disconnected] ai_events (write-only audit trail today; no edge feeding the Workspace UI)
```

---

## 18. Status/Event Model Recommendation

- Add a `progress_pct` (integer 0–100) and `phase` (free-text or small enum, e.g. `queued`/`drafting`/`reviewing`/`finalizing`) column to `creative_project_steps`, updated by `creativeWorkflowRunner` at natural checkpoints (start, after provider response, after QC pass) rather than only at start/end.
- Require every step-status transition to also `publishSafe()` an `ai_events` row with `source_module: "creative_project_steps"`, `source_id: step.id`, `correlation_id: project.id` — this turns the existing write-only audit bus into a genuine timeline feed with no new table needed.
- Add a `GET /public/customer/workspace/:token/projects/:id/timeline` route that reads `ai_events` filtered by `correlation_id = project.id` (plus a session-scoped ownership check identical to existing workspace routes) so the frontend can poll a real, incrementally-appending timeline instead of re-deriving one from a status string.
- Keep status enums as-is (no new statuses invented) — this only adds *granularity between* existing statuses, not new terminal states.

---

## 19. Subphase Implementation Plan

- **V4.0B — Real roster + confidence, no new infra.** Replace hardcoded `WORKER_META`/`FALLBACK_META`/`DEFAULT_TEAM` with data joined from `creative_project_steps` + `ai_agents`. Lowest risk, immediately removes the most visible "fake" data.
- **V4.0C — Progress + timeline.** Add `progress_pct`/`phase` to `creative_project_steps`; wire `publishSafe()` calls at each checkpoint; add the scoped timeline read route; update the frontend Timeline/Live Activity components to poll it.
- **V4.0D — System A decision.** Either decommission the dispatcher/scheduler polling loops (if no near-term use case) or make `creativeWorkflowRunner` submit real `ai_jobs` rows so System A becomes the execution backbone — this is an architectural choice for the user, not something to default silently.
- **V4.0E — Cost truthing.** Decide whether `actual_cost_usd` reconciliation is in scope; if so, add provider-response-based actual cost capture where the provider returns billed usage.
- **V4.0F — Realtime (optional/last).** Only after B–D land and are stable, consider SSE for push-based updates; polling from V4.0C is a safe interim and may be sufficient.

---

## 20. Files Expected to Change

- `artifacts/customer-portal/src/components/workspace-ai-workforce.tsx` (remove hardcoded roster/confidence)
- `artifacts/customer-portal/src/pages/workspace/project-detail.tsx` and any Timeline/Live Activity/Health sub-components
- `artifacts/customer-portal/src/hooks/use-workspace.ts` (new timeline query)
- `artifacts/api-server/src/services/creativeWorkflowRunner.ts` (progress/event emission)
- `artifacts/api-server/src/routes/customer-workspace.ts` (new timeline route)
- `lib/db/src/schema/creative-project-steps.ts` (new columns)
- Orval/OpenAPI contract regeneration for the new route + new step fields

## 21. Tables Expected to Change

- `creative_project_steps` — add `progress_pct`, `phase` (additive, nullable/defaulted — non-breaking)
- No changes required to `ai_events` schema (reuse existing columns); no changes to `ai_jobs`/`ai_workers` unless V4.0D chooses to adopt System A

## 22. Migration Risk

Low for V4.0B/C as scoped: additive nullable columns on an existing table, no destructive schema changes, no removal of existing statuses. Per prior project experience, hand-write additive DDL rather than trusting `drizzle-kit push` diffing against the `ai_platform` schema (it has previously proposed destructive drops on unrelated additive changes — verify any generated migration before applying). Higher risk only if V4.0D chooses full System A adoption, which would need careful backfill/idempotency work mirroring the existing `create_job` scheduler path.

## 23. Backward Compatibility Plan

- New `creative_project_steps` columns must be nullable/defaulted so existing rows and any code paths that don't yet set them keep working unmodified.
- New timeline route is purely additive; existing status-based UI reads keep working during rollout, so the frontend can switch component-by-component rather than in one release.
- Do not remove or rename any existing `ai_service_requests`/`creative_projects` status values as part of this work — V4.0 is additive instrumentation on top of the existing, working state machine.

## 24. Recommended First Implementation Step

Start with **V4.0B** (replace hardcoded roster/confidence with a real join between `creative_project_steps` and `ai_agents`). It requires no schema migration, touches only the frontend plus one small backend query/route, removes the single most obviously "fake" piece of the current UI, and de-risks the team's understanding of the real data before touching anything with a migration or a new event-emission contract.

---

*End of audit. No implementation has begun. Awaiting review and a decision on §16 (canonical architecture) and §19 (System A fate) before any V4.0 code is written.*
