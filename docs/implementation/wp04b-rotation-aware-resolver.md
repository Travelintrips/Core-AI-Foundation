# WP-04B — Layout Composer: Rotation-Aware Collision Resolver

**Branch:** `feature/wp04b-layout-rotation-resolver`  
**Builds on:** WP-04A (OBB/SAT Collision Adapter, `obbSatAdapter.ts`)  
**Status:** IMPLEMENTED — 48/48 tests pass, 6135/6135 full regression pass, build clean

---

## Overview

WP-04B upgrades the Layout Composer's `no_collision` constraint handler from AABB-only collision resolution to OBB/SAT with MTV-based resolution when any element carries a non-zero `rotation` field.

**Before WP-04B:** The `no_collision` handler used `findAllCollisions` + `resolveCollision` (both AABB-only). Rotated elements could appear to collide when their corners did not actually overlap, or fail to collide when their rotated corners did.

**After WP-04B:** When any element in the constraint set has non-zero rotation, the handler switches to `findRotationAwareCollisions` + `resolveRotationAwareCollision`, which delegates all geometry to WP-04A's `obbSatCollideElements`. Fully axis-aligned sets continue to use the existing AABB path unchanged.

---

## Files Changed / Added

| File | Type | Description |
|------|------|-------------|
| `services/layout-composer/rotationAwareResolver.ts` | **NEW** | Core WP-04B module: 3 public functions |
| `services/layout-composer/constraintSolver.ts` | **MODIFIED** | `no_collision` handler upgraded; WP-04B imports added |
| `services/layout-composer/constants.ts` | **MODIFIED** | `ROTATION_RESOLVER_CLEARANCE_PX` constant added |
| `services/layout-composer/__tests__/rotationAwareResolver.test.ts` | **NEW** | 48 tests across 5 sections |

---

## Public API (`rotationAwareResolver.ts`)

### `requiresRotationAwareResolution(elements): boolean`
Returns `true` if any element has a non-zero `rotation` field (treats `undefined` as 0). The `no_collision` handler uses this to choose between the OBB/SAT path and the existing AABB path.

### `findRotationAwareCollisions(elements, clearancePx?): RotationAwarePair[]`
Detects all colliding pairs using OBB/SAT broad + narrow phase. Delegates exclusively to `obbSatCollideElements` — no inline geometry. Returns detected pairs including the full `ObbSatResult` (with MTV) for use in resolution.

### `resolveRotationAwareCollision(a, b, result): Record<string, RawPositionAdjustment>`
Resolves a single detected pair using the OBB/SAT MTV. Distribution rules:
- Both movable → each element receives ½ MTV (equal split)
- A locked → B receives full negated MTV
- B locked → A receives full MTV
- Both locked → empty result (no adjustment)

**Critical:** returns raw floats — the caller MUST NOT round before updating internal float-position tracking.

---

## Design Decisions

### Float-shadow pattern (B-3 fix)
The `no_collision` handler maintains a `floatX / floatY` Map alongside the `current` state. When multiple pairs are resolved in a single constraint application, each MTV adjustment updates the float shadow with raw floats. Rounding happens **only** at `op.after` creation, never on intermediate values. This prevents rounding accumulation from causing residual penetration that would block convergence.

### Negative-zero normalisation
JavaScript's IEEE-754 `−0` is produced by `−(0 * 0.5)`. All dx/dy values pass through `nz(n)` (returns `n === 0 ? 0 : n`) before leaving the module, matching the convention in WP-03B's `geometry.ts`.

### AABB fallback preserved
When all elements in a `no_collision` constraint have `rotation = 0` (or `undefined`), the handler takes the existing AABB branch without modification. WP-04B adds no performance cost to fully axis-aligned layouts.

### No inline geometry
All geometry (broad-phase AABB, OBB construction, SAT narrow phase, MTV derivation) is delegated to WP-04A's `obbSatCollideElements`. `rotationAwareResolver.ts` imports no functions from `collision-engine/` directly.

### MTV convention
Follows WP-04A's owner decision: `resolvedA = originalA + mtv`. Element B receives `−mtv` (or `−½mtv` when both movable).

---

## Test Coverage (48 tests)

| Section | Tests | Coverage |
|---------|-------|----------|
| `requiresRotationAwareResolution` | 7 | undefined/0/negative/tiny non-zero rotation |
| `findRotationAwareCollisions` | 15 | detection, delegation spy, pair ordering, locked pairs, clearancePx forwarding |
| `resolveRotationAwareCollision` | 11 | all lock combinations, float precision, negative-zero, empty result |
| `constraintSolver` integration | 13 | AABB path unchanged, OBB/SAT path invoked, locked elements, integer op.after, determinism, float-shadow B-3 regression, both-locked no-op, AABB fallback for rotation=0 |
| Module boundary | 2 | No geometry exports, exclusive WP-04A delegation |

---

## Integration with WP-03B and WP-04A

```
constraintSolver.ts
  └── requiresRotationAwareResolution?
        YES → findRotationAwareCollisions
                └── obbSatCollideElements (WP-04A)
                      ├── generateAABB      (WP-03B)
                      ├── aabbOverlap       (WP-03B)
                      ├── generateOBB       (WP-03B)
                      └── satTest           (WP-03B)
              └── resolveRotationAwareCollision (MTV from ObbSatResult)
        NO  → findAllCollisions + resolveCollision (AABB, unchanged)
```

---

## Constants Added (`constants.ts`)

```typescript
ROTATION_RESOLVER_CLEARANCE_PX: 0,
// Uniform clearance (px) added to each element's OBB collision envelope.
// 0 = physical bounds only. Increase to enforce visual breathing margin.
```

---

## Known Limitations / WP-04C Scope

- Single-pass resolution per constraint application: deep multi-element pileups may require several solver iterations to fully separate. The iterative solver outer loop handles this.
- Non-rectangular shapes (ellipses, polygons) not supported — inherited from WP-03B OBB model.
- Clearance is uniform per pair (not per-element or directional) — directional clearance deferred to WP-04C if required.
