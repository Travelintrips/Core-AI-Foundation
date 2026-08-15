# ULTIMATE FINAL CROSS-WP AUDIT — INTERIOR DESIGN / LAYOUT

**Audit date:** 2026-08-15  
**Repository state audited:** `main`  
**Main SHA audited:** `ea2bdf389ca26d14b4f2e35fddc9d804f63a97e6`  
**Canonical baseline from uploaded audit:** `d695236e4436e1ea6ce6c374349e99825679e5f6`  
**Audit mode:** read-only  
**Source changes:** none  
**Database changes:** none  
**Deployment/publish:** none

## Executive summary

The audited `main` is a legitimate descendant of the uploaded baseline (`d695236e` is an
ancestor of `ea2bdf38`) and is synchronized with `origin/main`. The runtime health check,
API build, admin build, API tests, and admin tests pass. The workspace OpenAPI consistency
check also passes.

The roadmap is not proven production-ready as one canonical Interior Design/Layout system.
The audit found unresolved P1 release blockers:

1. The admin browser still reads `VITE_ADMIN_API_KEY` and sends `x-admin-api-key` directly,
   despite the safer session-cookie contract in `apiFetch`.
2. Interior assets and exports are backed by the public `ai-assets` bucket while export
   download policy assumes expiry/private access. The deployed ACL and object sensitivity
   were not proven.
3. Queue worker enforcement of job tenant ownership and `requiredCapability` was not
   demonstrated at the worker boundary; the worker derives tenant identity from job
   payload data.
4. Multiple parallel ownership candidates remain unresolved: `id_projects` versus
   `creative_projects`, `ai_design_versions` versus `ai_entity_versions`,
   `ai_layout_plans` versus `layout_sessions`, and `export_packages` versus
   `design_render_zip_exports`.
5. The running API service is repeatedly receiving provider authentication failures:
   OpenAI and Anthropic return 401 responses, while Google/Gemini reports a key as
   leaked. This blocks proving a working end-to-end AI generation path.

Therefore the exact final verdict is:

> **INTERIOR DESIGN / LAYOUT — NOT READY, P1 REMEDIATION REQUIRED**

This is not a claim that every suspected path is exploitable in production. Several findings
are verification blockers because the canonical ownership, deployed storage policy, dispatcher
enforcement, and authenticated E2E environment were not demonstrable from the repository and
available safe runtime checks.

---

## 1. Main SHA audited

| Check | Result |
|---|---|
| Current branch | `main` |
| `HEAD` | `ea2bdf389ca26d14b4f2e35fddc9d804f63a97e6` |
| `origin/main` | `ea2bdf389ca26d14b4f2e35fddc9d804f63a97e6` |
| Uploaded baseline | `d695236e4436e1ea6ce6c374349e99825679e5f6` |
| Baseline ancestry | Confirmed; baseline is an ancestor of current `HEAD` |
| Pending merge/rebase | None observed |
| Working tree | One untracked uploaded audit prompt only |

Commits after the uploaded baseline are limited to hotfix/documentation/configuration/image
changes visible in the current history:

```text
d08ab5d1 Add hotfix release verification documentation
5440d3c6 latest application updates
bd676dc3 Update replit configuration settings
ea2bdf38 Add image asset
```

No feature branch was merged during this audit. Remote feature branches remain present and
were reported, not deleted.

## 2. WP coverage matrix

The uploaded audit asserts that WP-01 through WP-12 are complete and that WP-13 is not part
of this roadmap. The repository contains implementation and merge evidence for the major
workstreams, but no single tracked WP-01→WP-12 canonical coverage/lineage matrix. The
following is therefore an evidence matrix, not a claim that every WP boundary is proven.

| WP | Repository evidence | Current audit status |
|---|---|---|
| WP-01 | Room/template baseline and early Interior Design foundations | Evidence found; canonical predecessor chain not centrally documented |
| WP-02 | Furniture/layout catalog and library work | Evidence found; ownership against later placement data needs explicit matrix |
| WP-03 | Placement and collision engine routes/services | Implemented evidence; OpenAPI source-of-truth drift remains |
| WP-04 | OBB/SAT and rotation-aware layout-composer work | Implemented evidence; adapter ownership is not centrally declared |
| WP-05 | Discovery/implementation documents exist | Completion and canonical boundary not independently proven |
| WP-06 | Placement canvas/UI and placement-rule work | Implemented evidence; frontend/backend state ownership needs proof |
| WP-07 | Constraint engine and roadmap-resolution document | Implemented evidence; no canonical WP-01→WP-12 matrix |
| WP-08 | Moodboard generator/service and source-literal fixes | Implemented evidence; authenticated E2E not run |
| WP-09 | Rendering pipeline and universal renderer work | Implemented evidence; worker tenant/capability boundary unresolved |
| WP-10 | Review/versioning implementation and tests | Implemented evidence; version-system collision unresolved |
| WP-11 | Export engine and export idempotency work | Strong local evidence; storage privacy boundary unresolved |
| WP-12 | Expiry/security hardening and release documentation | Strong local evidence; full release gate still blocked by P1 findings |
| WP-13 | No canonical Interior Design/Layout WP-13 found | Do not create; similarly named documents belong to other tracks unless explicitly scoped |

