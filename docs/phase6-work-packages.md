# Phase 6 — Work Package Breakdown

**Version:** 1.0.0  
**Baseline:** `material-v5.0.1`  
**Status:** Architecture only — implementation requires explicit approval per WP

---

## Dependency Graph

```
WP-01 (Room Template Library)
  └── WP-02 (Furniture Library)
        └── WP-03 (Decoration Library) ──┐
        └── WP-04 (Lighting Library) ────┤
              └── WP-05 (Material Recommender) ─┐
              └── WP-06 (Furniture Placement Engine) ─┐
                    └── WP-07 (Layout Constraint Engine) ─┐
                                                          ├── WP-08 (Moodboard Generator)
                                                          └── WP-09 (Rendering Pipeline)
                                                                └── WP-10 (Review & Versioning)
                                                                      └── WP-11 (Export Engine)
                                                                            └── WP-12 (QA & Release)
```

All WPs must run sequentially (each has a hard dependency on the prior). WP-03 and WP-04 can run in parallel after WP-02. WP-05 and WP-06 can run in parallel after WP-04.

---

## WP-01 — Room Template Library

### Objectives
Establish the foundational catalog: room types, styles, themes, templates, and layout constraint sets. This WP is the bootstrap for all subsequent work — no other WP can begin without it.

### Deliverables
- [ ] Database migrations: `room_types`, `room_styles`, `room_themes`, `room_templates`, `layout_constraint_sets`
- [ ] Drizzle schema files: `lib/db/src/schema/room-design-catalog.ts`
- [ ] API endpoints: A1–A5 (room templates), B1–B3 (room types, styles, themes) from the API blueprint
- [ ] Seed data: 8 room types, 20 room styles, 15 room themes, 10 starter room templates
- [ ] Admin UI: Template management screens in `artifacts/ai-platform`
- [ ] Customer UI: Template browser in `artifacts/customer-portal`
- [ ] Unit tests: Repository, service, route layers
- [ ] API documentation: OpenAPI spec entries

### Dependencies
- Material Platform `material-v5.0.1` baseline (frozen)
- Existing `adminAuthWithExceptions` middleware
- Existing `ai_platform` schema and Supabase connection

### Estimated Complexity
**Medium-High** — 8 new tables, seed data, admin + customer UI. Well-understood CRUD pattern.

### Risks
- Slug uniqueness enforcement across tenant-scoped and platform templates requires careful index design
- Room template versioning on publish may complicate FK references in sessions if not designed carefully → mitigate by copying template snapshot into session at creation time

### Definition of Done
- All 8 room types seeded and queryable
- At least 5 published room templates browsable in customer portal
- Admin can create, publish, and archive templates without touching the DB directly
- All routes covered by integration tests

---

## WP-02 — Furniture Library

### Objectives
Build the furniture catalog — categories, items, and variants — with full search, filtering, and admin management.

### Deliverables
- [ ] Migrations: `furniture_categories`, `furniture_items`, `furniture_variants`
- [ ] Drizzle schema: `lib/db/src/schema/furniture-catalog.ts`
- [ ] API endpoints: C1–C5 from the API blueprint
- [ ] Full-text search index on `furniture_items.search_vector` (PostgreSQL `tsvector`)
- [ ] Admin UI: Furniture catalog management
- [ ] Customer UI: Furniture browser with category filter, style filter, budget range
- [ ] Seed data: 50 furniture categories, 200 starter furniture items with variants
- [ ] Unit + integration tests

### Dependencies
- WP-01 (room type IDs used in `furniture_categories.room_type_ids`)

### Estimated Complexity
**Medium** — Standard catalog CRUD with a tree-structured category hierarchy and full-text search.

### Risks
- Tree-structured category (self-referential FK) requires recursive CTE for deep queries → use materialized depth column and limit tree to 3 levels
- 3D model URL storage format not yet standardised → define a model reference contract in WP-02, defer actual 3D rendering to future phase

### Definition of Done
- Full-text search returns relevant results within 200ms for a 10k-item catalog
- At least 3 hierarchy levels of categories working
- Variant pricing queryable with currency filtering

---

## WP-03 — Decoration Library

### Objectives
Build the decoration catalog (art, plants, rugs, accessories) and the room decoration assignment system.

### Deliverables
- [ ] Migration: `decoration_items`, `room_decoration_assignments`
- [ ] API endpoints: D1 (list decorations), room assignment endpoints
- [ ] Admin UI: Decoration catalog management
- [ ] Integration with Design Session room state
- [ ] Seed data: ~100 decoration items across all types
- [ ] Tests

### Dependencies
- WP-01 (style and theme IDs)
- WP-02 (session/room tables from WP-02 are not needed — room tables come in WP-06/07)

