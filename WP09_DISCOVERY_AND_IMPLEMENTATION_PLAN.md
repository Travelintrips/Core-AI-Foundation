# WP-09 Discovery and Implementation Plan

## Status

- Roadmap: **Interior Design / Layout**
- Work package: **WP-09 Rendering Pipeline**
- Predecessor: **WP-08 Moodboard Generator**
- Current implementation status: **Discovery and planning only**
- WP-09 implementation started: **NO**
- WP-08 merge: `e3325779744903e2236b22f74240b8f300a63b75`
- Verified main: local `main` is synchronized with `origin/main`

Quotation soft-delete remains a separate roadmap item. The previous namespace conflict is
resolved and is not reopened here.

## 1. Objective

Build a tenant-safe, idempotent rendering pipeline that turns an approved Interior Design
concept into one or more persisted render variants. The pipeline must preserve the approved
concept boundary, reuse the existing moodboard/material/furniture/layout foundations, route
expensive work through the existing job engine, persist generated files in existing storage,
and expose progress and results to the Interior Design admin UI.

The first WP-09 slice should be deliberately narrow:

1. Resolve one canonical approved project snapshot.
2. Build a deterministic render input manifest.
3. Enqueue preview/final render jobs through `ai_jobs`.
4. Generate and persist bounded render variants.
5. Record provider usage/cost and terminal outcome.
6. Make the result visible in the existing Interior Design editor.

It must not create a second image provider abstraction, storage abstraction, queue, geometry
engine, or parallel asset table.

## 2. Existing canonical foundations

### Approved concept and project identity

- `creative_projects.result` is the canonical persistence location for the WP-08 moodboard.
- `id_concept_drafts` contains editable and approved snapshots:
  - `materials_draft` / `approved_materials`
  - `furniture_draft` / `approved_furniture`
  - `lighting_draft` / `approved_lighting`
  - `space_plan_draft` / `approved_space_plan`
  - `review_state`
- `approved_for_rendering` is the immutable boundary already used by
  `moodboardService.ts`.
- New WP-09 routes should use the `creative_projects.project_id` UUID as the canonical
  project reference, matching WP-08 and `creative_ai_assets.project_id`.

Relevant code:

- `artifacts/api-server/src/domains/interior-design/moodboardService.ts`
- `artifacts/api-server/src/domains/interior-design/schema.ts`
- `artifacts/api-server/src/domains/interior-design/service.ts`
- `artifacts/api-server/src/domains/interior-design/router.ts`

### Moodboard, materials, furniture, and images

- WP-08 moodboards are persisted under `creative_projects.result.moodboard`.
- `materials` and `furniture_items` are the canonical libraries.
- WP-08 resolves approved references to canonical library rows and records source literals.
- Project image metadata is stored in `id_interior_asset_images`.
- `creative_ai_assets` is the existing generated-asset table and already supports:
  - provider/model
  - image and thumbnail URLs
  - storage path
  - status and QC
  - cost and latency
  - structured metadata
  - preview/final render stages
  - render session and concept index

Relevant code:

- `artifacts/api-server/src/domains/interior-design/moodboardService.ts`
- `artifacts/api-server/src/domains/interior-design/interiorImageService.ts`
- `artifacts/api-server/src/services/imagePreviewService.ts`
- `lib/db/src/schema/creative-ai-assets.ts`
- `lib/db/src/schema/creative-render-sessions.ts`

### Layout and placement

- `layout_sessions` and `placements` provide a tenant-owned 2D placement foundation.
- The collision/constraint services already validate room bounds, clearance, and placement
  geometry.
- `InteriorDesignEditor` already owns the admin editing experience for the concept draft,
  materials, furniture, lighting, and moodboard.

Relevant code:

