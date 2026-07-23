# TEAM 41 — ARCHITECTURE AUDIT REPORT

## Universal Creative AI E2E Baseline

**Report status:** Reconstructed from tracked repository evidence
**Baseline branch:** `integration/creative-ai-e2e-baseline`
**Baseline source commit:** `40dee65` (`origin/main`)
**Report commit:** See the commit that adds this file on the baseline branch
**Audit date:** 2026-07-23
**Scope:** Architecture and source-of-truth audit only; no Team 42–46 implementation is included

> The original final Team 41 report and its final commit were not recoverable from
> the available Git refs, backup remote, workspace files, or reachable Git
> objects. This report is therefore a documented reconstruction from the
> canonical schemas, repositories, services, routes, tests, and the tracked
> `TEAM39_FINAL_INTEGRATION_AUDIT_REPORT.md`. It is not a claim that the missing
> historical report was recovered.

## 1. Executive Summary

The repository contains several related but distinct execution layers:

1. The service catalog and `ai_service_requests` represent customer intent.
2. `creative_projects` is the Creative AI project record and carries legacy and
   service-catalog lineage.
3. `ai_workflows` and `ai_workflow_executions` represent generic workflow
   definitions and executions.
4. `ai_pipeline_stages` and `ai_production_pipelines` represent the V4.4
   production pipeline.
5. `ai_jobs` is the generic queued job source of truth.
6. `ai_workers` is the database-backed worker roster and lease state.
7. `creative_project_steps`, `creative_ai_assets`, design render batches/items,
   and renderer services represent service-specific execution and output.
8. `ai_quotations`, `ai_payment_schedule`, `ai_invoices`, and
   `ai_commercial_gates` represent commercial state.
9. `creative_projects.files_unlocked` and customer workspace services enforce
   final access policy.

The repository has strong local safeguards: explicit workflow registry
resolution, atomic job claiming, bounded retries, stale-worker recovery,
renderer timeout/idempotency, and file-producing job completion validation.
However, the audit found cross-layer risks that must remain visible:

- multiple execution models coexist and are not yet proven to be one universal
  end-to-end state machine;
- capability strings are soft-coded and can strand queued jobs;
- worker occupancy and lease bookkeeping are distributed across update paths;
- `creative_projects` has no direct `tenant_id` column;
- project status, workflow completion, production completion, deliverable
  readiness, commercial completion, and file unlock are distinct concepts but
  are still mapped through legacy status fields in some paths;
- legacy quotation lineage and older direct database writes remain;
- database records are not by themselves proof that storage contains a valid
  production file.

**Baseline verdict:** suitable as a documented integration baseline with
explicit pre-existing risks; not a production-readiness approval.

## 2. Repository Baseline

| Item | Value |
|---|---|
| Official baseline branch | `integration/creative-ai-e2e-baseline` |
| Source branch | `origin/main` |
| Source commit | `40dee65` |
| Team 41 historical report | Not recoverable from available refs/objects |
| Reconstruction source | Tracked schemas, services, routes, tests, and TEAM 39 report |
| Team 42–46 implementation | Not added by this baseline report |
| Main branch modified | No |
| Remote push | Must be verified separately; GitHub push requires credentials |

The workspace may contain untracked uploaded briefs. Uploaded files are not
part of this baseline and are intentionally excluded from the commit.

## 3. Service and Service-Archetype Inventory