## 3. Roadmap and Git consistency

### Positive evidence

- `docs/roadmap/wp07-layout-roadmap-resolution.md` explicitly separates the layout WP-07
  lineage from other similarly numbered audit-log/SSE workstreams.
- Current `main` is synchronized with `origin/main`.
- No pending merge or rebase was observed.

### Findings

- No tracked document was found that acts as the canonical WP-01→WP-12 predecessor,
  successor, owner, and merge-lineage matrix.
- `docs/security/wp13-rls-completion.md` and references to WP-14 in
  `scripts/rollback-runbook.md` create scope ambiguity when read alongside the uploaded
  audit's statement that WP-13 does not exist. These may belong to other platform tracks,
  but the scope separation is not consistently obvious.
- The uploaded prompt remains untracked under `attached_assets/`. This is a P3 release
  hygiene issue, not product source.

## 4. Architecture ownership matrix

| Foundation | Candidate canonical owner | Introduced/developed by | Readers/writers observed | Duplicate or fallback risk | Severity |
|---|---|---|---|---|---|
| `creative_projects` | Shared `lib/db` schema | Shared platform work | Concept drafts/render sessions and other platform services | Competes with domain-local `id_projects` | P1 |
| `id_projects` | Interior domain schema | Team 17 Interior Design | Interior service and domain routes | No demonstrated bridge/FK to shared `creative_projects` | P1 |
| Concept drafts | `team-17-concept-drafts.sql` + Interior service | Team 17 | Interior admin/public routes and editor | Links by `project_uuid` to `creative_projects`, not `id_projects` | P1 |
| `layout_sessions` / placements | `lib/db` placement engine | WP-03A/WP-06 | Placement, collision, editor paths | Competes with unlinked `ai_layout_plans` | P1 |
| `ai_layout_plans` | Integration Team 12 migration | Layout composer | Integration schema/API fragment | No FK, tenant key, or project linkage shown | P1 |
| Collision engine | Collision service/routes | WP-03B | Placement sessions and stateless geometry endpoint | OpenAPI only in integration fragment | P1 |
| OBB/SAT adapter | Layout-composer adapter | WP-04A/WP-04B | Layout composer | Boundary to collision engine is documented in code, not a single ownership registry | P2 |
| Constraint engine | Layout constraint routes/services | WP-07 | Layout/editor paths | Full lifecycle linkage not proven | P2 |
| Moodboard | Interior `moodboardService` and schemas | WP-08 | Interior routes/editor | Provider/cost linkage is not fully demonstrated | P2 |
| Rendering pipeline | Interior render service + universal renderer | WP-09/WP-14-related work | Render routes/worker | Two layers exist; canonical provider and completion mapping need proof | P2 |
| `ai_entity_versions` | Shared immutable version schema | WP-10/platform versioning | Export and version paths | Competes with `ai_design_versions` | P1 |
| `ai_design_versions` | Legacy design-studio migration | Design Studio v4.5 | Runtime consumers not proven dead | Separate project-ID model and no bridge shown | P1 |
| `creative_render_sessions` | Shared render-session schema | Rendering platform | Render/session paths | Linkage to Interior domain source needs proof | P2 |
| `creative_ai_assets` | Shared asset schema | Creative platform | Render/output/editor paths | Storage bucket is public by implementation | P1 |
| `ai_jobs` | Shared job system | Worker/queue work | Universal renderer/export execution | Worker-level capability/tenant enforcement not demonstrated | P1 |
| `ai_cost_records` | Shared cost service/schema | Phase 4 services | Provider/service paths | Missing job/session/version/call fingerprint for render accounting | P2 |
| `export_packages` | Interior export schema/service | WP-11/WP-12 | Export routes/download policy | Competes with `design_render_zip_exports` | P1 |
| `design_render_zip_exports` | Shared design-render ZIP schema | Design renderer work | Consumers not proven inactive | Parallel export concept | P1 |
| Supabase Storage | `supabaseStorage.ts` | Shared storage helper | Upload/public URL/signed download paths | `ai-assets` is public; expiry can be bypassed by permanent URL | P1 |
| `InteriorDesignEditor` | Admin frontend component | WP-06/WP-08/WP-10/WP-12 integration | All major interior panels | Local polling and direct auth headers can diverge from backend state | P1/P2 |
| API routes | Global `routes/index.ts` + domain routers | Multiple WPs | Frontend/generated clients | Runtime routes exceed canonical OpenAPI entries | P1 |
| OpenAPI contracts | `lib/api-spec/openapi.yaml` | Shared API contract | Generated clients/Zod | Layout/interior routes remain in integration fragments | P1 |
| Auth/tenant resolver | Global `adminAuthWithExceptions` + tenant resolver | Platform security work | Routes/services | Worker payload trust and admin browser key path are exceptions | P1 |
| Audit/event bus | Shared audit/event infrastructure | Platform work | Route/service side effects | End-to-end event coverage not proven | P2 |

