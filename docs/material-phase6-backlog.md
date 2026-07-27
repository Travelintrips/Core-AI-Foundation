# Material Phase 6 — Engineering Backlog
## Room Design Template Library & AI Composition Layer

**Prepared:** 2026-07-27
**Prepared from:** Phase 5.2 retrospective findings
**Status:** BACKLOG ONLY — awaiting explicit Phase 6 approval

> ⚠️ Do NOT begin implementation until Phase 6 is formally approved.
> This document is planning material only.

---

## Must Have

### M1 — Room Design Template Library
**Priority:** Critical
**Description:** A registry of reusable room design templates (style, mood, material palette, spatial configuration) that can be instantiated per project. Templates are authored by admins and selected by customers in the brief wizard.
**Dependencies:** `material_categories` hierarchy finalized; `materials` table stable (Phase 5 ✅); material assignment service patterns proven
**Estimated complexity:** Large (new tables: `room_templates`, `template_material_slots`; new routes; admin UI for template authoring; customer-facing template picker)
**Technical notes:**
- Reuse `materialAssignmentService.ts` patterns for slot-to-material binding
- Store template as JSONB with versioning column (same pattern as `id_concept_drafts`)
- Keep templates in `ai_platform` schema, not `public`

---

### M2 — Production Deployment Registration
**Priority:** Critical (blocker for all Phase 6 AI features)
**Description:** Register an active Replit deployment and complete a full privileged production smoke test (login, catalog, brief, quotation, payment, AI generation, artifact, ZIP, download, completion). This was the outstanding blocker from the Phase 5 final release report.
**Dependencies:** None — can begin immediately
**Estimated complexity:** Small (operational, not engineering)
**Technical notes:**
- Follow `RELEASE_CANDIDATE_REPORT_V1.md` smoke test checklist
- Document in `docs/production-smoke-test-phase6.md` when complete

---

### M3 — Furniture Library
**Priority:** High
**Description:** A catalogued registry of furniture items (piece name, style, dimensions, brand, price tier, local availability, image) that can be assigned to room templates and project concepts. Mirrors the material library structure.
**Dependencies:** M1 (Room Design Template Library) for template-furniture binding; `materials` table patterns reusable
**Estimated complexity:** Medium (new tables: `furniture_items`, `furniture_assignments`; routes follow existing material library pattern)
**Technical notes:**
- Reuse `materialLibraryService.ts` as the structural template
- Import pipeline (Phase 5 `materialImportService.ts`) can be extended for furniture bulk import
- Ensure `furnitureDraft` in `id_concept_drafts` is the source of truth during AI generation

---

### M4 — PluginManifest Fragmentation Resolution
**Priority:** High (tech debt from Release Candidate report — blocks system maintainability)
**Description:** The PluginManifest is fragmented across multiple team contributions. Consolidate into a single canonical registry with version control, preventing divergence during future multi-team merges.
**Dependencies:** None
**Estimated complexity:** Medium
**Technical notes:**
- Audit all `plugin*` files and registries across `artifacts/api-server/src/`
- Produce a single `pluginRegistry.ts` source of truth
- Add a CI check asserting manifest integrity

---

### M5 — CI: i18n Duplicate Key Lint Check
**Priority:** High (preventive — caused post-release fix in Phase 5)
**Description:** Add an automated lint step to CI that fails the build if any i18n translation file contains duplicate keys. Prevents the regression that required `66d0f2a` post-release.
**Dependencies:** None
**Estimated complexity:** Small
**Technical notes:**
- Use `i18next-parser` or a custom Node.js script to parse all `*.json` i18n files
- Fail CI with clear output listing the duplicate keys and files
- Add to `pnpm run verify` or a dedicated `pnpm run lint:i18n` script

---

### M6 — CI: Router Prefix Integration Test
**Priority:** High (preventive — caused post-release fix in Phase 5)
**Description:** Add an integration test that asserts each registered Express router is mounted at its correct path prefix. Prevents the `materialImportRouter` global scope regression.
**Dependencies:** None
**Estimated complexity:** Small
**Technical notes:**
- Use Express `app._router.stack` inspection or a route listing endpoint (`GET /api/routes` in dev mode)
- Assert: `materialImportRouter` → `/ai/material-import`, no router mounted at `/` without explicit intent

