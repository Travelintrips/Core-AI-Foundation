# Phase 6 — Risk Analysis

**Version:** 1.0.0  
**Baseline:** `material-v5.0.1`  
**Status:** Architecture only — no implementation

---

## Risk Scoring Key

| Likelihood | Impact | Risk Level |
|---|---|---|
| High × High | = **Critical** |
| High × Medium or Medium × High | = **High** |
| Medium × Medium | = **Medium** |
| Low × any or any × Low | = **Low** |

---

## 1. Technical Risks

### T1 — Spatial Collision Detection Complexity
**Description:** Furniture placement requires 2D/3D spatial overlap detection. Implementing accurate collision detection in TypeScript without a physics engine is error-prone and computationally expensive.  
**Likelihood:** High | **Impact:** High | **Level:** 🔴 Critical  
**Mitigation:**
- Phase 6 uses Axis-Aligned Bounding Box (AABB) checks only — simplifies collision to rectangle overlap tests in 2D floor projection
- Document explicitly that full 3D collision (rotated objects, irregular shapes) is deferred to a future phase
- Add `placementRules.type: 'bounding_box_override'` for furniture with non-rectangular footprints
- Validate all placements through `LayoutConstraintService` before persisting

### T2 — Session State Machine Complexity
**Description:** The design session has 11 states and multiple transition paths. Invalid transitions or missing guards could corrupt session state.  
**Likelihood:** Medium | **Impact:** High | **Level:** 🟠 High  
**Mitigation:**
- Implement `ALLOWED_TRANSITIONS` map (established pattern from Phase 5 `commercial-status-badge` memory)
- Every status PATCH goes through a single `transitionSessionStatus(from, to, guard)` function
- Terminal states (`approved`, `archived`) are server-guarded — client cannot directly set them
- Add a state machine unit test for every valid and invalid transition

### T3 — Orval Codegen Naming Collisions
**Description:** Phase 6 introduces many new schemas. Past experience shows orval 8.18.0 has naming collision bugs when schema names are similar (e.g., `RoomStyle` vs `RoomStyleInput`).  
**Likelihood:** High | **Impact:** Medium | **Level:** 🟠 High  
**Mitigation:**
- Apply the established workaround (pre-parse YAML as object, pass as `input.target`) documented in `orval-codegen-workaround` memory
- Use distinctive schema names: suffix input schemas with `Request`, output with `Response`
- Add orval codegen to CI validation (`verify:generated` script)

### T4 — TypeScript Project Reference Build Order
**Description:** `lib/db` must be compiled (`tsc -b`) before `api-server` typechecking is trustworthy. Missing this step produces silent type errors on new schema additions.  
**Likelihood:** Medium | **Impact:** Medium | **Level:** 🟡 Medium  
**Mitigation:**
- Established rule from `v40b-runtime-roster` memory: always run `pnpm run typecheck:libs` before `api-server` typecheck
- Add `lib/db` as a TypeScript project reference from `api-server` tsconfig
- CI must run `build:libs` before `verify:types`

### T5 — Circular Import Between Domain Modules
**Description:** With 3 bounded contexts and multiple shared services, circular imports are likely if domain boundaries are not strictly enforced.  
**Likelihood:** Medium | **Impact:** Medium | **Level:** 🟡 Medium  
**Mitigation:**
- Define strict module boundary: Catalog Context never imports from Session Context; AI Orchestration Context imports from both but exports nothing to them
- Use interface types (`import type`) across context boundaries
- Add an `eslint` no-restricted-imports rule for cross-context concrete imports

---

## 2. AI Risks

### A1 — AI Output Non-Determinism
**Description:** AI agents produce different outputs on identical inputs. Moodboard and layout composition results will vary between runs, making debugging and testing difficult.  
**Likelihood:** High | **Impact:** Medium | **Level:** 🟠 High  
**Mitigation:**
- Set `temperature: 0.3` for structured JSON output agents (Furniture Selector, Material Advisor, Room Planner)
- Set `temperature: 0.7` for creative agents (Interior Designer, Prompt Optimizer)
- Store `input_hash` in `design_agent_logs` to identify identical inputs with divergent outputs
- Use `seed` parameter where provider supports it for reproducible debugging

