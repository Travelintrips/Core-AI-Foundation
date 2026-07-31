# WP-04 Discovery & Implementation Plan
# Layout Composer — Rotation-Aware OBB/SAT Collision

**Status:** DRAFT — Discovery only. Do not implement.
**Date:** 2026-07-31
**Baseline SHA:** `7f4e3b4adbce27c2d62006efa91c30aaa3e93fa3`
**Regression baseline:** 6056/6056 tests PASS, 206 test files

---

## 1. Baseline SHA

```
7f4e3b4adbce27c2d62006efa91c30aaa3e93fa3
```

Verified: branch = main, working tree clean, local SHA = origin/main.

---

## 2. Sources Inspected

| File | Purpose |
|---|---|
| `integration/manifests/team-12.json` | Authoritative manifest — knownLimitations.rotation |
| `integration/openapi/team-12.yaml` | Authoritative API contract |
| `artifacts/api-server/src/services/collision-engine/obb.ts` | WP-03B OBB implementation |
| `artifacts/api-server/src/services/collision-engine/sat.ts` | WP-03B SAT implementation |
| `artifacts/api-server/src/services/collision-engine/aabb.ts` | WP-03B AABB implementation |
| `artifacts/api-server/src/services/collision-engine/collisionEngine.ts` | WP-03B engine (AABB→OBB→SAT pipeline) |
| `artifacts/api-server/src/services/collision-engine/types.ts` | Canonical types (OBB, AABB, SAT, PlacementGeometry) |
| `artifacts/api-server/src/services/layout-composer/collisionAdapter.ts` | WP-03C adapter (current gap: rotation=0) |
| `artifacts/api-server/src/services/layout-composer/collisionDetection.ts` | WP-03C detection (AABB only, explicit TODO) |
| `artifacts/api-server/src/services/layout-composer/constraintSolver.ts` | Calls findAllCollisions + resolveCollision |
| `artifacts/api-server/src/types/layout-composer/index.ts` | LayoutElement type (rotation?: number) |
| `artifacts/api-server/src/__tests__/collision-engine-geometry.test.ts` | WP-03B OBB/SAT tests (PASS) |
| `artifacts/api-server/src/services/layout-composer/__tests__/composer.test.ts` | WP-03C layout tests |
| `docs/phase6-work-packages.md` | Phase 6 WP-04 (Lighting Library — different namespace) |
| `docs/specifications/p0-work-package-plan.md` | P0 WP-04 (Tenant Hardening — different namespace) |
| `docs/implementation/wp04-wp05-soft-delete-report.md` | Soft-delete WP-04 (already implemented — different namespace) |

---

## 3. Authoritative WP-04 References

### ⚠️ CRITICAL: Namespace Disambiguation

Three distinct "WP-04" namespaces exist in this repository. Only one is relevant to this discovery.

| Namespace | Location | Status | Relevant? |
|---|---|---|---|
| **Layout Composer WP-04** — OBB/SAT rotation-aware push | `integration/manifests/team-12.json`, `collisionDetection.ts` | Not started | **YES — this task** |
| Phase 6 WP-04 — Lighting Library | `docs/phase6-work-packages.md` §WP-04 | Not started | No |
| P0 Track WP-04 — Tenant Hardening | `docs/specifications/p0-work-package-plan.md` §WP-04 | Partially done (soft-delete) | No |

---

### Layout Composer WP-04 — Authoritative References

#### Reference 1 — team-12.json `knownLimitations.rotation`
- **File:** `integration/manifests/team-12.json` (lines `"knownLimitations"` block)
- **Classification:** **Authoritative** — this is the team manifest
- **Exact text:**
  ```json
  "rotation": {
    "status": "axis-aligned-push-only",
    "description": "...",
    "scheduledFor": "WP-04 or later"
  }
  ```
- **Stated requirement:** rotation-aware push resolution deferred to WP-04 or later.

#### Reference 2 — collisionDetection.ts TODO comment
- **File:** `artifacts/api-server/src/services/layout-composer/collisionDetection.ts` line 19
- **Classification:** **Authoritative** — in-source planned fix statement
- **Exact text:**
  > "WP-03B's SAT engine will be added in a future work package. WP-03B already provides `generateOBB` + `satTest` for this."