---

## Should Have

### S1 — Material Recommendation Engine (Enable Feature Flag)
**Priority:** Medium-High
**Description:** The material recommendation engine (Phase 2/3 intelligence layer) is already implemented and validated but gated behind a feature flag that defaults to `false`. Enable it in production and monitor usage.
**Dependencies:** M2 (active production deployment) for safe enablement
**Estimated complexity:** Small (configuration change + monitoring setup)
**Technical notes:**
- Set `DESIGN_AI_MULTI_AGENT_ENABLED=true` in production Replit Secrets (already `true` in dev)
- Monitor `/material-library/suggestions` endpoint latency and error rate for 48h after enablement
- Document in `docs/material-recommendation-engine-runbook.md`

---

### S2 — AI Design Composer (Foundation)
**Priority:** Medium
**Description:** An AI agent that composes a complete room design (template + materials + furniture + lighting) from a customer brief in a single pipeline step, replacing the current sequential 5-step manual review flow for eligible request types.
**Dependencies:** M1 (Room Template Library), M3 (Furniture Library), M2 (production deployment verified)
**Estimated complexity:** Large
**Technical notes:**
- Extend `productionPipelineService.ts` with a `compose_design` stage type
- Compose output must remain editable by admin (same `draft` pattern as `id_concept_drafts`)
- Use existing `intelligentRouter` to select provider based on cost/capability

---

### S3 — Production Migration Verification Documentation
**Priority:** Medium
**Description:** Document the exact DDL steps required to bring a fresh production database to Phase 5 schema parity. Currently relies on institutional knowledge; needs a repeatable written procedure.
**Dependencies:** None
**Estimated complexity:** Small
**Technical notes:**
- List all migration files in order: `20260725_material_library.sql`, `20260726_material_import_phase5.sql`, plus all prior migrations
- Include rollback DDL for each migration
- Add to `docs/production-migration-runbook.md`

---

### S4 — Admin: Bulk Material Review Pagination
**Priority:** Medium
**Description:** The import review queue currently loads all staged items. Under high import volume this will be slow. Add server-side pagination and filtering to the admin review UI.
**Dependencies:** None (self-contained improvement to Phase 5 feature)
**Estimated complexity:** Small-Medium
**Technical notes:**
- Add `limit`/`offset` query params to `GET /ai/material-import/staged`
- Update admin review UI to use paginated fetch with infinite scroll or page controls

---