- `lib/db/src/schema/placement-engine.ts`
- `artifacts/api-server/src/services/placementRuleEngineService.ts`
- `artifacts/api-server/src/services/collision-engine/`
- `artifacts/ai-platform/src/components/interior-design/InteriorDesignEditor.tsx`
- `artifacts/ai-platform/src/components/interior-design/MoodboardPanel.tsx`

### Providers and AI image generation

- `imagePreviewService.ts` already contains a shared two-stage image pipeline:
  - preview generation
  - customer concept selection
  - final generation
  - optional additional previews
  - final-only QC
- It reuses `executeAI`, provider/model registry lookup, secret handling, Replicate image
  generation, Supabase persistence, audit logging, and `recordCost`.
- The existing tier configuration already distinguishes standard, premium, and enterprise
  quality/cost profiles.
- `interiorImageService.ts` provides a separate, existing Pexels enrichment path for
  reference images. It is not a render provider and should remain so.

Relevant code:

- `artifacts/api-server/src/services/imagePreviewService.ts`
- `artifacts/api-server/src/services/aiExecutionService.ts`
- `artifacts/api-server/src/services/aiSecretService.ts`
- `artifacts/api-server/src/services/costService.ts`
- `artifacts/api-server/src/domains/interior-design/interiorImageService.ts`

### Storage

- `supabaseStorage.ts` provides Supabase upload/public URL helpers and bucket handling.
- `objectStorage.ts` provides the Replit object-storage adapter and signed/public object
  handling for other existing flows.
- WP-09 must select the existing storage adapter based on the established asset policy; it
  must not add a third storage abstraction.

Relevant code:

- `artifacts/api-server/src/lib/supabaseStorage.ts`
- `artifacts/api-server/src/lib/objectStorage.ts`

### Jobs and queue

- `ai_jobs` is the existing durable job table.
- `jobDispatcherService.ts` provides worker registration, capability routing, leases,
  retries, stale recovery, concurrency limits, and graceful shutdown.
- `queueManagerService.ts` is the existing enqueue boundary.
- The universal renderer already has a job worker and production adapters.
- `design_render_batches` and `design_render_items` demonstrate a durable batch/item
  orchestration pattern with dispatch markers, leases, idempotency hashes, and output fields.

Relevant code:

- `lib/db/src/schema/ai-jobs.ts`
- `artifacts/api-server/src/services/queueManagerService.ts`
- `artifacts/api-server/src/services/jobDispatcherService.ts`
- `artifacts/api-server/src/services/jobWorkerService.ts`
- `artifacts/api-server/src/workers/universal-renderer/universalRenderWorker.ts`
- `lib/db/src/schema/design-template-engine.ts`

### Security and tenant ownership

- `RequestContext` and `resolveAuthenticatedTenantContext()` are the canonical tenant
  resolution patterns.
- Client-supplied tenant identifiers must never control project or asset selection.
- Public access-token routes use possession of the token as the ownership proof.
- Admin routes use the app-level admin authentication middleware.
- New render requests must resolve project ownership server-side and stamp the resolved
  tenant into job payloads.

Relevant code:

- `artifacts/api-server/src/security/requestContext.ts`
- `artifacts/api-server/src/security/tenantResolution.ts`
- `artifacts/api-server/src/repositories/tenantScope.ts`
- `artifacts/api-server/src/domains/interior-design/router.ts`

## 3. Canonical inputs

The render request must be built server-side from the following ordered inputs:

1. `creative_projects.project_id` and server-resolved tenant.
2. The latest approved concept snapshot in `id_concept_drafts`:
   - approved space plan
   - approved materials
   - approved furniture
   - approved lighting
   - `review_state = approved_for_rendering`
3. The persisted WP-08 moodboard in `creative_projects.result.moodboard`.
4. Canonical material rows from `materials`.
5. Canonical furniture rows from `furniture_items`.
6. Approved project image references from `id_interior_asset_images`.
7. Validated layout/placement data when the project-to-layout linkage is available.