## 5. DB/schema verdict

**Verdict: NOT CLEAR — P1 ownership and linkage blockers.**

### Positive evidence

- Export package idempotency is aligned locally. The unique scope is tenant, project,
  source version hash, and idempotency key in `artifacts/api-server/src/domains/interior-design/schema.ts:251-260`.
- `scripts/migrations/wp12-export-idempotency-hardening.sql` replaces the weaker export
  index with the same intended canonical scope.
- Export resource bounds are present: row, file-size, and ZIP-size limits in
  `exportService.ts:34-38,147-177,548-550`.

### Findings

- `id_projects` exists in the Interior domain schema, while concept drafts explicitly
  state that they link to `creative_projects.project_id`; the two project systems have
  no demonstrated canonical adapter or enforced relation.
- `ai_layout_plans` is an integration migration table with no project/tenant foreign key
  linkage, while `layout_sessions` and placements are active in the shared schema.
- `ai_entity_versions` and `ai_design_versions` represent parallel version systems with
  different project-ID assumptions.
- `export_packages` and `design_render_zip_exports` represent parallel export concepts.
- Production application of the relevant migrations and RLS state was not independently
  verified during this read-only audit.

## 6. API and contract verdict

**Verdict: NOT CLEAR — P1 OpenAPI/generated-client drift.**

### Runtime route inventory

| Method | Path | Auth at runtime | Tenant source | Service | Writes data? | Canonical/legacy assessment |
|---|---|---|---|---|---|---|
| POST | `/api/public/interior-design/projects` | Public route rules | Public creation flow | Interior service | Yes | Canonical public entry appears active |
| POST | `/api/public/interior-design/projects/:token/brief` | Access token | Token possession | Interior service | Yes | Canonical public brief path |
| GET | `/api/public/interior-design/projects/:token/outputs` | Access token | Token possession | Interior service | No | Canonical public read path |
| GET | `/api/ai/interior-design/projects` | Global admin/session | Authenticated context | Interior service | No | Runtime canonical candidate |
| GET/PATCH | `/api/ai/interior-design/projects/:id` | Global admin/session | Authenticated context plus service lookup | Interior service | PATCH yes | Runtime canonical candidate; tenant scope needs proof |
| POST | `/api/ai/interior-design/projects/:id/generate` | Global admin/session | Authenticated context | Interior service | Yes/queues work | Runtime canonical candidate |
| GET | `/api/ai/interior-design/projects/:id/outputs` | Global admin/session | Authenticated context | Interior service | No | Runtime canonical candidate |
| POST | `/api/ai/interior-design/projects/:projectUuid/moodboard/generate` | Global admin/session | Authenticated tenant context | Moodboard service | Yes/queues work | Runtime route |
| GET/POST/PATCH/DELETE | `/api/ai/layout-sessions...` | Global admin/session | Collision/placement tenant resolver | Placement service | Mixed | Runtime route family |
| POST | `/api/ai/layout-sessions/:sessionId/collision-check` | Global admin/session | `getTenantId(req)` | Collision service | No/derived result | Runtime route |
| GET | `/api/ai/layout-sessions/:sessionId/collisions` | Global admin/session | `getTenantId(req)` | Collision service | No | Runtime route |
| POST | `/api/ai/collision/check` | Global admin/session | Auth required, stateless body | Collision service | No | Runtime route |
| GET/POST | `/api/ai/layout-composer/...` | Global admin/session | Route-level auth | Layout composer | Mixed | Runtime route |

The application-level mount uses `/api` and global `optionalSessionAuth` plus
`adminAuthWithExceptions` in `artifacts/api-server/src/app.ts:123-130`. The route source
files correctly define paths without the app-level `/api` prefix.

### Contract drift

The canonical `lib/api-spec/openapi.yaml` contains only partial related coverage around
the inspected layout/interior area (`lib/api-spec/openapi.yaml:8116-8196`). The following
runtime families were found in integration fragments but not as canonical entries in the
main OpenAPI file:

- `/ai/layout-composer/*`
- `/ai/collision/check`
- `/ai/layout-sessions/{sessionId}/collision(s)`
- public/admin Interior Design project CRUD and generation routes

Evidence: `integration/openapi/team-12.yaml:13-81` and
`integration/openapi/team-17.yaml:19-230`.