### Estimated Complexity
**Low** — Simple catalog with style/theme tagging. No spatial constraints.

### Risks
- Minimal technical risk; main risk is content — decoration items need curated thumbnails

### Definition of Done
- Decorations filterable by type, style, and theme
- Admin can add new decoration items with thumbnail upload

---

## WP-04 — Lighting Library

### Objectives
Build the lighting fixture catalog with photometric metadata and the room lighting assignment system.

### Deliverables
- [ ] Migration: `lighting_fixtures`, `room_lighting_assignments`
- [ ] API endpoints: D2 (list fixtures), room assignment endpoints
- [ ] Photometric validation (lumen × area check)
- [ ] Lighting Consultant Agent stub (data layer only; full agent in WP-08)
- [ ] Admin UI: Lighting catalog management
- [ ] Seed data: ~60 fixtures across all types
- [ ] Tests

### Dependencies
- WP-01 (room type compatibility)

### Estimated Complexity
**Low-Medium** — Catalog is straightforward; photometric data requires domain knowledge in seed data.

### Risks
- Color temperature and lumen data accuracy depends on real fixture specs → use approximate ranges for seed data; mark as "nominal" values

### Definition of Done
- Fixtures filterable by type and room type
- Lumen output validation passes for standard room sizes

---

## WP-05 — Material Recommendation Engine

### Objectives
Surface Phase 5 material library entries as contextual recommendations for room surfaces (floor, wall, ceiling, furniture). Wire the Material Advisor Agent data layer.

### Deliverables
- [ ] `MaterialRecommendationService` — filters Phase 5 `materials` by style, surface type, finish
- [ ] API endpoint: G3 (material recommendations)
- [ ] Material Advisor Agent (implementation, not stub)
- [ ] Surface-to-material compatibility matrix (config/seed data)
- [ ] Unit tests + integration tests against Phase 5 material catalog

### Dependencies
- WP-01 (style IDs)
- Phase 5 `materials` and `material_categories` (read-only; no schema changes)
- Phase 5 `materialAssignmentService` (reuse interface)

### Estimated Complexity
**Medium** — Primarily a filtering/ranking query against existing data. Agent complexity is low (mostly data retrieval + LLM ranking rationale).

### Risks
- Phase 5 material catalog may lack sufficient style/finish metadata for meaningful filtering → mitigate by enriching Phase 5 `materials.technicalData` JSONB with style tags (additive, no schema change)
- Recommendation accuracy measured by KPI; may require iteration post-launch

### Definition of Done
- Recommendations return ≥ 5 materials per surface for any valid style + surface combination
- Material Advisor Agent passes integration test with mocked AI call
- `material_assignment` records created for a test session

---

## WP-06 — Furniture Placement Engine

### Objectives
Implement the spatial placement system — creating, validating, and persisting furniture placements within a room.

### Deliverables
- [ ] Migrations: `design_sessions`, `design_rooms`, `furniture_placements` (core session tables)
- [ ] `FurniturePlacementService` — validates positions, checks clearance rules
- [ ] `FurnitureSelectorAgent` (implementation)
- [ ] `BudgetOptimizerAgent` (implementation)
- [ ] API endpoints: F5–F6 (designer furniture placement), G2 (compose layout)
- [ ] Customer session creation: E1–E4
- [ ] Unit tests: placement validation, conflict detection

### Dependencies
- WP-01 (room types, templates)
- WP-02 (furniture items, variants)
- WP-07 (layout constraint sets — must be seeded before placement validation works; WP-06 and WP-07 develop together)

### Estimated Complexity
**High** — Spatial logic, constraint validation, session state machine, and two AI agents. The most technically complex WP after WP-09.

### Risks
- 2D/3D collision detection in pure SQL/TypeScript is non-trivial → limit to bounding-box AABB checks in Phase 6; full 3D collision deferred to future phase
- Session state machine has 11 states → thorough state transition tests required; use ALLOWED_TRANSITIONS map pattern (established in Phase 5)
- Furniture placement concurrency: designer and AI may attempt simultaneous placements → use optimistic locking (`version` column on `design_rooms`)

### Definition of Done
- Furniture can be placed, validated, and removed in a design session
- Invalid placements (overlap, clearance violation) return descriptive error codes
- AI Furniture Selector produces a complete room layout from a brief in < 20 seconds (p95)

---

## WP-07 — Layout Constraint Engine

### Objectives
Implement the rule-based constraint evaluation system that validates furniture placements against room-type-specific rules.