| Archetype | Canonical evidence | Responsibility |
|---|---|---|
| Service catalog | `lib/db/src/schema/ai-service-catalog.ts` | Categories, services, packages, requests |
| Customer request intake | `ai_service_requests` | Customer intent and request-to-project handoff |
| Creative project | `lib/db/src/schema/creative-projects.ts` | Project identity, lifecycle, commercial linkage |
| Generic workflow | `lib/db/src/schema/ai-workflows.ts` | Versioned workflow definition and JSON steps |
| Workflow execution | `lib/db/src/schema/ai-workflow-executions.ts` | Inputs, outputs, step results, execution status |
| Production pipeline | `ai-production-pipelines` / `ai-pipeline-stages` | Ordered production stages and stage outputs |
| Project steps | `creative_project_steps` | Legacy/service-specific project execution steps |
| Generic jobs | `ai_jobs` | Queue, attempts, result, error, capability requirement |
| Worker runtime | `ai_workers`, `jobDispatcherService.ts` | Worker roster, leases, heartbeats, claiming |
| Design render batches | Design render batch/item services | Multi-item render execution and recovery |
| Universal renderer | `universalRendererService.ts` | Deterministic format rendering and storage handoff |
| Assets | `creative_ai_assets` | Generated creative asset metadata and lifecycle |
| Commercial | Quotations, gates, schedules, invoices | Approval, payment, and commercial eligibility |
| Customer access | `customerWorkspaceService.ts`, `paymentGate.ts` | Customer-safe views and download gating |

## 4. Workflow Inventory

### 4.1 Generic workflow registry

`lib/design-workflow/src/registry/WorkflowRegistry.ts` is an explicit,
version-aware in-memory registry. It rejects duplicate
`workflowId@version` registrations and rejects missing, ambiguous, empty, and
version-mismatched queries. Resolution order is deterministic:

1. exact workflow ID and version;
2. workflow ID with latest version;
3. plugin and service type;
4. plugin;
5. service type.

It does not silently return an empty workflow.

### 4.2 Database workflow definitions and executions

- Definition: `ai_workflows`
- Execution: `ai_workflow_executions`
- Definition status: free-text, default `draft`
- Execution status: free-text, default `pending`
- Definition steps: JSONB `steps`
- Execution evidence: `inputs`, `outputs`, `step_results`, `error_message`,
  `completed_at`

This layer is canonical for generic workflow definitions/executions, but the
database schema does not itself enforce a complete state-transition machine.

### 4.3 Production pipeline

- Run: `ai_production_pipelines`
- Ordered stages: `ai_pipeline_stages`
- Stage status vocabulary: `pending`, `running`, `completed`, `failed`,
  `skipped`, `waiting_retry`
- Stage evidence: input, output, provider, model, latency, retry count, error

This is canonical for the V4.4 production-stage model. It must not be
silently conflated with generic workflow execution or project status.

### 4.4 Service-specific workflow definitions

The repository also contains domain/plugin definitions under
`lib/design-workflow/src/fixtures/` and
`artifacts/api-server/src/domains/`. These are adapters or service-specific
workflow contracts, not permission to create a second universal workflow
engine.

## 5. State Transition Matrix

| Domain | Observed states | Terminal/guard meaning |
|---|---|---|
| Generic job | `queued`, `waiting`, `running`, `retrying`, `completed`, `failed`, `cancelled`, `blocked` | `completed` requires job result validation; failed/cancelled are not success |
| Project step | `pending`, `running`, `completed`, `failed` | Required step failure must block workflow completion |
| Pipeline stage | `pending`, `running`, `completed`, `failed`, `skipped`, `waiting_retry` | Stage output and failure determine downstream eligibility |
| Creative asset | `pending`, `generating`, `completed`, `failed`, `approved`, `needs_revision`, `rejected` | Asset completion is not equivalent to deliverable readiness |
| Render session | `planning`, `preview_generating`, `waiting_customer`, `concept_selected`, `final_generating`, `completed` | Session completion is not commercial or order completion |
| Quotation | `draft`, `issued`, `viewed`, `approved`, `rejected`, `revision_requested`, `expired`, `cancelled` | Approved/rejected/cancelled/expired are terminal quotation states |
| Payment schedule | `pending`, `paid`, `partially_paid`, `failed`, `refunded`, `cancelled` | Paid is commercial evidence for that schedule only |
| Commercial gate | `pending`, `verified`, `failed`, `waived` | Gate verification enables the policy-controlled next action |
| Project | Legacy `pending`, `running`, `completed`, `failed`; commercial values include `waiting_payment`, `deposit_paid`, `payment_verified`, `building`, `internal_review`, `waiting_client_review`, `approved`, and others | Project status must not stand in for every domain completion state |
| Service request | `draft`, `quoted`, `waiting_customer_approval`, `approved`, `pending`, `orchestrating`, `in_progress`, `waiting_review`, `revision_requested`, `completed`, `cancelled` | Request completion is not proof of production or payment completion |