This makes generated Zod/client freshness and frontend contract coverage unproven even
though `workspace-check` reports that the generated directories themselves are internally
healthy.

## 7. Lifecycle and state-machine verdict

**Verdict: PARTIAL — approval/export boundary is strong locally; cross-WP lifecycle is not
fully proven.**

### Canonical flow reviewed

```text
project → concept draft → review → approved snapshot → layout → placement
→ constraints → moodboard → render → review/version → export → download
```

| Boundary | Observed behavior | Verdict |
|---|---|---|
| Draft vs approved | Editor blocks render when unapproved or dirty; approval/revision routes exist | Positive local evidence |
| Approved snapshot | Export resolves an approved version and computes a source hash | Positive local evidence |
| Request revision | Route/service exists, but review transitions use read-then-unconditional update | P1 concurrency risk |
| Restore version | Version infrastructure exists; full restore-as-new-version behavior not proven | Unknown/P2 |
| Historical read-only | UI and version tests exist; all downstream readers using immutable source not proven | P2 |
| Render from version | Export source/version linkage exists; worker/session completion linkage not proven | P2 |
| Re-export from version | Export hash and idempotency protections exist | Positive local evidence |
| Expired download | Expiry and completed/storage checks are tested | Positive local evidence |
| Retry/failed job | Worker failure behavior exists; dispatcher retry/dead/orphan policy not proven | P1/P2 |
| Approved layout mutation | Editor has read-only/gating logic; server-side mutation boundary across all paths not proven | P1/P2 |

### Concurrency finding

`updateConceptDraft` checks `updatedAt` during an initial read in
`artifacts/api-server/src/domains/interior-design/service.ts:583-617`, then performs an
unconditional update at `:636-642`. Concurrent writers can both pass the initial check.
Approval and revision transitions have the same read-then-unconditional-update shape at
`:661-705` and `:725-756`.

## 8. Auth, tenant, and IDOR verdict

**Verdict: NOT CLEAR — P1 blockers.**

### Positive evidence

- Public project routes use an access token rather than accepting a client-provided
  numeric project ID, as documented in `artifacts/api-server/src/domains/interior-design/router.ts:1-20`.
- A no-credential GET smoke test against `/api/ai/interior-design/projects` returned
  `401 Unauthorized`.
- A no-credential request to `/api/ai/layout-sessions/not-a-uuid/collisions` returned
  `401 Unauthorized`.
- The app-level auth chain is installed globally before the route router.

### P1 findings

1. `InteriorDesignEditor.tsx:1180` reads `import.meta.env.VITE_ADMIN_API_KEY`; the
   component sends it as `x-admin-api-key` at `:303-308`, `:454-457`, and `:1198-1201`.
   `ReviewVersionsPanel.tsx:90-94` has the same direct-header pattern. This is an
   admin credential delivery path in browser code and conflicts with
   `artifacts/ai-platform/src/lib/apiFetch.ts:46-62`, which intentionally uses only
   `credentials: "include"` and omits the admin key.
2. Interior service reads and mutations in
   `artifacts/api-server/src/domains/interior-design/service.ts:142-160` and
   `:215-241` are primarily project-ID filtered. Whether admin users are intentionally
   platform-wide or tenant-scoped is not established by the inspected path.
3. Worker and export execution receive tenant information from job payload fields.
   A dispatcher/DB boundary that re-resolves and verifies tenant ownership was not
   demonstrated.

## 9. Snapshot and immutability verdict

**Verdict: PARTIAL — export source immutability is strong; all consumers are not proven.**

### Positive evidence

- Export source resolution checks approved `ai_entity_versions` with entity type,
  project UUID, tenant, and approval state in `exportService.ts:255-299`.
- Export strips internal data through a public snapshot transformation before packaging
  (`exportService.ts:307` onward).
- Export records a source hash and rejects source changes during execution
  (`exportService.ts:386-420,566-569`).

### Gaps

- The existence of `ai_design_versions` means not all historical/version readers can be
  assumed to use `ai_entity_versions`.
- The export fallback path's approved-draft lookup does not show an explicit tenant
  predicate in the same way as the version lookup (`exportService.ts:272-278`).
- Full proof that render, moodboard, and historical export paths read immutable snapshots
  rather than current mutable data was not obtained.

## 10. Idempotency and concurrency matrix

| Operation | Idempotency key/fingerprint | DB-level protection | Race/retry assessment |
|---|---|---|---|
| Placement apply | Not proven from inspected canonical contract | Not proven | P2 verification gap |
| Render start | Request/job linkage exists; dedup key not proven | Not proven | P2 duplicate-work risk |
| Render retry | Worker supports failure path; exact retry identity not proven | Not proven | P2 |
| Version restore | Version number/idempotency contract not proven | Version uniqueness exists in shared schema | P2 |
| Reviewer notes/actions | No complete operation fingerprint found | State transition lacks predicate/version check | P1 concurrency risk |
| Export create | Tenant + project + source hash + idempotency key | Unique index and `onConflictDoNothing` | Positive |
| Export retry | Reuses export package/job concept | Race-safe insert exists | Positive locally; worker linkage still unknown |

