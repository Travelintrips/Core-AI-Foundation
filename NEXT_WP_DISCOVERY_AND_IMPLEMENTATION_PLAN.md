# Next Work Package Discovery & Implementation Plan
# Phase 6 WP-05 — Material Recommendation Engine

**Status:** OWNER DECISIONS RESOLVED — Ready to implement
**Date:** 2026-08-04
**Baseline SHA (post-merge):** 31879f9e7fa10882152dd4e1263cf29babe41041

---

## 1. Current Verified Main SHA

```
31879f9e7fa10882152dd4e1263cf29babe41041
```

Merge commit from PR #9 (`fix(api-zod): remove duplicated registry content`).
Local SHA = origin/main SHA ✅

---

## 2. Registry Fix — Completed

| Item | Result |
|---|---|
| PR #9 | Merged ✅ |
| Merge method | `--no-ff` merge commit |
| Merge commit SHA | `31879f9e7fa10882152dd4e1263cf29babe41041` |
| Changed files | `lib/api-zod/src/registry.ts` only (24 deletions) |
| Post-merge typecheck | PASS ✅ |
| Post-merge API build | PASS ✅ |
| Post-merge regression | 6103/6103 PASS ✅ (207 test files) |

---

## 3. WP-05 Scope Classification

**Classification: A — Clearly Defined**

Fully documented in `docs/phase6-work-packages.md`. All hard dependencies satisfied:

| Dependency | Status |
|---|---|
| WP-01 Room Template Library | ✅ COMPLETE (`material-v6.0.0-wp01`) |
| Phase 5 `materials` catalog | ✅ STABLE (frozen `material-v5.0.1`) |
| Phase 5 `material_categories` | ✅ STABLE |
| Phase 5 `materialAssignmentService` | ✅ STABLE |

---

## 4. Objective

Surface Phase 5 material library entries as contextual recommendations for room surfaces (floor, wall, ceiling, furniture). Wire the Material Advisor Agent data layer so designers and customers receive ranked material suggestions filtered by room style and surface type.

---

## 5. Owner Decisions — RESOLVED 2026-08-04

| # | Question | Decision |
|---|---|---|
| 1 | **Active track** | **Phase 6 WP-05 — Material Recommendation Engine** |
| 2 | **Style-tag enrichment** | **JSONB enrichment** on `materials.technicalData` — additive, no migration required |
| 3 | **Ranking method** | **Rule-based scoring only** — fast, cheap, predictable for initial WP-05 |
| 4 | Layout Composer WP-04 (6 open questions) | Deferred — see Task #4 in project task list |

---

## 6. In-Scope

- `MaterialRecommendationService` — filters Phase 5 `materials` by style, surface type, finish using rule-based scoring
- Enrich `materials.technicalData` JSONB with style tags (additive write, no DDL change)
- API endpoint G3: `GET /api/ai/material-recommendations`
  - Request: `{ styleId: UUID, surfaceType: string, roomTypeId?: UUID, budget?: number }`
  - Response: array of `MaterialRecommendation` (materialId, name, finish, score, rationale)
- Material Advisor Agent implementation (replaces current stub)
- Surface-to-material compatibility matrix (config/seed data, no new tables)
- Unit tests: service filtering/ranking logic
- Integration tests: against Phase 5 seeded catalog (≥5 results per surface combination)

---

## 7. Out-of-Scope

- New database tables (read-only against existing Phase 5 tables)
- LLM-based ranking (deferred per Decision #3)
- WP-02 Furniture Library (separate WP, parallel-eligible)
- WP-03 Decoration Library / WP-04 Lighting Library
- Phase 6 WP-06 Furniture Placement Engine (depends on WP-02)
- Layout Composer OBB/SAT rotation (Layout Composer WP-04 — awaiting 6 owner answers)
- Admin UI for style-tag management (read/write via seed/script only in this WP)

---

## 8. Risks

| ID | Risk | Mitigation |
|---|---|---|
| R1 | Materials lack style/finish metadata for meaningful filtering | Enrich `technicalData` JSONB with style tags via seed script |
| R2 | Recommendation accuracy below KPI (≥5 per surface) | Define minimum viable threshold; plan iteration post-launch |
| R3 | Orval codegen naming collision on G3 endpoint | Apply `orval-codegen-workaround.md` pattern |

---

## 9. Architecture Notes

- Service location: `artifacts/api-server/src/services/materialRecommendationService.ts`
- Route: `artifacts/api-server/src/routes/material-recommendations.ts` (mounted at `/api/ai/material-recommendations`)
- Agent location: `artifacts/api-server/src/services/design-ai/agents/` (MaterialAdvisorAgent)
- OpenAPI spec entry: `integration/openapi/` (draft, orval regeneration required after)
- **No new DB migrations required** — reads `ai_platform.materials`, `ai_platform.room_styles`, `ai_platform.room_types`

---

## 10. Test Strategy

| Layer | Approach |
|---|---|
| Unit | `MaterialRecommendationService` — mock DB, test filtering by style + surface |
| Unit | Material Advisor Agent — mock AI call (not used this WP), assert recommendation shape |
| Integration | Against Phase 5 seeded catalog; assert ≥5 results for standard surface combinations |
| Regression | Full 6103-test baseline must continue to pass |

---

## 11. Proposed Branch

```
feature/wp05-material-recommendation-engine
```

Base: `main` at SHA `31879f9e` (post-registry-fix merge).

---

## 12. Go / No-Go

**GO** — All conditions met:
- ✅ Registry fix merged and validated
- ✅ All hard dependencies satisfied
- ✅ All three owner decisions resolved
- ✅ Implementation scope clearly defined