### A2 — AI Provider Rate Limits and Outages
**Description:** Design composition involves 5–7 sequential AI calls. A single provider outage or rate limit will fail the entire composition.  
**Likelihood:** Medium | **Impact:** High | **Level:** 🟠 High  
**Mitigation:**
- All AI calls route through `aiModelRouter` which already implements provider fallback
- Agent-level retry with exponential back-off (2s, 4s) before escalating to composition failure
- `DesignComposerAgent` emits `design.composition.agent_failed` event — admin can monitor and manually requeue
- Consider composition as an `ai_jobs` task (async, resumable) rather than synchronous HTTP response

### A3 — AI JSON Output Malformation
**Description:** LLMs occasionally produce malformed JSON, truncated output, or schema-violating responses, especially for complex nested structures.  
**Likelihood:** Medium | **Impact:** Medium | **Level:** 🟡 Medium  
**Mitigation:**
- All agent output schemas are validated with `zod` before consumption
- On parse failure → retry once with "correct your JSON format" prompt appended
- On second failure → use a minimal safe default output (e.g., empty selection with warning)
- Use models that support JSON mode (OpenAI `response_format: json_object`, Anthropic structured output)

### A4 — Vision Model Availability for QA Reviewer
**Description:** QA Reviewer Agent requires a vision-capable model. Not all configured providers may have vision capability enabled.  
**Likelihood:** Low | **Impact:** Medium | **Level:** 🟢 Low  
**Mitigation:**
- `aiModelRouter` must be queried for `TaskType: 'vision'` before invoking QA Reviewer
- If no vision model available → QA gate is bypassed, score is recorded as `null`, warning logged
- QA score threshold is configurable (default 70); admin can set to 0 to disable the gate

### A5 — Prompt Injection via Customer Brief
**Description:** Customer-supplied brief text is used in AI prompts. A malicious customer could attempt prompt injection to override agent behavior.  
**Likelihood:** Low | **Impact:** High | **Level:** 🟡 Medium  
**Mitigation:**
- Customer brief is always injected as a clearly-delimited user message, never as a system prompt
- Brief length is capped at 2,000 characters (validated server-side before storage)
- Output is validated against the agent output schema — injected instructions cannot change the output shape
- Log all agent inputs in `design_agent_logs` for audit review

---

## 3. Performance Risks

### P1 — Render Latency Exceeding SLA
**Description:** The 90-second p95 preview render SLA depends on the external rendering provider. Peak load or complex scenes may exceed this.  
**Likelihood:** Medium | **Impact:** High | **Level:** 🟠 High  
**Mitigation:**
- Implement per-tenant render queue depth monitoring (see G1 API endpoint)
- Add configurable max concurrent renders per tenant
- For preview renders: use lower resolution (512×512) and fewer diffusion steps
- Surface estimated render time to customer UI so expectations are set
- Alert on p95 render latency > 120s (early warning before SLA breach)

### P2 — Design Composition Latency
**Description:** 5–7 sequential AI calls for full composition could take 20–30 seconds. Customers expect near-real-time feedback.  
**Likelihood:** High | **Impact:** Medium | **Level:** 🟠 High  
**Mitigation:**
- Run composition as an async `ai_jobs` task; return `202 Accepted` immediately
- Stream composition progress via SSE (using existing Phase 5 SSE infrastructure from `phase-v40d-sse-runtime-stream` memory)
- Parallelise independent agents where possible: Material Advisor and Lighting Consultant can run concurrently after Interior Designer
- Display a live progress indicator in customer UI

### P3 — Large Session JSONB Storage
**Description:** `design_revisions.room_snapshot` stores a full room state as JSONB. A complex room with 50 furniture items and 100+ revisions could produce large row sizes.  
**Likelihood:** Low | **Impact:** Medium | **Level:** 🟢 Low  
**Mitigation:**
- Compress JSONB at application layer before storage (gzip + base64) for snapshots > 50KB
- Implement revision pruning policy: keep last 20 revisions + all named versions; archive older revisions to object storage
- Add a `pg_column_size` monitoring query to alert on oversized revision rows