## 6. Source-of-Truth Matrix

| Entity | Canonical table | Canonical columns/evidence | Repository/service/resolver | Legacy source | Reconciliation rule | Owner |
|---|---|---|---|---|---|---|
| Service request | `ai_service_requests` | `id`, `request_id`, `service_id`, `package_id`, `status`, `brief_json`, `created_project_id`, `tenant_id` | Service catalog repositories/services and request routes | Direct/legacy intake records | Project handoff must retain `created_project_id` and request lineage | Team 39 / 43 |
| Service definition | `ai_services` | `service_code`, `service_flow`, `status`, `workflow_summary`, `deliverables` | Service catalog service and resolver | Seed/catalog remnants | Resolver must reject unknown or disabled services | Team 39 / 43 |
| Creative project | `creative_projects` | `id`, `project_id`, `source_type`, `service_request_id`, `service_quotation_id`, `status`, `payment_status`, `files_unlocked`, `result` | `creativeProjectRepository.ts`, project/workspace services | Direct projects with null catalog lineage | Preserve lineage; do not infer workflow from a display status alone | Team 39 / 43 |
| Workflow definition | `ai_workflows` | `id`, `name`, `status`, `steps`, `trigger_type`, `execution_count` | Workflow routes and workflow registry | Domain-local definitions | Use explicit versioned registry/resolution; no silent default | Team 43 |
| Workflow execution | `ai_workflow_executions` | `workflow_id`, `status`, `inputs`, `outputs`, `step_results`, `error_message`, `completed_at` | Workflow execution services | Project status fields | Completion requires required steps and evidence | Team 43 |
| Production pipeline | `ai_production_pipelines` | Run identity/status and production metadata | Production pipeline services/routes | Generic execution status | Pipeline completion is a production-domain state only | Team 43 / 44 |
| Pipeline stage | `ai_pipeline_stages` | `run_id`, `stage_name`, `stage_order`, `status`, `input`, `output`, `retry_count` | Pipeline stage services | `creative_project_steps` | Required stage failures block production completion | Team 43 |
| Project step | `creative_project_steps` | `project_id`, `step_name`, `input`, `output`, `status`, `error_message` | Creative workflow/project services | Pipeline stages | Adapter required when legacy project steps feed newer execution | Team 43 |
| AI job | `ai_jobs` | `job_code`, `job_type`, `status`, `payload_json`, `result_json`, retry fields, capability | `jobWorkerService.ts`, `jobDispatcherService.ts`, job routes | Render-item jobs for design batches | Every required step must have a job or explicit non-job handler | Team 43 |
| Worker | `ai_workers` | `worker_name`, `capabilities`, lease fields, `status`, `current_job`, counters | Worker cluster and dispatcher services | In-process worker assumptions | DB roster and lease state are authoritative for claimability | Team 43 |
| Creative asset | `creative_ai_assets` | `project_id`, `step_id`, `status`, `image_url`, `storage_path`, `render_stage`, QC fields | Asset services and image pipeline | Legacy asset rows | Asset record is not storage proof; validate output and storage separately | Team 43 / 44 |
| Render item | Design render item tables | Batch/item status, lease, worker, attempts, output/error | Batch dispatcher, render worker, stale recovery | None identified | Atomic lease update; reconcile batch after recovery | Team 43 |
| Quotation | `ai_quotations` | `service_request_id`, `status`, pricing snapshots, token hash | `aiQuotationService.ts`, `quotationRepository.ts` | `creative_project_quotations` | New catalog flow is canonical for new writes; adapter reads legacy | Team 42 / 39 |
| Commercial gate | `ai_commercial_gates` | request/quotation refs, `gate_type`, `status`, amounts, verifier | `commercialGateService.ts`, commercial routes | Legacy quotation gate references | Map both new and legacy quotation references without duplicate gate tables | Team 42 / 43 |
| Invoice | `ai_invoices` | `project_id`, schedule ref, `amount`, `status`, `invoice_type` | `paymentScheduleService.ts` | Older invoice paths | Use `amount`; do not introduce `total_amount` alias | Team 42 |
| Payment schedule | `ai_payment_schedule` | `project_id`, `payment_type`, `amount`, `status`, verification fields | `paymentScheduleService.ts`, payment routes | Project payment columns | Schedule rows are evidence; project aggregate is derived/cache-like | Team 42 |
| Payment/project status | Schedule plus `creative_projects.payment_status` | Schedule status and aggregate payment status | Payment services and gates | Manual status updates | Canonical payment verification must win over cache/status shortcuts | Team 42 / 39 |
| Deliverable | Final artifact/deliverable contracts and customer workspace adapters | Valid artifact references, storage evidence, manifest/links | Renderer, document/export workers, workspace services | `completion_links` and generic project `result` | Do not treat a DB JSON link as valid final output without validation | Team 44 |
| File access | `creative_projects.files_unlocked` plus access policy | Boolean and policy-controlled payment/delivery checks | `paymentGate.ts`, `paymentScheduleService.ts`, `customerWorkspaceService.ts` | Manual/admin paths | Unlock is an access result, not workflow completion | Team 44 / 42 |
| Order completion | No single universal canonical table established | Must be derived from service-specific contract | Request/project/commercial/delivery mapping | Generic `completed` statuses | Require explicit contract for each service; never infer from one status | Team 39 / 42–46 |