Export is the strongest idempotency path. The rest of the lifecycle relies on application
checks or has insufficient evidence of a DB-level concurrent guard.

## 11. Queue, worker, and capability verdict

**Verdict: NOT CLEAR — P1 enforcement evidence missing.**

Positive evidence:

- `universalRenderWorker.ts:31-46` defines an explicit supported job-type allowlist.
- The worker renders through the universal renderer and returns artifacts with structured
  logging (`:66-135`).

P1 verification blocker:

- The worker validates job type, but does not visibly validate that
  `job.requiredCapability` matches the worker capability, that the job belongs to the
  tenant being executed, or that duplicate claims/retries/timeouts/dead states are
  enforced at this boundary.
- The request tenant is constructed from `rawRequest.tenantId` or
  `payload["_tenantId"]` (`universalRenderWorker.ts:101-110`).
- Export execution reads `_tenantId` from the job payload
  (`exportService.ts:553-567`), although enqueue code stamps the value earlier.
- Dispatcher implementation, claim locking, dead-letter handling, orphan session
  recovery, and job-to-session completion mapping were not proven in this audit.

## 12. Storage and asset verdict

**Verdict: NOT CLEAR — P1 privacy/expiry blocker.**

`artifacts/api-server/src/lib/supabaseStorage.ts:7-10` declares the `ai-assets` bucket as
public. Bucket creation also sets `public: true`, and `getSupabasePublicUrl()` constructs
permanent public CDN URLs (`:155-176`).

Interior export execution stores output in this storage layer
(`artifacts/api-server/src/domains/interior-design/exportService.ts:574-580`). The app also
has signed download redirect logic (`exportService.ts:363-373`), but a permanent public
object URL can bypass application expiry if discovered.

Local tests positively cover:

- expired exports,
- non-completed exports,
- missing storage references,
- signed download policy.

Not proven:

- deployed bucket ACL,
- whether every Interior asset is non-sensitive,
- whether DB rows and storage objects are reconciled,
- whether expired exports are physically inaccessible rather than only blocked by the
  application download endpoint.

## 13. Provider and AI pipeline verdict

**Verdict: NOT CLEAR — active provider health failures plus incomplete pipeline proof.**

- The universal renderer is the visible rendering abstraction and worker entry point.
- Provider/model selection, timeout, and retry behavior exist in related service code.
- A complete call-graph proof that moodboard and all interior image/render paths use one
  provider abstraction was not established.
- Secret leakage was not observed in the inspected output/snapshot paths.
- Provider response and cost linkage remain incomplete in the worker path.

### Current runtime provider failures

The running API workflow emitted repeated health-alert failures during the audit:

- OpenAI: HTTP 401, incorrect API key.
- Anthropic: HTTP 401, invalid API key.
- Google and Google Gemini: HTTP 403, provider reports the API key as leaked.
- Replicate: HTTP 401, unauthenticated.

Evidence is in the API workflow log captured on 2026-08-15. The actual credential values
were not accessed or displayed. `/api/healthz/full` reports database, schema, and
environment checks as `ok`, but that endpoint does not establish provider-call success.
Until provider credentials are rotated/validated in the intended environment and a safe
generation smoke test passes, Interior generation cannot be called production-ready.

## 14. AI cost tracking verdict

**Verdict: NOT CLEAR — P2 accounting linkage gap.**

`artifacts/api-server/src/services/costService.ts:18-32,59-85` records project/step/provider/
model/tokens/retry/status, but the inspected shape does not include a job ID, render
session ID, version ID, or call fingerprint.

The universal render worker returns render artifacts but does not visibly record a cost
entry in `universalRenderWorker.ts:66-135`. Retries can therefore create indistinguishable
ledger rows unless an outer layer supplies exactly-once accounting. A separate cost path
also exists in `brandIntelligenceAdapter.ts:456-462`.

## 15. Frontend state verdict

**Verdict: NOT CLEAR — P1 auth path and P2 state-race risks.**

Positive evidence:

- Tests cover editor, review/version panel, and coordinate transforms.
- Editor gates rendering on approval and unsaved edits
  (`InteriorDesignEditor.tsx:963-979,1031-1068`).
- Polling cleanup is present at `:971-975`.
- Output links use `rel="noreferrer"` in the inspected path.

Findings:

- Direct browser `VITE_ADMIN_API_KEY` use is a P1 security issue.
- Status and output calls are separate and polling has no request-generation/abort guard
  (`InteriorDesignEditor.tsx:940-975`), so switching projects or unmounting can allow
  stale responses to update local state.