### P4 — Full-Text Search Performance on Large Furniture Catalog
**Description:** The `tsvector` full-text index on `furniture_items` may degrade as the catalog grows beyond 10k items.  
**Likelihood:** Low | **Impact:** Low | **Level:** 🟢 Low  
**Mitigation:**
- Use PostgreSQL `GIN` index on `search_vector` (already specified in database blueprint)
- Consider `pg_trgm` trigram index for partial-word matching
- Add `LIMIT` and pagination to all search queries

---

## 4. Scalability Risks

### S1 — AI Job Queue Saturation
**Description:** Multiple concurrent design sessions each submit 5–7 AI jobs. Under load, the `ai_jobs` queue could saturate the 3 existing dispatcher workers.  
**Likelihood:** Medium | **Impact:** High | **Level:** 🟠 High  
**Mitigation:**
- Add a new `design_worker` type to the dispatcher (4th worker) dedicated to design composition jobs
- Implement per-tenant job priority to prevent one tenant from starving others
- Design composition jobs use a separate `job_type` so they don't compete with rendering jobs for workers
- Monitor queue depth via existing `/api/ai/metrics` endpoint

### S2 — Database Connection Pool Exhaustion
**Description:** Complex room queries with multiple JOINs (session + room + placements + variants) could hold connections longer, exhausting the Supabase connection pool under load.  
**Likelihood:** Low | **Impact:** High | **Level:** 🟡 Medium  
**Mitigation:**
- Use the existing connection pool from Phase 5 (`lib/db`) — do not create a separate pool for Phase 6
- Keep JOIN depth ≤ 3 in a single query; use separate queries with application-level aggregation for deeper joins
- Add `statement_timeout = 5000` (5 seconds) to all Phase 6 queries

### S3 — Export Package Storage Growth
**Description:** Each exported session produces a ZIP file stored in Supabase Storage. Without a retention policy, storage costs grow unboundedly.  
**Likelihood:** High | **Impact:** Low | **Level:** 🟢 Low  
**Mitigation:**
- Set `export_packages.expires_at = created_at + 7 days`
- Add a scheduled job (using existing `aiSchedulerService`) to delete expired packages from Supabase Storage and mark records as `expired`
- Inform customers of the 7-day download window in the UI

---

## 5. Security Risks

### SE1 — Tenant Data Leakage in Design Sessions
**Description:** Without RLS, a workspace token from one tenant could access design sessions from another tenant.  
**Likelihood:** Low | **Impact:** Critical | **Level:** 🔴 Critical  
**Mitigation:**
- RLS policies on `design_sessions` enforce `tenant_id = current_setting('app.current_tenant_id')` (see database blueprint §6)
- Server-side tenant resolution uses `security/tenantResolution.ts` (existing Phase 5 pattern — `wp00-wp01-tenant-security` memory)
- Never trust client-supplied `tenantId`; always resolve from workspace token
- RLS policies added in `rls-v14.sql` before WP-12 go-live

### SE2 — Signed Export Download URL Leakage
**Description:** Export package signed URLs grant access to sensitive design documents without re-authentication.  
**Likelihood:** Low | **Impact:** Medium | **Level:** 🟢 Low  
**Mitigation:**
- Use the existing Supabase Storage signed URL pattern from Phase 5 (`cp-real-file-upload` memory) — URLs are short-lived (max 7 days)
- Store `storage_object_key` in the database; only serve signed URL at download request time (not stored permanently)
- Log all signed URL generation events in the audit log

### SE3 — SSRF via 3D Model URLs
**Description:** Admin-supplied 3D model URLs for furniture items could be used to probe internal services.  
**Likelihood:** Low | **Impact:** High | **Level:** 🟡 Medium  
**Mitigation:**
- Apply the existing SSRF guard (`p0-sprint-complete` memory) to all admin-supplied URLs including `furniture_items.model_url` and `decoration_items.thumbnail_url`
- Whitelist allowed URL domains (CDN/storage domains only)
- Reject private IP ranges, localhost, and non-HTTPS URLs