### Deliverables
- [ ] `LayoutConstraintService` — loads and evaluates `LayoutConstraintRule[]` per room type
- [ ] `RoomPlannerAgent` (implementation)
- [ ] Constraint rule DSL (JSON schema for `layout_constraint_sets.rules`)
- [ ] Rule types: `min_clearance`, `wall_proximity`, `anchor_required`, `rotation_locked`, `zone_exclusion`, `circulation_path`
- [ ] Admin UI: Constraint set editor (JSON editor with schema validation)
- [ ] Seed data: Constraint sets for all 8 room types
- [ ] Unit tests: Rule evaluation for each constraint type

### Dependencies
- WP-01 (room types)
- WP-06 (session/room tables; constraint service is called by placement service)

### Estimated Complexity
**Medium-High** — Rule DSL design and spatial evaluation logic require careful architecture. Constraint rule coverage across 8 room types is a content effort.

### Risks
- Over-constraining rules lead to poor UX (everything flagged as violation) → start with permissive defaults; tighten after user feedback
- Rule conflicts (two rules that contradict) → define rule priority order; last-evaluated rule wins

### Definition of Done
- All 8 room types have at least 5 constraint rules each
- Constraint evaluation runs in < 50ms per placement
- Room Planner Agent produces a spatial zone plan for any valid room input

---

## WP-08 — Moodboard Generator

### Objectives
Implement the AI moodboard generation pipeline — from brief to visual concept board.

### Deliverables
- [ ] `MoodboardService` — orchestrates moodboard creation and storage
- [ ] `InteriorDesignerAgent` (full implementation)
- [ ] `PromptOptimizerAgent` (implementation)
- [ ] `QAReviewerAgent` (implementation, vision-capable model required)
- [ ] `DesignComposerAgent` (partial — moodboard orchestration path)
- [ ] Migration: `design_moodboards`
- [ ] API endpoints: E5 (approve moodboard), G1 (trigger moodboard generation)
- [ ] Customer UI: Moodboard display, approve/reject flow
- [ ] Integration with existing `creative_ai_assets` for storage
- [ ] Tests: Agent mocks, moodboard lifecycle

### Dependencies
- WP-01 (styles, themes)
- WP-05 (material advisor, palette)
- WP-06 (session tables)
- Existing `creative_render_sessions` and `aiExecutionService` (Phase 5)

### Estimated Complexity
**High** — Multi-agent orchestration, vision model integration, and customer-facing UI flow. QA Reviewer requires vision-capable model.

### Risks
- Moodboard visual quality is subjective — QA score may not correlate with customer satisfaction → monitor KPI and adjust scoring rubric post-launch
- Vision model cost per QA call is high → implement QA gate as optional (configurable threshold = 0 disables it)
- Image generation prompt quality varies by model → Prompt Optimizer must be tested across all configured providers

### Definition of Done
- Moodboard generated for any valid brief in < 60 seconds (p95)
- QA Reviewer correctly rejects low-quality moodboards (score < threshold)
- Customer can approve or reject a moodboard and trigger recomposition

---

## WP-09 — Rendering Pipeline

### Objectives
Wire the room design state into the existing `creative_render_sessions` rendering pipeline.

### Deliverables
- [ ] `RenderRequestService` — builds render payloads from room snapshots
- [ ] `RenderingCoordinatorAgent` (implementation)
- [ ] Migration: `design_session_render_jobs`
- [ ] `DesignComposerAgent` (full orchestration — all agents integrated)
- [ ] API endpoints: E6–E7 (request preview, select concept)
- [ ] Customer UI: Render gallery, concept selection
- [ ] Integration tests: Full end-to-end from session creation to render output

### Dependencies
- WP-06 (session + placement tables)
- WP-08 (moodboard + prompt optimizer)
- Existing Phase 5: `creative_render_sessions`, `productionPipelineService`, `ai_jobs`, `creative_ai_assets`

### Estimated Complexity
**High** — Integration complexity with the existing 7-stage render pipeline. Scene description serialization requires domain-specific format decisions.

### Risks
- Render scene description format not standardised — must define a Phase 6 room scene schema that the render pipeline understands → coordinate with rendering provider capability
- Camera angle descriptions may produce inconsistent results across providers → use standardised prompt templates per angle
- Render cost per session is significant → implement per-tenant render budget limits

### Definition of Done
- Preview renders produced for a composed room in < 90 seconds (p95)
- Customer can view and select a render concept
- Render jobs are tracked in `design_session_render_jobs` and linked to Phase 5 `creative_render_sessions`

---

## WP-10 — Review & Versioning

### Objectives
Implement the design revision, version management, and reviewer approval workflow.

### Deliverables
- [ ] `RevisionService` — creates immutable revision snapshots
- [ ] Migrations: `design_revisions`, `design_versions`
- [ ] API endpoints: F3–F4 (approve/reject), F7 (create revision), F8 (name version)
- [ ] Designer UI: Revision timeline, version comparison diff view
- [ ] Admin reviewer UI: Approve/reject workflow
- [ ] RLS migration: `rls-v14.sql` (design session row-level security)
- [ ] `design_agent_logs` migration
- [ ] Tests: State machine transitions, revision immutability, RLS policy