- Render output presentation maps all normalized outputs without a visible cap or
  pagination (`InteriorDesignEditor.tsx:1140-1151`).
- Export status vocabulary differs between the interior export service
  (`queued|generating|completed|cancelled`) and the export workspace UI
  (`queued|processing|succeeded|failed|canceled|retrying`). Whether these are isolated
  APIs or a contract mismatch remains unproven.

## 16. E2E/UAT result

**Result: INCONCLUSIVE — authenticated test environment blocker.**

Safe read-only runtime checks performed through the shared proxy:

| Check | Result |
|---|---|
| `GET /api/healthz` | `200 OK` |
| `GET /api/ai/interior-design/projects` without credentials | `401 Unauthorized` |
| `GET /api/ai/layout-sessions/not-a-uuid/collisions` without credentials | `401 Unauthorized` |
| `POST /api/ai/collision/check` without credentials | `401 Unauthorized` |

The complete authenticated flow was not run because no dedicated safe test customer/
tenant fixture and no test-only authenticated session were available. No production
customer data was used. Consequently, the following remain unverified end-to-end:

```text
project → draft → review → approval → layout → placement → constraints
→ moodboard → render → version/review → export → download
```

Negative flows not fully exercised include wrong tenant, approved-boundary bypass,
expired direct object URL, concurrent duplicate operations, restored historical version,
missing asset, and failed provider/job recovery.

## 17. Regression, build, and typecheck result

| Check | Result | Notes |
|---|---|---|
| API test suite | PASS | 212 files, 6,161 tests |
| AI Platform test suite | PASS | 16 files, 495 tests |
| API production build | PASS | esbuild produced `dist/index.mjs` |
| AI Platform production build | PASS | Vite built successfully; sourcemap/chunk-size warnings |
| Workspace OpenAPI check | PASS | 410 operations; generated directories healthy |
| Full workspace typecheck | FAIL | Existing API-server errors outside the primary Interior domain |
| Interior-specific source typecheck | No direct Interior production-source error observed in the filtered output | API package still fails overall |

The full typecheck failure is a release hygiene problem even where it is not caused by
Interior Design/Layout. Representative existing failures include:

- `src/__tests__/collision-engine-routes.test.ts(121)` missing `fail`,
- several API tests with stale/incompatible fixtures,
- `src/services/presentation/presentationRenderService.ts` PptxGenJS type errors,
- unrelated route/service type errors.

The test suite passing does not override the failed typecheck or the unresolved P1
security/ownership findings.

## 18. Performance and resource verdict

**Verdict: PARTIAL — important bounds exist, several high-risk paths remain unproven.**

Positive evidence:

- Collision session placement limit is enforced before the DB query.
- Export row, file-size, and ZIP-size limits are present.
- Global API rate limiting and security response headers are active.
- Worker job-type allowlist is present.

Risks:

- Frontend renders all normalized render outputs without a visible cap.
- Polling is interval-based at roughly 4.5 seconds and has no request-generation guard.
- Queue concurrency, retry limits, timeout/dead-letter policy, and orphan recovery were
  not proven.
- Large JSON snapshot size and storage/object reconciliation were not measured.
- Admin build emits a large JavaScript chunk (approximately 2.8 MB before gzip); this is
  a P2 performance warning, not the primary release blocker.

## 19. Security static verdict

**Verdict: NOT CLEAR — P1 browser credential/storage findings.**

Static scan counts across the broader repository are not treated as vulnerabilities by
string occurrence alone. Relevant observations:

- No `debugger`, `eval`, or `new Function` match was found in the inspected scope.
- No `.skip`, `.todo`, or `.only` test markers were found in the inspected API/admin
  source test scope.
- `dangerouslySetInnerHTML` matches are in chart rendering and were not independently
  proven exploitable.
- The `Math.random` matches are primarily local editor/test ID generation and are not
  alone a security finding.
- The browser admin-key path and public storage URL path are concrete security concerns.

## 20. Git and release hygiene

### Positive evidence

- `main` equals `origin/main`.
- No pending merge or rebase was observed.
- Current `HEAD` is a descendant of the uploaded canonical baseline.
- No secret value was read or written during this audit.

### P3 finding

The uploaded prompt is untracked:

```text
attached_assets/Pasted-ULTIMATE-FINAL-CROSS-WP-AUDIT-INTERIOR-DESIGN-LAYOUT-Re_1786777738184.txt
```

It is a prompt/session document, not product source. It should not be included in a
production release tree unless intentionally retained by repository policy. Remote
feature branches related to old WP work remain visible; they were not deleted per audit
instructions.

## 21. P0 findings

**No confirmed P0 finding was established in this read-only audit.**

The audit did not find a demonstrated active cross-tenant data read/write exploit,
irreversible production corruption, or confirmed secret value leak. The P1 findings below
still prevent a production-ready declaration.