The worker must store a normalized, redacted render manifest in job metadata or the render
session metadata. It must not trust a client-provided prompt, provider, model, storage path,
tenant ID, or asset URL as the authority.

## 4. Approved snapshot boundary

The pipeline may enqueue a production render only when the server observes
`review_state = approved_for_rendering`.

Rules:

- Before approval, preview planning may read editable draft data but must label the result
  as a draft preview.
- Final rendering reads only `approved_*` fields and the approved moodboard snapshot.
- Approved values are copied into an immutable render manifest at enqueue time.
- Later draft edits must not mutate a queued or running render.
- Leaving the approved state is possible only through the existing revision workflow.
- A render job must fail closed if the approved snapshot is missing or malformed.

## 5. Rendering pipeline stages

### Stage A — Validate and snapshot

- Resolve tenant and project ownership.
- Check commercial/service eligibility and approved review state.
- Resolve canonical material/furniture references.
- Resolve layout/placement input.
- Create a stable canonical manifest and hash it.

### Stage B — Plan render variants

- Apply package/resource limits.
- Select preview or final mode.
- Select a provider/model only through the existing provider registry and tier policy.
- Generate a bounded list of variant specifications.
- Persist the render session and idempotency key before enqueueing jobs.

### Stage C — Enqueue

- Enqueue one durable `ai_jobs` job per render unit or use the existing render batch/item
  pattern where fan-out is required.
- Include only server-resolved identifiers and the immutable manifest reference/hash.
- Do not run provider calls directly inside an HTTP request.

### Stage D — Generate

- Reuse the existing image provider execution path in `imagePreviewService.ts`, or extract
  a dependency-injected adapter without changing provider semantics.
- Keep provider credentials server-side.
- Enforce timeout, retry, output-size, and concurrency caps.

### Stage E — Persist

- Download/provider-validate the returned image.
- Upload it through the selected existing storage adapter.
- Persist `creative_ai_assets` with `renderStage`, `renderSessionId`, provider/model,
  storage path, metadata, status, and cost fields.
- Never expose internal storage paths directly to customers.

### Stage F — Quality check

- Final renders pass the existing final QC policy.
- QC failure is terminal or retryable according to the existing failure taxonomy.
- Preview renders remain fast and do not incur final QC unless the owner explicitly changes
  that product rule.

### Stage G — Publish result

- Update the render session/item terminal state atomically.
- Emit canonical audit/event records.
- Expose only customer-safe URLs and status.
- Prevent a failed or incomplete job from being marked completed.

## 6. Render variants and resource limits

Initial defaults should reuse the existing two-stage policy:

- Preview: bounded count, cheapest supported image model, no final QC.
- Final: selected concept only, package-tier model, final QC threshold `80`.
- Standard, premium, and enterprise remain configuration tiers rather than new providers.
- Per-request preview and final counts must be capped.
- Maximum output dimensions, payload size, external asset count, fetch timeout, render
  duration, and output size should reuse `UNIVERSAL_RENDER_LIMITS` where applicable.
- Provider-specific limits belong in the existing provider/model registry, not in route
  handlers.

## 7. Provider reuse

Use the existing provider stack in this order:

1. `aiExecutionService` / registered model and provider records for LLM prompt planning and
   QC.
2. Existing Replicate image-generation path in `imagePreviewService.ts` for photorealistic
   image output, subject to provider health and secret availability.
3. Existing `UniversalRendererService` only for deterministic composition/export formats
   that it already supports (SVG, PNG, PDF, thumbnail, ZIP, composition JSON).
4. Existing Pexels integration only for reference-image enrichment, never as the render
   provider.

No new provider table, provider SDK wrapper, or parallel model registry is permitted.

## 8. Persistence and storage

### Existing records to reuse