### Dependencies
- WP-06 (session tables)
- WP-08 (moodboard approval flow)
- WP-09 (render selection flows)

### Estimated Complexity
**Medium** — CRUD-heavy with state machine transitions. RLS is well-understood from Phase 5 patterns.

### Risks
- Snapshot size in `design_revisions.room_snapshot` JSONB can be large for complex rooms → add JSONB compression or size limit; consider summarised snapshot for display vs. full snapshot for rollback
- Revision rollback UX: customer expects "undo" — the system provides point-in-time restore, not undo → clearly communicate in UI

### Definition of Done
- Immutable revision created on every design commit
- Reviewer can approve or return session to designer with notes
- RLS prevents customer from reading another customer's session

---

## WP-11 — Export Engine

### Objectives
Implement the export package compilation pipeline — PDF spec, material list, furniture list, moodboard PDF.

### Deliverables
- [ ] `ExportService` — orchestrates export job via `ai_jobs` dispatcher
- [ ] Migration: `export_packages`
- [ ] PDF spec generator (using existing `pdfkit` + external pattern from Phase 5)
- [ ] Material list CSV/PDF generator
- [ ] Furniture list CSV/PDF generator
- [ ] Object Storage upload (using existing Supabase Storage `ai-assets` bucket)
- [ ] Signed download URL generation (using existing pattern from Phase 5)
- [ ] API endpoints: E8–E9 (request export, get status)
- [ ] Customer UI: Export download panel
- [ ] Tests: Export job creation, PDF generation, download URL

### Dependencies
- WP-10 (approved sessions)
- Existing Phase 5: `pdfkit` externals, `supabaseStorage`, signed URL pattern

### Estimated Complexity
**Medium** — Well-understood PDF generation pattern from Phase 5. Main effort is data aggregation and layout design.

### Risks
- PDFKit font embedding — already documented in `pdfkit-esbuild-external` memory entry; must keep pdfkit in esbuild externals
- Export package size for complex rooms with high-res moodboards can exceed 50MB → implement ZIP compression; use streaming upload
- Download URL expiry — set to 7 days; expired packages require re-export request

### Definition of Done
- Export package generated in < 30 seconds for a standard room session
- ZIP download includes all selected formats
- Download URL is signed and expires correctly

---

## WP-12 — QA & Release

### Objectives
End-to-end quality validation, performance benchmarking, security audit, and release gate for Phase 6.

### Deliverables
- [ ] End-to-end test suite: full session lifecycle from brief to export
- [ ] Performance benchmarks: render latency, composition latency, recommendation accuracy
- [ ] Security review: new RLS policies, tenant isolation, signed URLs
- [ ] KPI baseline measurement (see `phase6-design-sprint.md` §6)
- [ ] `CHANGELOG.md` update
- [ ] Updated baseline document: `docs/baselines/room-design-v6.0.0-baseline.md`
- [ ] Release tag: `room-design-v6.0.0`
- [ ] Production migration runbook update

### Dependencies
- All WP-01 through WP-11 complete and deployed to a staging environment

### Estimated Complexity
**Medium** — Testing and documentation effort. No new feature code.

### Risks
- KPI targets may not be met on first release → define minimum viable thresholds (e.g., render latency p95 < 120s for go-live; tighten to 90s post-optimisation)
- Security audit may uncover RLS gaps → mitigate by reviewing `rls-v14.sql` against all 21 new tables before WP-12 begins

### Definition of Done
- All KPI targets met or documented as deferred with a remediation plan
- Zero critical security findings
- Release tag created and pushed
- Production migrations applied and verified

---

## Work Package Summary

| WP | Name | Complexity | Depends On |
|---|---|---|---|
| WP-01 | Room Template Library | Medium-High | Baseline |
| WP-02 | Furniture Library | Medium | WP-01 |
| WP-03 | Decoration Library | Low | WP-01 |
| WP-04 | Lighting Library | Low-Medium | WP-01 |
| WP-05 | Material Recommendation Engine | Medium | WP-01, Phase 5 |
| WP-06 | Furniture Placement Engine | High | WP-01, WP-02, WP-07 |
| WP-07 | Layout Constraint Engine | Medium-High | WP-01, WP-06 |
| WP-08 | Moodboard Generator | High | WP-01, WP-05, WP-06 |
| WP-09 | Rendering Pipeline | High | WP-06, WP-08, Phase 5 |
| WP-10 | Review & Versioning | Medium | WP-06, WP-08, WP-09 |
| WP-11 | Export Engine | Medium | WP-10 |
| WP-12 | QA & Release | Medium | WP-01–WP-11 |