## 22. P1 findings

| ID | Finding | Evidence | Release blocker |
|---|---|---|---|
| P1-01 | Browser admin credential exposure | `InteriorDesignEditor.tsx:1180-1201`; `ReviewVersionsPanel.tsx:90-94`; safer cookie contract in `apiFetch.ts:46-62` | Yes |
| P1-02 | Public storage may bypass export expiry/privacy policy | `supabaseStorage.ts:7-10,155-176`; `exportService.ts:363-373,574-580` | Yes until ACL/sensitivity is proven |
| P1-03 | Queue tenant/capability enforcement not demonstrated | `universalRenderWorker.ts:31-46,66-135`; tenant from payload at `:101-110`; export payload tenant at `exportService.ts:553-567` | Yes until dispatcher/DB evidence is supplied |
| P1-04 | Parallel project/version/layout/export ownership candidates | `id_projects` domain schema; `creative_projects`; `ai_design_versions`; `ai_entity_versions`; `ai_layout_plans`; `layout_sessions`; both export tables | Yes until one canonical owner per foundation is documented and enforced |
| P1-05 | Non-atomic draft/review concurrency checks | `service.ts:583-642,661-705,725-756` | Yes for release if concurrent editing/review is supported |
| P1-06 | Runtime route families absent from canonical OpenAPI | `routes/index.ts:281-294`; `integration/openapi/team-12.yaml`; `integration/openapi/team-17.yaml`; canonical spec lacks matching families | Yes until generated contract/source-of-truth drift is resolved |
| P1-07 | Active provider authentication failures block AI generation | API workflow health-alert log: OpenAI/Anthropic/Replicate 401; Google/Gemini 403 leaked-key response | Yes until intended environment provider health and a safe generation smoke test pass |

## 23. P2 findings

| ID | Finding |
|---|---|
| P2-01 | No visible idempotency/DB guard proven for placement apply, render start/retry, restore, and reviewer actions |
| P2-02 | Cost records lack job/session/version/call-fingerprint linkage; universal renderer cost recording is not visible |
| P2-03 | Export approved-draft fallback lacks an explicit tenant predicate in the inspected query |
| P2-04 | Frontend polling can race when project/version changes; output presentation has no visible cap |
| P2-05 | Export status vocabulary differs across interior export service and export workspace UI |
| P2-06 | Full provider bypass/cost/retry call graph is not proven |
| P2-07 | Queue retry, timeout, dead-letter, orphan recovery, and concurrency behavior are not proven |
| P2-08 | Full workspace typecheck fails on existing API-server errors outside the primary Interior domain |
| P2-09 | Admin bundle is large and emits chunk-size warnings |
| P2-10 | No single canonical WP-01→WP-12 roadmap/ownership/merge-lineage document is tracked |
| P2-11 | Other-track WP-13/WP-14 documents create scope ambiguity |

## 24. P3 findings

| ID | Finding |
|---|---|
| P3-01 | Uploaded audit prompt is untracked under `attached_assets/` |
| P3-02 | Static scan contains non-vulnerability occurrences of `console.*`, `Math.random`, and chart `dangerouslySetInnerHTML`; they need policy review but are not individually proven vulnerabilities |

## 25. Conflict matrix

This is the required conflict matrix. “Observed behavior” distinguishes confirmed code
behavior from an unproven ownership boundary.

