# TEAM 43 — Workflow, Jobs, Workers, and Renderers Audit

**Audit branch:** `audit/team-43-workflow-jobs`  
**Verified baseline:** `3af1e2b` (`integration/creative-ai-e2e-baseline`)  
**Audit date:** 2026-07-23  
**Publication status:** local commit only; remote publication is unavailable in this workspace

## 1. Scope and baseline contract

This audit resumes TEAM 43 locally from the verified TEAM 41 baseline. `main` was
not modified, merged, rebased, force-pushed, or reset. The TEAM 41 architecture
report is the contract source for the audit.

The lifecycle identifiers retained as canonical completion signals are:

- `workflow_completed`
- `production_completed`
- `deliverable_ready`
- `commercial_completed`
- `files_unlocked`
- `order_completed`

The audit treats a job as complete only when its worker has produced the result
evidence required by its job archetype. Queue status alone, a dispatch message,
or a delegated placeholder is not a deliverable.

## 2. Architecture findings

### Workflow layers

The repository contains several valid workflow layers that must not be conflated:

1. The generic versioned workflow registry and completion policy.
2. Linear creative brief pipelines and the legacy service-to-document runner.
3. The UDP/DAG workflow engine and execution-plan builder.
4. Production-pipeline stages and project-step lifecycle transitions.
5. Design-template render batches and the universal renderer.

`WorkflowRegistry` remains the versioned resolution source, while
`CompletionPolicy` evaluates terminal completion semantics. The creative
workflow runner and the DAG builder remain separate orchestration paths; this
audit does not collapse them into one implementation.

### Queue and worker architecture

- `ai_jobs` is the queue source of truth.
- Job claiming uses a transaction with `FOR UPDATE SKIP LOCKED`.
- Capability matching uses the persisted `required_capability` value.
- Worker leases, heartbeats, and stale-worker recovery are present.
- `rebalanceJobs()` retains the legacy `employee_id` recovery path and the
  current worker fallback.
- Enqueue now accepts an optional validated `requiredCapability`, persists it,
  and rejects unknown capabilities instead of silently creating stranded jobs.
- Event-created jobs now pass their configured capability to the canonical queue
  column, not only into payload JSON.

### Renderer architecture

- `design_render` claims a render item atomically, leases it, renders through
  the template pipeline, records storage/output evidence, and reconciles its
  batch.
- `design_render_batch_dispatch` delegates fan-out to the production batch
  dispatcher.
- `design_render_zip_export` validates its export payload and runs the ZIP
  export worker.
- Universal renderer job variants share one worker implementation while
  retaining distinct job types for format-specific completion contracts.
- Workspace export jobs route to the export-workspace worker.
- Project ZIP delivery jobs run through the queue and now return their storage
  path as completion evidence.

## 3. Findings and implemented fixes

### Finding A — universal renderer was not fully routed

Universal renderer job types were not all handled by `executeJob()`, so queued
jobs could fall through without invoking the renderer.

**Fix:** route the complete universal renderer family to
`executeUniversalRenderJob()`:

- `universal_render`
- `universal_render_svg`
- `universal_render_png`
- `universal_render_pdf`
- `universal_render_thumbnail`
- `universal_render_watermarked`
- `universal_render_print_ready`
- `universal_render_zip`
- `universal_render_composition`

### Finding B — worker capability advertisements were incomplete

Universal renderer and workspace export jobs required capabilities that the
export worker did not advertise. Project ZIP delivery also lacked a canonical
worker capability.

**Fix:** add `universal_render`, `export_workspace`, and
`generate_project_zip` to the export worker capability map. Workspace export,
universal renderer scheduling, event-created jobs, and project ZIP delivery
now persist their requested capability through the queue.

### Finding C — capability strings could strand jobs

Capability values were previously soft-coded at enqueue boundaries. A typo or
unsupported capability could create a job that no worker could claim.

**Fix:** validate requested capabilities against
`WORKER_TYPE_CAPABILITIES` before inserting the job. Unknown capabilities fail
explicitly.

### Finding D — file-producing completion could be false-positive

The completion guard did not cover universal renderer output, workspace export,
design render ZIP export, project ZIP delivery, or design render output with
archetype-specific evidence. A placeholder/delegation result could therefore
be treated as success.

**Fix:** register completion requirements for:

- `design_render` (`outputUrl`)
- `design_render_zip_export` (`zipStoragePath`)
- `generate_project_zip` (`storagePath`)
- `export_workspace_job` (`storagePath`)
- all universal renderer variants (`artifacts[]`)

Universal renderer artifacts must be non-empty and each artifact must include a
non-empty storage path and an HTTP(S) public URL. The same evidence rules are
used by the false-completion audit path.

### Finding E — unknown job types reported successful dispatch

The default `executeJob()` branch returned a dispatch message for an unknown
job type. That was a false-success path.

**Fix:** unknown job types now throw `WorkerNotImplementedError`, allowing the
normal failure/retry handling to classify the job honestly.

### Finding F — failed project ZIP jobs were non-fatal at worker level

`executeZipDeliveryJob()` updated the delivery row to `failed` but
`executeJob()` returned a successful-looking result after logging the failure.