- **Stated requirement:** swap AABB-only detection for full OBB+SAT using the already-built WP-03B engine.

#### Reference 3 — team-12.yaml description
- **File:** `integration/openapi/team-12.yaml` lines 184–193
- **Classification:** **Authoritative** — public API contract
- **Exact text:**
  > "Full rotation-aware push resolution is planned for a future WP. See knownLimitations.rotation in integration/manifests/team-12.json."

---

## 4. Scope Classification

**B. PARTIALLY DEFINED**

The requirement is stated and the path is clear (use WP-03B's existing OBB+SAT), but exact acceptance criteria for push-vector direction, determinism guarantees, performance budget, and sub-package boundaries are not written down and must be confirmed by the owner before implementation.

---

## 5. Proposed Objective

Replace axis-aligned bounding box (AABB) collision detection and axis-aligned push resolution in the layout-composer with full oriented bounding box (OBB) + Separating Axis Theorem (SAT) detection and rotation-aware push vectors, using WP-03B's already-implemented canonical engine (`generateOBB`, `satTest`).

**Expected user-visible result:** Two rotated layout elements no longer report false collisions (or miss real collisions) due to their rotation. Push vectors are perpendicular to the rotated face, not axis-locked.

---

## 6. In Scope

1. Replace `collisionAdapter.ts` — `rectToWP03BAABB` + `rectsOverlapViaWP03B` → OBB/SAT equivalents using `PlacementGeometry` or an extended `Rect` that carries rotation.
2. Replace `collisionDetection.ts` — `elementRect` + `rectsOverlap` + `overlapExtent` → OBB-aware detection and rotation-aware push vectors.
3. Update `constraintSolver.ts` callers (`findAllCollisions`, `resolveCollision`) if the function signatures change.
4. Update `integration/manifests/team-12.json` — change `knownLimitations.rotation.status` from `"axis-aligned-push-only"` to `"obb-sat"` and remove the `scheduledFor` field.
5. Update `integration/openapi/team-12.yaml` — remove the limitation callout and document the new OBB/SAT semantics.
6. Add new tests covering rotation-aware collision and push resolution.

---

## 7. Out of Scope

- WP-03B source modifications (`obb.ts`, `sat.ts`, `aabb.ts`, `collisionEngine.ts`) — these are already complete and correct.
- Phase 6 WP-04 (Lighting Library) — entirely separate domain.
- P0 WP-04 (Tenant Hardening) — entirely separate track.
- Persistence (`ai_layout_plans` table) — already marked optional and additive in team-12.json.
- `includeResponsive` variant solver changes — rotation handling is orthogonal.
- `clearance.ts` / `roomBounds.ts` — not relevant to layout-composer.

---

## 8. Current Architecture Map

### WP-03A — Layout Composer (Team 12)
| Component | File | Exports |
|---|---|---|
| Constraint solver | `layout-composer/constraintSolver.ts` | `solvePlan()` |
| Collision detection | `layout-composer/collisionDetection.ts` | `findAllCollisions`, `resolveCollision`, `elementRect`, `overlapExtent` |
| Collision adapter | `layout-composer/collisionAdapter.ts` | `rectsOverlapViaWP03B`, `rectToWP03BAABB` |
| Layout operations | `layout-composer/layoutOperations.ts` | `alignElements`, `applyOperation`, etc. |
| Types | `types/layout-composer/index.ts` | `LayoutElement` (rotation?: number), `Rect`, `CollisionPair` |
| Constants | `layout-composer/constants.ts` | `LAYOUT_LIMITS` (MAX_ITERATIONS=100, SOLVER_DEADLINE_MS=5000) |
| Routes | `routes/layout-composer/index.ts` | POST /ai/layout-composer/solve, /validate, /plan; GET /operations |
| OpenAPI | `integration/openapi/team-12.yaml` | |
| Manifest | `integration/manifests/team-12.json` | |

### WP-03B — Collision Engine (canonical, do not modify)
| Component | File | Exports |
|---|---|---|
| AABB | `collision-engine/aabb.ts` | `generateAABB(x,y,w,d,rot)`, `aabbOverlap` |
| OBB | `collision-engine/obb.ts` | `generateOBB(PlacementGeometry)`, `generateClearanceOBB` |
| SAT | `collision-engine/sat.ts` | `satTest(obbA, obbB): SatResult` |
| Engine | `collision-engine/collisionEngine.ts` | `checkPair`, `checkSessionCollisions`, `checkSinglePlacement` |
| Types | `collision-engine/types.ts` | `AABB`, `OBB`, `SatResult`, `PlacementGeometry`, `COLLISION_EPSILON` |

### WP-03C — Collision Adapter (merged in PR #5)
- `collisionAdapter.ts` delegates AABB overlap to WP-03B's `aabbOverlap`
- **Critical gap:** `rectToWP03BAABB` hardcodes `rotation = 0` — rotation is lost
- `collisionDetection.ts` uses AABB only; push is axis-aligned (horizontal OR vertical, smaller overlap wins)

### Known Limitation (from team-12.json)
> AABB computation is rotation-aware via WP-03B `generateAABB`, so collision boundaries correctly expand for rotated elements. **Push-apart resolution vectors are axis-aligned (horizontal/vertical) only;** they are not perpendicular to the rotated face. For highly rotated elements, residual overlap along the rotated face may remain after solver convergence.

---

## 9. Gap Analysis

| Requirement | Status | Notes |
|---|---|---|
| OBB generation for LayoutElements | **Partially implemented** | WP-03B has `generateOBB(PlacementGeometry)` but `LayoutElement` uses pixel units; adapter needed |
| SAT narrow-phase overlap detection | **Missing in layout-composer** | WP-03B `satTest` exists and is tested; not called from layout-composer |
| Rotation-aware push vectors | **Missing** | `resolveCollision` in `collisionDetection.ts` uses `overlapX/Y` (axis-aligned only) |
| Type bridge Rect → PlacementGeometry | **Missing** | `LayoutElement` has `x,y,width,height,rotation`; `PlacementGeometry` needs `xCm,yCm,widthCm,depthCm,rotationDeg,clearance*,id` |
| Updated manifest | **Missing** | `knownLimitations.rotation.status` still `"axis-aligned-push-only"` |
| Updated OpenAPI | **Missing** | Limitation callout still present in team-12.yaml |
| New tests | **Missing** | No rotation-aware push tests exist in composer.test.ts |

---

## 10. Risks

| Risk | Severity | Notes |
|---|---|---|
| **Type bridge unit mismatch** | High | `LayoutElement` uses pixel units; `PlacementGeometry` uses cm units. Passing px as cm will give wrong OBB. The adapter must pick a unit convention — pixels are fine if consistent. |
| **Push vector nondeterminism** | Medium | SAT `minOverlapAxis` returns the axis of minimum overlap. For symmetric overlaps, axis selection could vary. Must test determinism. |
| **constraintSolver signature change** | Medium | If `resolveCollision` signature changes (e.g. takes `rotationDeg`), all call sites in `constraintSolver.ts` must be updated simultaneously. |
| **Performance regression** | Medium | OBB+SAT is more expensive than AABB. With MAX_ELEMENTS=500 and MAX_CONSTRAINTS=200 and MAX_ITERATIONS=100, worst case is 500×499/2 × 100 = ~12.5M SAT calls per solve. Must benchmark against SOLVER_DEADLINE_MS=5000ms. |
| **Clearance OBB interaction** | Low | `clearance.ts` already uses `generateClearanceOBB` — no conflict. Not used by layout-composer. |
| **Backward compatibility** | Low | API response shape (`CollisionPair`, `LayoutOperation`) does not change; only internal geometry changes. |
| **Regression test fragility** | Low | Existing AABB tests in `composer.test.ts` may produce different push vectors with OBB/SAT. Tests that assert exact dx/dy values will need updating. |

---

## 11. Proposed Work Breakdown

Based on evidence, WP-04 can be safely divided into **two isolated sub-packages**:

---

### WP-04A — OBB/SAT Integration in Collision Adapter

**Objective:** Replace `rectToWP03BAABB` with a `LayoutElement → OBB` converter and replace `rectsOverlapViaWP03B` with a SAT-based predicate.

**Owned files:**
```
artifacts/api-server/src/services/layout-composer/collisionAdapter.ts
artifacts/api-server/src/services/layout-composer/__tests__/composer.test.ts  (new adapter tests only)
```

**Prohibited files (must not touch):**
```
artifacts/api-server/src/services/collision-engine/*   (WP-03B — read only)
artifacts/api-server/src/services/layout-composer/collisionDetection.ts  (WP-04B)
artifacts/api-server/src/services/layout-composer/constraintSolver.ts
integration/manifests/team-12.json
integration/openapi/team-12.yaml
```

**Dependencies:** WP-03B (already merged)

**Expected outputs:**
- `collisionAdapter.ts` exports `elementToOBB(el: LayoutElement): OBB` and `elementsOverlapViaOBB(a, b): boolean`
- Unit convention decision documented in code comments (pixels as cm, scale=1)
- New adapter tests: OBB generation at 0°, 45°, 90°; SAT overlap true/false; edge-touch = no collision

**Acceptance criteria:**
- All existing adapter tests pass
- New OBB/SAT adapter tests pass
- `collisionAdapter.ts` no longer hardcodes `rotation = 0`

---

### WP-04B — Rotation-Aware Push Resolution + Documentation Update

**Objective:** Replace axis-aligned push vectors in `collisionDetection.ts` with SAT-derived push vectors (perpendicular to minimum overlap axis). Update manifest and OpenAPI.

**Owned files:**
```
artifacts/api-server/src/services/layout-composer/collisionDetection.ts
artifacts/api-server/src/services/layout-composer/__tests__/composer.test.ts  (push vector tests)
integration/manifests/team-12.json
integration/openapi/team-12.yaml
```

**Prohibited files (must not touch):**
```
artifacts/api-server/src/services/collision-engine/*   (WP-03B — read only)
artifacts/api-server/src/services/layout-composer/collisionAdapter.ts  (WP-04A output)
```

**Dependencies:** WP-04A must be merged before WP-04B begins.

**Expected outputs:**
- `resolveCollision` uses `satTest.minOverlapAxis` to compute push direction
- Push vector is along the minimum overlap axis (rotation-aware)
- Locked element logic preserved
- `team-12.json` knownLimitations.rotation.status → `"obb-sat"`, scheduledFor removed
- `team-12.yaml` limitation callout removed

**Acceptance criteria:**
- Two 45°-rotated overlapping elements receive a diagonal push (not horizontal/vertical)
- All existing composer tests pass (update any that assert exact axis-aligned push values)
- Manifest and OpenAPI updated with no regressions

---

## 12. File Ownership Matrix

| File | WP-04A | WP-04B | WP-03B (locked) |
|---|---|---|---|
| `collision-engine/aabb.ts` | read | read | OWNER |
| `collision-engine/obb.ts` | read | read | OWNER |
| `collision-engine/sat.ts` | read | read | OWNER |
| `collision-engine/types.ts` | read | read | OWNER |
| `collisionAdapter.ts` | **WRITE** | read | — |
| `collisionDetection.ts` | read | **WRITE** | — |
| `constraintSolver.ts` | — | **WRITE (if sig changes)** | — |
| `types/layout-composer/index.ts` | read | — | — |
| `team-12.json` | — | **WRITE** | — |
| `team-12.yaml` | — | **WRITE** | — |
| `composer.test.ts` | **WRITE (adapter)** | **WRITE (push)** | — |

---

## 13. Branch Strategy

| Item | Recommendation |
|---|---|
| Base branch | `main` (SHA `7f4e3b4`) |
| WP-04A branch | `feature/wp04a-obb-sat-adapter` |
| WP-04B branch | `feature/wp04b-rotation-push` (base off merged WP-04A) |
| Integration branch | Not needed — sequential merge |
| Force push | Prohibited |
| Squash | Not recommended — preserve history |

---

## 14. Merge Order

```
main (7f4e3b4)
  └─ feature/wp04a-obb-sat-adapter  ──PR #6──► main
       └─ feature/wp04b-rotation-push ──PR #7──► main
```

WP-04B must NOT be merged before WP-04A is on main.

---

## 15. Test Strategy

### Pre-merge gates for every PR

```bash
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run build
cd artifacts/api-server && pnpm vitest run
```

Expected: ≥ 6056 tests pass (count may grow with new tests; must not decrease).

### WP-04A targeted tests
- `collisionAdapter` OBB generation: rotation 0°, 45°, 90°, 180°, 270°
- `elementsOverlapViaOBB` returns `true` for overlapping rotated elements
- `elementsOverlapViaOBB` returns `false` for separated rotated elements
- Edge-touch policy preserved (touching = not a collision)
- Determinism: same input twice → same output

### WP-04B targeted tests
- `resolveCollision` with two 45°-rotated elements → push vector is diagonal (dx ≠ 0 AND dy ≠ 0)
- Locked element absorbs no push (existing test must still pass)
- Two locked elements → no adjustment (existing test must still pass)
- Solver convergence: layout with rotated elements reaches no-collision state within MAX_ITERATIONS

---

## 16. Acceptance Criteria (Full WP-04)

1. `collisionAdapter.ts` produces an OBB from a `LayoutElement` using `rotation` field (not hardcoded 0).
2. Overlap detection uses SAT, not AABB only.
3. Push vectors are perpendicular to the minimum overlap axis (rotation-aware).
4. All 6056 existing tests pass.
5. New tests for OBB adapter and rotation-aware push pass.
6. `team-12.json` knownLimitations.rotation.status = `"obb-sat"`, `scheduledFor` field removed.
7. `team-12.yaml` no longer references the axis-aligned push limitation.
8. `pnpm run typecheck:libs` passes clean.
9. API build passes.
10. No public API response shape changes (backward-compatible).

---

## 17. Open Questions (Owner Decisions Required)

| # | Question | Impact |
|---|---|---|
| 1 | **Unit convention:** Should the OBB adapter treat pixel values as cm directly (scale=1) or apply a conversion? WP-03B uses cm units but layout-composer uses pixels. | Affects OBB dimensions and correctness |
| 2 | **Push vector sign convention:** When SAT returns `minOverlapAxis`, the direction must be chosen based on relative center positions. Should the convention match the current axis-aligned sign rule (a pushed left, b pushed right)? | Affects test assertions and user-visible behavior |
| 3 | **Performance budget:** Is SOLVER_DEADLINE_MS=5000ms sufficient after switching to OBB+SAT? Should a benchmark be required before merging WP-04B? | May require constants adjustment |
| 4 | **AABB broad-phase:** Should WP-04A keep AABB as a pre-filter (broad phase) before calling SAT (narrow phase), mirroring WP-03B's `checkPair`? This would preserve performance. | Architecture decision |
| 5 | **Clearance zones:** Should clearance checking in the layout-composer also be upgraded to OBB, or only collision detection? | Scope boundary |
| 6 | **`collisionDetection.ts` `overlapExtent` function:** This returns `overlapX, overlapY` and is used in push vector calculation. Should this be replaced entirely or kept as AABB fallback? | API stability |

---

## 18. Go / No-Go Recommendation

**CONDITIONAL GO** — WP-04 is implementable with current infrastructure, but requires owner sign-off on the 6 open questions above (especially #1 unit convention and #4 AABB broad-phase) before implementation begins.

The infrastructure is ready:
- WP-03B `generateOBB` + `satTest` are fully implemented, tested, and merged.
- The code clearly flags the exact lines to change (`collisionAdapter.ts`, `collisionDetection.ts`).
- The test suite provides a solid regression baseline (6056 tests).
- The two sub-packages (WP-04A, WP-04B) are cleanly isolated with no file ownership conflicts.

**Do not begin implementation until open questions 1–4 are answered.**