## 7. Canonical Lifecycle Contract

These definitions are the baseline contract. They are intentionally separate;
one status must never be used as a substitute for another.

### `workflow_completed`

All required workflow steps and required jobs have completed successfully
according to the resolved workflow contract. Required dependencies are resolved,
there is no blocking failure, and required output validation has passed.

This does **not** mean payment is complete, a deliverable is published, files
are unlocked, or the order is complete.

### `production_completed`

All required production activity has completed and the production output has
passed the output-validation boundary owned by the execution pipeline. This
requires evidence from the required jobs/stages and renderer, not merely an
HTTP success or a project status update.

This does **not** mean deliverable publication, payment completion, customer
download access, or order completion.

### `deliverable_ready`

All required artifacts are present, valid, linked to the correct tenant/project,
and stored or handed off according to the artifact/deliverable contract.

An artifact database row, preview URL, or placeholder is not sufficient proof.

### `commercial_completed`

All required commercial obligations for the service are satisfied under the
canonical billing policy. This may be a paid schedule, a valid zero-cost/waiver
policy, or another explicitly audited commercial contract.

Production may complete before commercial completion when the service policy
allows it.

### `files_unlocked`

The customer has final access rights under the canonical access/unlock policy.
It is not equivalent to workflow completion, production completion, project
completion, or a manually set boolean. The unlock decision must remain scoped,
audited, and policy-controlled.

### `order_completed`

The service-specific final contract is satisfied, including the applicable
combination of workflow completion, production completion, deliverable
readiness, review/approval, commercial completion, delivery completion, and
other service obligations.

There is no valid universal rule that maps every `completed` string to
`order_completed`.

## 8. Canonical Completion Rules

- **CR-01:** Workflow completion is not project or order completion.
- **CR-02:** Production may complete before payment when the service policy allows.
- **CR-03:** A file-producing required service cannot be `deliverable_ready`
  without a valid required artifact.
- **CR-04:** An artifact database row is not proof that the storage object exists.
- **CR-05:** Final file access follows canonical unlock policy.
- **CR-06:** Cached payment/project status cannot override verified canonical
  payment evidence.
- **CR-07:** Admin overrides must be authorized, scoped, reasoned, and audited.
- **CR-08:** An admin override cannot convert unpaid state into paid state.
- **CR-09:** Required job failure blocks workflow completion and downstream
  required work.
- **CR-10:** Null, empty, malformed, placeholder, stub, or failed-renderer
  output cannot be production success.
- **CR-11:** Cross-tenant associations fail closed.
- **CR-12:** Order completion follows a service-specific completion contract.
- **CR-13:** Zero-cost or waived commercial completion uses an audited canonical
  policy.