**Fix:** ZIP failure is now thrown from the worker path. Successful ZIP results
include the generated `storagePath`, which is required by the completion guard.
The ZIP service also uses the current `publishSafe` event API and derives MIME
types from the supported asset-type mapping because the current asset schema
does not expose a `mimeType` column.

## 4. Completion guard matrix

| Job archetype | Required evidence |
|---|---|
| Generic text/QC/no-op | Structured result; no file evidence required |
| `image_generation` | `imageUrl` |
| PDF/PPTX/archive export | `storagePath` and HTTP(S) `permanentUrl` |
| Image batch/video/ZIP export | Storage and public URL evidence |
| `design_render` | `outputUrl` |
| `design_render_zip_export` | `zipStoragePath` |
| `generate_project_zip` | `storagePath` |
| `export_workspace_job` | `storagePath` |
| Universal renderer variants | Non-empty `artifacts[]`; every item has `storagePath` and HTTP(S) `publicUrl` |

The guard rejects empty artifacts, missing storage evidence, invalid public
URLs, and placeholder/delegation results. Terminal completion is therefore
evidence-backed rather than status-backed.

## 5. Service coverage matrix

| Service archetype | Representative source | Coverage |
|---|---|---|
| Versioned registry/policy | `lib/design-workflow` registry and completion policy | Audited |
| Linear creative workflow | `creativeWorkflowRunner.ts` | Audited |
| DAG/UDP execution | `creative-workflow-v2` execution plan builder | Audited |
| Lifecycle transitions | `design-lifecycle/lifecycleTransitions.ts` | Audited |
| Queue insertion/claiming | `queueManagerService.ts`, `jobWorkerService.ts` | Audited and hardened |
| Worker capability/lease | `workerClusterService.ts` | Audited and hardened |
| Template single render | `designRenderWorkerService.ts` | Audited |
| Template batch dispatch | `designRenderWorkerService.ts` and batch dispatcher | Audited |
| Template ZIP export | `designZipExportService.ts` | Audited and guarded |
| Universal renderer | `universalRenderWorker.ts` and scheduler adapter | Routed and guarded |
| Workspace export | `exportWorkspaceService.ts` | Routed and guarded |
| Project ZIP delivery | `zipDeliveryService.ts` | Failure and evidence path hardened |
| Event-driven job creation | `eventHandlerRegistry.ts` | Capability propagation fixed |
| Legacy unsupported jobs | `executeJob()` explicit unsupported branch | No silent success |

The fashion plugin job vocabulary and scheduled operational jobs were identified
as additional service archetypes. They remain outside the generic renderer
handler and require their owning plugin/scheduler implementation; they are not
silently treated as completed by the generic worker.

## 6. Validation results

### Passing validation

- TEAM 43 targeted API regression tests: **71 passed**
- Universal renderer worker/service tests included in the targeted run: **passed**
- Design workflow tests: **90 passed**
- Full API test suite: **5352 passed across 174 files**
- API build: **passed**
- Workspace library declaration build (`tsc --build`): **passed**
- `git diff --check`: **passed**
- Secret-pattern scan from the verified TEAM 41 baseline: **clean**

### Typecheck classification

The API package typecheck still reports **123 pre-existing errors** in baseline
areas such as presentation `pptxgenjs` typings, Express 5 route parameter
typing, test fixture drift, and unrelated service migrations. The final
typecheck output contains no diagnostics for the TEAM 43 queue, worker routing,
completion guard, event capability propagation, workspace export, universal
renderer adapter, or ZIP evidence changes.

The API build and all runtime tests pass despite those unrelated static errors.
No broad unrelated refactor was made to hide or rewrite the baseline failures.

## 7. Conflict and integration risks

- The queue capability vocabulary remains a shared contract; new worker types
  must be added to the capability map before enqueue calls are introduced.
- Generic route-level job creation accepts arbitrary job types through the
  existing API schema; callers should provide a valid capability when a worker
  specialization is required.
- Universal renderer job types intentionally share one capability and handler;
  format-specific result validation remains in the completion matrix.
- `design_render_zip_export` and `generate_project_zip` are distinct ZIP paths
  with different persistence models and must not be merged by name alone.
- The API typecheck baseline should be remediated separately, especially the
  `pptxgenjs` declaration mismatch, rather than mixed into this audit branch.

## 8. Remaining risks

1. The project ZIP service currently stores a path reference in the existing
   delivery flow; deployment-specific object-storage upload behavior remains an
   infrastructure concern.
2. Some scheduled/plugin job types do not have generic `executeJob()` handlers.
   They must be routed by their owning scheduler/plugin before being enabled in
   production.
3. The full API typecheck baseline remains red as described above.
4. Remote branch publication could not be completed: `gitsafe-backup` accepts
   only `main`, and GitHub authentication is unavailable. The TEAM 43 branch
   and commit are therefore local only.

## 9. Final verdict

**TEAM 43 implementation: complete locally from verified baseline `3af1e2b`.**

The audited queue, worker, renderer, and completion paths now fail explicitly
for unsupported jobs, persist validated capabilities, route universal renderer
jobs, and require concrete deliverable evidence before completion.

**Remote publication: not completed.** The branch remains
`audit/team-43-workflow-jobs`; `main` was not changed.