### SE4 — AI Agent Logs Containing PII
**Description:** `design_agent_logs.output_json` may contain customer brief text including personally identifiable information.  
**Likelihood:** Medium | **Impact:** Medium | **Level:** 🟡 Medium  
**Mitigation:**
- Before storing agent output, run a redaction pass to remove fields that may contain PII (`brief.description`, `brief.constraints`)
- Apply a retention policy: purge `design_agent_logs` rows older than 90 days (scheduled job)
- `design_agent_logs` is admin-only — no customer access via any API endpoint

---

## 6. Rendering Risks

### R1 — Rendering Provider Image Quality Inconsistency
**Description:** Different rendering providers (Replicate, OpenAI DALL-E, custom) produce images with different quality levels, styles, and adherence to room descriptions.  
**Likelihood:** High | **Impact:** Medium | **Level:** 🟠 High  
**Mitigation:**
- Abstract rendering provider selection through `aiModelRouter` (existing pattern)
- Define a canonical render prompt format that works across providers (tested in WP-09)
- QA Reviewer Agent scores renders regardless of provider — poor-scoring renders are flagged
- Allow admin to configure preferred render provider per quality level (preview vs. final)

### R2 — 3D Room Scene to 2D Image Rendering Fidelity
**Description:** Translating a structured room state (furniture positions, materials, lighting) into a text prompt for image generation may not produce spatially accurate results.  
**Likelihood:** High | **Impact:** Medium | **Level:** 🟠 High  
**Mitigation:**
- Accept that Phase 6 render output is impressionistic (style-correct, not geometrically accurate) — document this clearly to customers
- Future phase can integrate dedicated 3D render engines (Blender, Unreal) for photorealistic accuracy
- Render prompt includes room dimensions, furniture count, and dominant materials — not exact positions
- Provide multiple camera angles to compensate for spatial inaccuracy

### R3 — Render Cost Overrun
**Description:** Each design session may require multiple preview renders and a final render. AI image generation costs can be significant at scale.  
**Likelihood:** Medium | **Impact:** Medium | **Level:** 🟡 Medium  
**Mitigation:**
- Use low-resolution (512×512, 20 diffusion steps) for previews; high-resolution (1024×1024, 50 steps) only for final
- Implement per-session and per-tenant render budgets (configurable by admin)
- Record render cost in `creative_ai_assets` cost attribution fields (existing Phase 5 pattern)
- Alert admin when tenant render spend exceeds configurable threshold

---

## 7. Data Risks

### D1 — Room Snapshot JSONB Schema Drift
**Description:** `design_revisions.room_snapshot` stores a JSONB snapshot. If the `RoomSnapshot` TypeScript interface changes, old snapshots may not deserialize correctly.  
**Likelihood:** Medium | **Impact:** Medium | **Level:** 🟡 Medium  
**Mitigation:**
- Include `snapshotVersion` field in every `RoomSnapshot` value object
- Write a versioned deserializer that handles known past versions (migration function per version bump)
- Never change the shape of a snapshot version; create a new version instead

### D2 — Seed Data Quality
**Description:** Phase 6 seed data (room styles, furniture categories, constraint sets) drives AI recommendation quality. Poor seed data leads to poor recommendations.  
**Likelihood:** Medium | **Impact:** High | **Level:** 🟠 High  
**Mitigation:**
- Dedicate design review time to seed data before WP-01 goes to production
- Seed data is idempotent and version-controlled — updates can be deployed as a `POST /api/ai/seed/room-design` call (following Phase 5 pattern)
- Measure recommendation acceptance KPI from Day 1; iterate seed data based on acceptance data

### D3 — Material Catalog Gaps
**Description:** The Phase 5 material catalog may lack sufficient style/surface metadata for Phase 6 recommendation filtering.  
**Likelihood:** High | **Impact:** Medium | **Level:** 🟠 High  
**Mitigation:**
- In WP-05, audit the existing material catalog against Phase 6 style/surface requirements
- Enrich `materials.technicalData` JSONB with `styleIds` and `surfaceCompatibility` arrays (additive, no schema change to Phase 5 tables)
- Provide a bulk-update admin endpoint for material metadata enrichment