- `creative_render_sessions`: one Preview → Select → Final lifecycle per request.
- `creative_ai_assets`: preview/final output assets and provider metadata.
- `ai_jobs`: durable execution, retry, worker lease, and terminal status.
- `ai_cost_records`: token/cost attribution.
- `creative_projects.result.moodboard`: approved moodboard snapshot.
- `id_concept_drafts`: approved concept snapshot.

### Possible additive schema work

No migration is required for the first planning slice if the immutable render manifest and
idempotency key fit safely in existing `metadata`/`payload_json` fields. A migration is only
required if the owner approves a first-class project-to-layout relation, a query-critical
render manifest column, or a database-enforced idempotency constraint.

Storage paths should be namespaced by tenant/project/session/asset and must be generated
server-side. Public URLs may be returned only when the asset policy allows it; otherwise use
signed URLs.

## 9. Jobs, idempotency, and retry

- HTTP endpoints create or return an existing render session; they do not execute provider
  calls synchronously.
- The idempotency key should be derived from:
  - tenant
  - project UUID
  - approved snapshot hash
  - render mode
  - variant index
  - package/model policy version
- Existing completed work is returned rather than duplicated.
- A process crash after provider completion but before DB update must be recoverable by
  deterministic asset/job lookup.
- Retry transient provider, network, and storage errors with bounded exponential backoff.
- Do not retry validation, authorization, malformed snapshot, or policy failures.
- Stale worker recovery must use the existing lease/rebalance behavior.
- Every terminal transition must be guarded so completed/cancelled jobs cannot be moved
  backward accidentally.

## 10. Proposed API surface

The exact OpenAPI contract must be written before implementation and codegen. Proposed
resource shape:

- `POST /api/ai/interior-design/projects/{projectUuid}/renders`
  - validate approval and create/reuse a render session
  - return `202` with session ID/status
- `GET /api/ai/interior-design/projects/{projectUuid}/renders`
  - list tenant-owned sessions
- `GET /api/ai/interior-design/renders/{sessionId}`
  - return session status, progress, preview assets, final assets, and safe URLs
- `POST /api/ai/interior-design/renders/{sessionId}/select`
  - atomically select an available preview concept
- `POST /api/ai/interior-design/renders/{sessionId}/finalize`
  - enqueue final generation after concept selection
- `POST /api/ai/interior-design/renders/{sessionId}/retry`
  - retry only an allowed failed stage
- `POST /api/ai/interior-design/renders/{sessionId}/cancel`
  - cancel queued work and prevent future fan-out

Existing `/creative-ai/.../sessions` routes and `imagePreviewService.ts` are the closest
reuse target. Before adding parallel routes, determine whether they can be safely extended
with the canonical Interior Design adapter and tenant guards.

## 11. Admin UI

Extend `InteriorDesignEditor` and the existing moodboard surface rather than creating a
second Interior Design application:

- show approval/read-only state
- show the immutable manifest/source version used by a render
- start preview generation
- display queued/running/failed/completed progress
- select a preview concept
- request final render
- show QC score and failure/retry reason
- show render variants and safe preview/final URLs
- show cost/usage summary only to authorized admin roles

All loading, empty, error, retry, and approved-read-only states must be explicit. The UI
must never imply that a render completed merely because an enqueue request succeeded.

## 12. Tenant and security requirements

- Resolve tenant from authenticated request context, never body/query/header.
- Resolve project ownership server-side before loading snapshots or assets.
- Re-check ownership in workers from persisted tenant/project identifiers.
- Use allowlisted provider/model identifiers from the registry.
- Validate all provider-returned URLs before fetching; reuse SSRF-safe fetch validation.
- Do not accept arbitrary storage paths or arbitrary callback URLs.
- Do not expose provider credentials, raw prompts containing sensitive data, internal paths,
  or cross-tenant asset URLs.
- Log audit events with actor, tenant, project, session, job, and outcome metadata while
  redacting secrets and sensitive prompt content.

## 13. AI cost and token tracking

- Reuse `recordCost()` for prompt-planning, generation metadata, and QC calls where token
  data exists.