- **CR-14:** Preview availability is not final download access.
- **CR-15:** A workflow cannot complete without a workflow instance and required
  execution evidence.
- **CR-16:** A cancelled or failed required execution cannot be converted to
  success by a later generic status update.

## 9. Dependency Graph

```text
service catalog
  -> service request
  -> quotation / checkout / commercial gate
  -> creative project
  -> workflow resolution
  -> workflow definition + execution
  -> pipeline stages / project steps
  -> required AI jobs
  -> queue
  -> atomic worker claim
  -> AI execution
  -> renderer dispatch when required
  -> output/storage validation
  -> step and job completion
  -> workflow completion
  -> production completion eligibility
  -> artifact/deliverable readiness
  -> commercial completion and access policy
  -> order completion
```

Payment, review, deliverable publication, and file unlock are separate gates.
They must not be collapsed into the execution graph.

## 10. Runtime and Reliability Findings

### Positive controls observed

- `WorkflowRegistry` rejects duplicate versions and ambiguous/missing
  resolution.
- `claimJob()` uses an atomic database claim with `FOR UPDATE SKIP LOCKED`
  according to the runtime audit.
- Retry state has bounded attempts and exponential backoff.
- Dispatcher recovery handles stale workers and stuck jobs.
- Render-item recovery uses lease expiry predicates in atomic updates.
- Universal renderer enforces format limits, timeout, and idempotency.
- `jobCompletionGuard.ts` rejects stub dispatches and missing required asset
  references for known file-producing job types.
- Watermarked preview generation is fail-closed.

### Findings assigned to execution/runtime ownership

- Capability names are free-text. A typo in `required_capability` can leave a
  job queued without a capable worker.
- Worker lease, status, and running-job counters are maintained across several
  paths; every exception and cancellation path must release occupancy.
- Generic workflow execution, production pipeline stages, project steps, and
  render batches coexist. Their adapter boundaries must be explicit.
- Unknown job types are treated as non-file jobs by the completion guard; new
  file-producing types must be registered before production use.
- A renderer result must be tied to the same job, workflow, project, and tenant
  that requested it.
- Recovery scanners should report orphan jobs, duplicate active work, missing
  renderers, unresolved dependencies, and completed jobs without evidence.

## 11. Critical Finding Ownership Matrix

| Finding | Severity | Primary owner | Secondary owner | Release gate |
|---|---|---|---|---|
| Plaintext credentials in imported configuration/history | Critical | Team 39 | Security/release owner | Block sharing/publishing until rotated and removed |
| Frontend-bundled admin key risk | Critical | Team 46 | Team 39 | Block production admin access exposure |
| Unsafe schema push/drop risk | High | Team 39 | Database owner | Block destructive migration execution |
| Payment/completion desynchronization | High | Team 42 | Team 43, 44 | Block order completion/access until contract is explicit |
| Manual unlock bypass | High | Team 44 | Team 42, 45 | Block final access |
| Payment status cache drift | High | Team 42 | Team 39 | Block commercial completion |
| Completed without artifact | Critical | Team 43 | Team 44 | Block workflow/production completion |
| Invalid renderer output | Critical | Team 43 | Team 44 | Block production completion |
| No-text/overlay failure exposure | High | Team 43 | Team 44 | Block final asset delivery |
| Customer/admin status mismatch | High | Team 45/46 | Team 39 | Block release sign-off |
| Missing capable worker / stranded queue | High | Team 43 | Team 39 | Block affected workflow activation |
| Cross-tenant job or renderer association | Critical | Team 43 | Team 39 | Block execution and release |
| Missing workflow or empty initialization | High | Team 43 | Team 39 | Block project execution |

## 12. Team Ownership and Dependency Order

| Team | Scope |
|---|---|
| Team 39 | Integration, baseline promotion, conflict/security coordination |
| Team 42 | Billing, quotations, invoices, payment policy and verification |
| Team 43 | Workflow resolution, initialization, jobs, queue, workers, retries, renderer dispatch, execution completion |
| Team 44 | Artifact persistence, storage evidence, deliverables, final access/unlock contract |
| Team 45 | Customer portal status and workflow/deliverable presentation |
| Team 46 | Admin portal status, controls, and operational presentation |
| Team 47 | Universal test harness and cross-service E2E |
| Team 48 | Smoke-service verification |
| Team 49 | Failed-service remediation |
| Team 50 | Final release gate |