| Conflict ID | Area | WP A | WP B | Canonical source | Observed behavior | Expected behavior | Severity | Evidence | Fix recommendation | Release blocker? |
|---|---|---|---|---|---|---|---|---|---|---|
| C-01 | Schema/project | WP-08/17 | shared creative platform | One project table and one UUID relation | `id_projects` exists while drafts/render sessions use `creative_projects` | One project authority with enforced bridge | P1 | `domains/interior-design/schema.ts`; `team-17-concept-drafts.sql`; `creative-projects.ts` | Declare owner, migrate/adapt all consumers, add invariant tests | Yes |
| C-02 | Versioning | WP-10 | Design Studio v4.5 | `ai_entity_versions` | `ai_design_versions` remains a parallel model with different project IDs | One immutable version authority | P1 | `ai-entity-versions.ts`; `v4.5-design-studio.sql` | Prove legacy inactive or retire/bridge it before release | Yes |
| C-03 | Layout | WP-03/06 | Team 12 composer | `layout_sessions`/placements | `ai_layout_plans` is unlinked and has no tenant/project FK | One layout/placement state source | P1 | `placement-engine.ts`; `integration/migrations/team-12.sql` | Make composer adapter-only or formally link it | Yes |
| C-04 | Export | WP-11/12 | design renderer | `export_packages` | `design_render_zip_exports` is another export table/concept | One export lifecycle and download policy | P1 | Interior schema; `design-render-zip-exports.ts` | Establish active owner and deprecate unused table/path | Yes |
| C-05 | API | WP-03/04 | shared contract | canonical OpenAPI | Runtime routes exist only in integration OpenAPI fragments | Every active route represented in canonical spec and generated clients | P1 | `routes/index.ts`; `lib/api-spec/openapi.yaml`; team fragments | Consolidate spec and regenerate clients/Zod | Yes |
| C-06 | Auth | admin UI | session auth helper | session cookie | Interior editor sends browser `VITE_ADMIN_API_KEY` while `apiFetch` forbids it | Browser uses session auth only | P1 | `InteriorDesignEditor.tsx`; `ReviewVersionsPanel.tsx`; `apiFetch.ts` | Remove direct browser key path and route calls through session helper | Yes |
| C-07 | Tenant | queue | worker | authenticated server-side tenant | Worker derives request tenant from payload | Worker verifies tenant from trusted job/DB context | P1 | `universalRenderWorker.ts`; `exportService.ts` | Re-resolve tenant at claim/execute boundary and test wrong-tenant jobs | Yes |
| C-08 | Storage | asset upload | export/download | private tenant namespace | `ai-assets` bucket and public CDN URL are public | Private objects, signed URLs, and enforced expiry | P1 | `supabaseStorage.ts`; `exportService.ts` | Make sensitive bucket private and remove permanent access path | Yes |
| C-09 | State | draft editor | review transitions | compare-and-swap state machine | Read-then-unconditional updates can lose concurrent changes | DB-predicate/CAS transitions | P1 | Interior `service.ts` | Add atomic state/version predicates and conflict response | Yes |
| C-10 | Cost | render worker | cost service | one ledger per provider call | Worker output has no visible cost write/fingerprint | Exactly-once or explicitly reconciled cost records | P2 | `universalRenderWorker.ts`; `costService.ts` | Add job/session/version/call identity and reconciliation | No, but financial risk |
| C-11 | Frontend | editor polling | project/version switching | current request generation | Polling has no abort/generation guard | Stale responses cannot overwrite current state | P2 | `InteriorDesignEditor.tsx:940-975` | Add abort/request identity guard | No |
| C-12 | Contract | export API | export workspace UI | one status enum | `completed/cancelled` versus `succeeded/canceled` vocabularies | One canonical status enum or explicit adapter | P2 | `exportService.ts`; `export-workspace/index.tsx` | Consolidate or document adapter and regenerate types | No |
| C-13 | Release | prompt artifact | product tree | clean release tree | Uploaded audit prompt is untracked | Prompt/session artifacts excluded or intentionally governed | P3 | `git status` | Exclude from release or retain only by policy | No |
| C-14 | Provider | AI generation | provider registry/health checks | one valid configured provider path | Running service repeatedly receives provider 401/403 failures | At least one intended provider path succeeds in the target environment | P1 | API workflow health-alert log; `/api/healthz/full` only checks DB/schema/env | Rotate/validate intended provider credentials and run safe generation smoke test | Yes |

## 26. Release blockers

The following must be resolved or supported by concrete deployment evidence before a
production-ready verdict:

1. Remove the browser `VITE_ADMIN_API_KEY`/`x-admin-api-key` path and prove admin browser
   requests use session auth.
2. Prove or correct storage privacy: private bucket/object policy, tenant namespacing,
   signed download enforcement, and expired-object behavior.
3. Prove queue claim/execute enforcement for tenant, required capability, duplicate claims,
   retries, timeouts, dead jobs, and job/session completion linkage.
4. Declare and enforce one canonical owner for projects, versions, layout plans, and export
   packages; prove legacy tables are inactive or safely bridged.
5. Consolidate active Interior/Layout runtime routes into the canonical OpenAPI spec and
   regenerate clients/Zod schemas.
6. Make draft/review state transitions atomic where concurrent writes are possible.
7. Provide an authenticated test-only E2E run through the complete lifecycle and negative
   tenant/approval/expiry/retry cases.
8. Clear the full workspace typecheck failure or explicitly document a release waiver with
   ownership and a separate remediation gate.
9. Restore and validate at least one intended AI provider path; do not treat generic
   environment health as proof that generation works.

## 27. Final recommendation

Do not declare the Interior Design/Layout roadmap production-ready from this audit.

The local tests and builds show substantial implementation maturity, especially around
export idempotency, approval/snapshot hashing, expiry policy, resource limits, route-level
authentication, and worker job-type allowlisting. They do not prove that WP-01 through
WP-12 operate as one canonical system because the ownership boundaries, browser auth path,
storage privacy policy, queue trust boundary, canonical OpenAPI coverage, and authenticated
E2E lifecycle remain unresolved.

> **INTERIOR DESIGN / LAYOUT — NOT READY, P1 REMEDIATION REQUIRED**