- Persist image generation cost/latency on `creative_ai_assets` and aggregate session totals
  on `creative_render_sessions`.
- Link `ai_cost_records` to the canonical project/session step where possible.
- Record provider/model, input/output tokens, retry count, fallback count, latency, and
  terminal status.
- Do not estimate a successful render as zero-cost because provider metadata is missing;
  record an explicit unknown/estimated status according to existing cost conventions.

## 14. Tests

Before implementation, add the test plan to the OpenAPI/API work breakdown. Required
coverage:

### Contract and unit tests

- approved snapshot selection and immutability
- canonical material/furniture resolution
- manifest canonicalization and hash stability
- variant count and resource-limit enforcement
- provider/model allowlist selection
- storage path generation
- retry classification and terminal state transitions
- idempotency for duplicate requests and crash recovery

### API and security tests

- tenant mismatch rejection
- cross-project and cross-tenant asset access rejection
- approval gate rejection
- invalid provider/model/payload rejection
- safe URL handling and SSRF protection
- cancel/retry authorization and state guards

### Worker and persistence tests

- enqueue idempotency
- lease claim/release and stale recovery
- provider success/failure/timeout
- storage failure after provider success
- QC fail-closed behavior
- atomic asset/session status updates
- cost record creation

### Regression tests

- rerun WP-08 moodboard tests
- preserve existing preview pipeline tests
- preserve universal renderer tests
- preserve Interior Design editor tests

## 15. Migration requirement

**Initial recommendation: no migration for the first implementation slice.**

Reuse `creative_render_sessions.metadata`, `creative_ai_assets.metadata`,
`ai_jobs.payload_json`, and the existing columns first. Add a hand-written migration only
after the owner approves one of these changes:

1. a first-class `layout_sessions` → `creative_projects` relation;
2. a query-critical immutable manifest column;
3. a database-level unique idempotency constraint;
4. a dedicated render-variant relation that cannot safely fit the existing session/assets
   model.

Drizzle-kit push must not be used to replace or drop the existing `ai_platform` schema.

## 16. Genuine owner decisions

The following decisions are material and must be resolved before implementation:

### Decision A — Render product definition

Should WP-09's primary deliverable be:

1. **Photorealistic room/image renders** generated through the existing Replicate/image
   pipeline; or
2. **Deterministic layout/composition renders** generated through the existing Universal
   Renderer; or
3. Both, with separate modes and separate acceptance criteria?

This changes provider usage, output contract, QC, cost, and UI semantics.

### Decision B — Layout source linkage

`layout_sessions` currently has tenant ownership and geometry but no direct
`creative_projects.project_id` relation. Choose one:

1. Use the approved `id_concept_drafts.approved_space_plan` JSON as the canonical source for
   the first WP-09 render and integrate placement-engine sessions only when an existing
   server-owned mapping is present; or
2. Add an explicit project-to-layout relation through a hand-written migration before
   implementation.

This changes the data model and the authoritative source for placement inputs.

### Decision C — Final approval/publishing policy

Confirm whether final renders are:

1. automatically customer-visible after QC threshold;
2. admin-reviewed before customer visibility; or
3. customer-visible as watermarked previews until an existing commercial/approval gate
   unlocks them.

This changes status transitions, visibility, and security/commercial behavior.

Until Decisions A–C are confirmed, implementation should not start.

## 17. Recommended next sequence after decisions

1. Confirm Decisions A–C.
2. Freeze the OpenAPI contract and run codegen.
3. Add only the minimum schema/migration required by the selected layout linkage.
4. Add a canonical Interior Design adapter over `imagePreviewService` and `ai_jobs`.
5. Implement worker/job lifecycle and persistence guards.
6. Add routes and generated client hooks.
7. Extend `InteriorDesignEditor`.
8. Run the complete WP-09 test matrix and the WP-08 regression suite.