---

## 8. Operational Risks

### O1 — Phase 6 Deployment Scope
**Description:** 21 new tables, 12 work packages, and new AI agents represent a large deployment surface. A failed production migration could corrupt the live database.  
**Likelihood:** Low | **Impact:** Critical | **Level:** 🔴 Critical  
**Mitigation:**
- All Phase 6 migrations are hand-written DDL (not drizzle-kit push) — established rule from `drizzle-push-false-positive` memory
- Dry-run each migration with `migrate:prod:dry-run` script before applying
- Apply migrations in the documented order (database blueprint §8)
- Maintain a rollback script for each migration (additive tables: `DROP TABLE IF EXISTS`)
- Deploy WP-01 and WP-02 independently to staging before each subsequent WP

### O2 — Phase 6 Agent Log Volume
**Description:** `design_agent_logs` records every AI invocation. At scale (1000 sessions/day × 7 agent calls each), the table grows at 7000 rows/day.  
**Likelihood:** High | **Impact:** Low | **Level:** 🟢 Low  
**Mitigation:**
- Implement a 90-day retention policy enforced by a daily scheduled job
- Add a `created_at` index on `design_agent_logs` to support efficient range deletes
- Archive deleted rows to Supabase Storage as JSONL before deletion (if audit trail required)

### O3 — Export Package Expiry Not Communicated
**Description:** Customers who export a package and return after 7 days will find the download link expired. Without clear communication, this creates support load.  
**Likelihood:** Medium | **Impact:** Low | **Level:** 🟢 Low  
**Mitigation:**
- Display expiry date prominently in the export download panel
- Send an email notification 24 hours before expiry (using existing SMTP email service)
- Allow customers to re-request export for sessions in `exported` status at no additional cost

---

## Risk Register Summary

| ID | Category | Risk | Level |
|---|---|---|---|
| T1 | Technical | Spatial collision detection complexity | 🔴 Critical |
| SE1 | Security | Tenant data leakage in design sessions | 🔴 Critical |
| O1 | Operational | Phase 6 deployment scope | 🔴 Critical |
| T2 | Technical | Session state machine complexity | 🟠 High |
| T3 | Technical | Orval codegen naming collisions | 🟠 High |
| A1 | AI | AI output non-determinism | 🟠 High |
| A2 | AI | AI provider rate limits and outages | 🟠 High |
| P1 | Performance | Render latency exceeding SLA | 🟠 High |
| P2 | Performance | Design composition latency | 🟠 High |
| S1 | Scalability | AI job queue saturation | 🟠 High |
| D2 | Data | Seed data quality | 🟠 High |
| D3 | Data | Material catalog gaps | 🟠 High |
| R1 | Rendering | Provider image quality inconsistency | 🟠 High |
| R2 | Rendering | Room scene to image fidelity | 🟠 High |
| T4 | Technical | TypeScript build order | 🟡 Medium |
| T5 | Technical | Circular imports between domains | 🟡 Medium |
| A3 | AI | AI JSON output malformation | 🟡 Medium |
| A5 | AI | Prompt injection via customer brief | 🟡 Medium |
| P3 | Performance | Large session JSONB storage | 🟢 Low |
| P4 | Performance | Full-text search performance | 🟢 Low |
| S2 | Scalability | DB connection pool exhaustion | 🟡 Medium |
| S3 | Scalability | Export storage growth | 🟢 Low |
| SE2 | Security | Signed URL leakage | 🟢 Low |
| SE3 | Security | SSRF via 3D model URLs | 🟡 Medium |
| SE4 | Security | PII in agent logs | 🟡 Medium |
| R3 | Rendering | Render cost overrun | 🟡 Medium |
| D1 | Data | Room snapshot schema drift | 🟡 Medium |
| O2 | Operational | Agent log volume | 🟢 Low |
| O3 | Operational | Export expiry not communicated | 🟢 Low |