### S5 — CHANGELOG File
**Priority:** Medium
**Description:** Create and maintain a `CHANGELOG.md` in the repository root documenting every release. Phase 5 was released without this file, making version history opaque.
**Dependencies:** None
**Estimated complexity:** Small (one-time creation + process discipline)
**Technical notes:**
- Follow Keep a Changelog format (https://keepachangelog.com)
- Back-fill entries for Phase 5 and prior phases from existing release reports
- Add CHANGELOG update to the release checklist

---

## Could Have

### C1 — Multi-Room Composition
**Priority:** Low-Medium
**Description:** Extend the AI Design Composer to compose coordinated designs across multiple rooms in a single project (e.g. living room + dining room + master bedroom sharing a coherent material palette).
**Dependencies:** S2 (AI Design Composer foundation)
**Estimated complexity:** Large
**Technical notes:**
- Introduce `room_composition_session` table linking multiple concept drafts
- Palette coherence must be enforced at the composition layer, not per-room

---

### C2 — Room Rendering Pipeline
**Priority:** Low-Medium
**Description:** Generate photorealistic room renders from a composed design (template + materials + furniture). Extends the existing image generation pipeline with room-specific prompting and reference image injection.
**Dependencies:** S2 (AI Design Composer), M1 (Room Template Library), existing image batch engine (`image-batch.ts`)
**Estimated complexity:** Large
**Technical notes:**
- Reuse `creative_render_sessions` and `render_stage` pattern from Phase 5 image pipeline
- Room renders require significantly more tokens/cost — add to cost tracking (`ai_cost_records`)

---

### C3 — Material Import: OCR Confidence Threshold UI
**Priority:** Low
**Description:** Currently, all OCR-extracted materials enter the review queue regardless of confidence score. Allow admins to set a confidence threshold above which materials are auto-approved, reducing manual review volume.
**Dependencies:** None (enhancement to Phase 5 import pipeline)
**Estimated complexity:** Small-Medium

---

### C4 — Analytics Dashboard for Material Usage
**Priority:** Low
**Description:** A dedicated admin dashboard page showing: most-used materials per category, materials never assigned to a project, top brands, average price tier per project type.
**Dependencies:** None — analytics endpoint already documented in Phase 5
**Estimated complexity:** Medium (frontend only; backend analytics endpoint exists)

---

## Future

### F1 — Customer-Facing Material Explorer
**Priority:** Future
**Description:** Allow customers to browse the material catalog during the brief step, selecting preferred materials/finishes before AI generation. Currently materials are chosen entirely by AI.
**Dependencies:** All Must Have items complete; customer portal UX design review needed
**Estimated complexity:** Large

---

### F2 — Supplier Integration
**Priority:** Future
**Description:** Connect material records to supplier APIs (e.g. direct links to Vivere, IKEA Indonesia, Kayu Lapis Indonesia) for real-time stock and pricing. Phase 5 materials currently store `local_alternative` as a free-text field.
**Dependencies:** F1 (customer explorer for the demand side)
**Estimated complexity:** Large

---

### F3 — AR Preview
**Priority:** Future
**Description:** Allow customers to preview a rendered material/furniture combination in augmented reality via the mobile app.
**Dependencies:** F1, C2 (Room Rendering Pipeline), mobile app re-activation
**Estimated complexity:** Very Large

---

## Engineering Standards — Phase 6 Checklist

The following checklist must be applied to every Phase 6 implementation task. Updated from Phase 5 lessons.

### Branch Strategy
- [ ] Feature branch named `phase6/<feature-slug>`
- [ ] Branch created from current `main` (not from another feature branch)
- [ ] Branch pushed to remote before work begins (team visibility)
- [ ] Branch readiness confirmed 48h before scheduled merge review

### Merge Strategy
- [ ] Shared-file changes (routes/index, schema, seed) reviewed by file owner before merge
- [ ] Post-merge reconciliation script (`scripts/post-merge.sh`) run and output verified
- [ ] No merge performed if CI is red

### Code Review Checklist
- [ ] Every new Express router is mounted with an explicit path prefix (never bare `app.use(router)`)
- [ ] Every new route declares its auth requirement explicitly (public / admin-key / session)
- [ ] No `zod/v4` imported directly in `api-server` — use `@workspace/api-zod` schemas only
- [ ] No hardcoded ports — all services read `PORT` from environment
- [ ] All new DB queries use `ai_platform` schema search path
- [ ] `parseInt(agentId, 10)` used when converting string agentId to DB column number

### Migration Checklist
- [ ] New tables use hand-written DDL (never `drizzle-kit push` in production)
- [ ] Migration file named `YYYYMMDD_<feature>.sql` and placed in `artifacts/api-server/src/migrations/`
- [ ] Rollback DDL documented in same file (in a comment block)
- [ ] Migration applied to dev database and verified before PR merge
- [ ] Migration added to `docs/production-migration-runbook.md`

### Security Checklist
- [ ] No secrets in `.replit`, `package.json`, or source files — use Replit Secrets
- [ ] SSRF guard applied to any endpoint accepting user-supplied URLs
- [ ] Rate limiting applied to new public-facing endpoints
- [ ] Helmet + CORS config not modified without security review
- [ ] New webhook/notification URLs validated against allowlist

### Testing Checklist
- [ ] Unit tests for new service functions
- [ ] Integration test asserting new router is mounted at correct path prefix
- [ ] Auth tests asserting unauthenticated requests return 401 (not 200 or 500)
- [ ] i18n files checked for duplicate keys before commit
- [ ] `pnpm run verify` passes locally before pushing

### Release Checklist
- [ ] CHANGELOG.md updated with release entry
- [ ] Release tag applied to exact release commit
- [ ] Active Replit deployment registered and confirmed before release report issued
- [ ] Privileged production smoke test completed (login → brief → quotation → payment → generation → artifact → download)
- [ ] `/api/healthz/full` returns HTTP 200 in production
- [ ] Working tree clean at release time (no untracked release documents)
- [ ] All UAT-blocking defects resolved before GO LIVE decision