Team 43 depends on this baseline. Teams 42–46 may work in parallel only from
the same remote-available baseline commit and must use additive,
backward-compatible contracts for shared files.

## 13. Shared-File Conflict Risks

- `lib/db/src/schema/index.ts` is a manual barrel and is shared by many teams.
- `routes/index.ts` is a high-conflict integration file.
- Workflow, job, renderer, and completion contracts are consumed by Teams 42,
  44, 45, 46, and the universal harness.
- `creative_projects.status`, `payment_status`, `files_unlocked`, and generic
  `result` are legacy/shared fields; changes require additive mapping and
  status-map review.
- `creative_project_steps` and `ai_pipeline_stages` overlap conceptually but
  are not interchangeable tables.
- Legacy quotation reads must continue through the compatibility adapter while
  new writes use the canonical service-catalog quotation flow.

## 14. Security Escalations

The imported project configuration has historically contained sensitive
environment values. This report does not reproduce any values. Before sharing
or publishing:

1. rotate any credentials that were ever committed;
2. remove plaintext values from tracked configuration/history where applicable;
3. use managed secret storage;
4. review frontend bundles for administrative credentials;
5. verify audit logs do not contain provider keys, tokens, or raw uploads.

These are release blockers, not reasons to weaken the workflow contract.

## 15. No-Code/Runtime Change Declaration

This baseline promotion adds documentation only. It does not add workflow,
billing, artifact, renderer, worker, or UI implementation. It does not alter
production data or database schema.

## 16. Validation Plan and Known Pre-existing Risks

The tracked TEAM 39 integration report records:

- 5300/5300 tests passing across 173 test files at the documented integration
  point;
- API build passing after the TEAM 39 schema-barrel fix;
- 1067 pre-existing API typecheck errors before the required workspace
  declaration build;
- frontend build commands requiring workflow-provided `PORT`;
- frontend/API declaration-build ordering requirements.

For this reconstructed baseline, the report itself must pass documentation
checks and the source tree must remain unchanged apart from this file. Runtime
teams must run targeted tests after their own changes and must not claim the
historical 5300-test result as a fresh execution unless they rerun it.

## 17. Team Start Package

- **Official baseline branch:** `integration/creative-ai-e2e-baseline`
- **Official baseline commit:** the commit adding this report
- **Report path:** `TEAM41_ARCHITECTURE_AUDIT_REPORT.md`
- **Report source:** reconstructed from tracked repository evidence
- **Workflow source of truth:** versioned workflow registry plus
  `ai_workflows`/`ai_workflow_executions`, with production stages represented by
  `ai_production_pipelines`/`ai_pipeline_stages`
- **Job source of truth:** `ai_jobs`, claimed by the database-backed dispatcher
  and workers
- **Renderer source of truth:** registered renderer adapters and
  `UniversalRendererService`; file-producing job completion also requires
  `jobCompletionGuard.ts`
- **Critical execution owner:** Team 43
- **Branches allowed to start:** Team 42–46 branches created from the same
  remote-available baseline commit, after remote availability is verified
- **Branches not allowed to start:** branches based on old `main`, uploaded
  briefs, or an unverified local-only baseline
- **Integration constraint:** do not create a second workflow engine, job
  runtime, renderer registry, or RequestContext
- **Known conflicts:** schema barrel, route index, shared lifecycle/status maps,
  and commercial/workflow boundaries

## 18. Final Verdict

**PASS WITH DOCUMENTED PRE-EXISTING RISKS — LOCAL BASELINE REPORT CREATED**

This verdict applies only to the local documentation baseline. It becomes an
official team-start baseline only after the branch and commit are available
through a remote repository and the report is verified there. It is not a
production release approval and does not authorize bypassing security,
commercial, artifact, or completion gates.