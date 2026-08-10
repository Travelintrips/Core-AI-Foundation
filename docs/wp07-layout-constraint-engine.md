# WP-07 Layout Constraint Engine

## 1. Objective

WP-07 evaluates a complete interior-design layout against deterministic hard
constraints and soft quality rules. Evaluation is read-only: it does not move,
save, or optimize furniture.

## 2. Architecture

The API route loads a tenant-scoped `layout_sessions` row and its
tenant-scoped `placements`. The service normalizes database numerics, reuses
the WP-03B collision service and its AABB/OBB/SAT primitives, evaluates the
complete layout, and returns a typed result. No LLM or external AI provider is
used.

## 3. Dependency chain

`WP-03A Placement Engine` → `WP-03B Collision Engine` → `WP-04A/04B rotated
geometry and resolution foundations` → `WP-06A placement rules` → `WP-06B
Placement Canvas` → `WP-07 Layout Constraint Engine`.

## 4. Hard constraints

| ID | Rule |
| --- | --- |
| HC-01 | Room bounds, including rotated corners |
| HC-02 | Furniture collision, using canonical geometry |
| HC-03 | Locked-item integrity; evaluation never mutates locked items |
| HC-04 | Door clearance when canonical door metadata exists |
| HC-05 | Window clearance, otherwise `not_applicable` |
| HC-06 | Configured walkway zones |
| HC-07 | Configured minimum furniture clearance |
| HC-08 | Canonical excluded zones |
| HC-09 | Finite coordinates, dimensions, and rotations; positive dimensions |
| HC-10 | Configured session capacity, bounded by the canonical 200-item cap |
| HC-11 | Approved-layout immutability; endpoint remains read-only |

## 5. Soft constraints

SC-01 wall alignment, SC-02 circulation quality, SC-03 symmetry, SC-04 zoning,
SC-05 focal-point orientation, SC-06 spacing balance, SC-07 room-function
compatibility, SC-08 style compatibility, and SC-09 preferred-zone adherence.

Rules whose required metadata is absent return `not_applicable` and do not
reduce the score.

## 6. Scoring weights

The score is the weighted average of applicable soft rules, normalized to
0–100:

| Rule | Weight |
| --- | ---: |
| SC-01 | 10 |
| SC-02 | 15 |
| SC-03 | 10 |
| SC-04 | 15 |
| SC-05 | 10 |
| SC-06 | 15 |
| SC-07 | 10 |
| SC-08 | 5 |
| SC-09 | 10 |

Hard failures make `valid=false`, but do not suppress the diagnostic score.

## 7. Not-applicable semantics

The engine never fabricates doors, windows, zones, style, function, or focal
point data. A rule is `not_applicable` when its canonical metadata is absent
or incomplete. Its score is excluded from the weighted denominator.

## 8. API

`POST /api/ai/layout-sessions/:sessionId/constraints/evaluate`

The endpoint accepts an empty JSON object, validates the UUID, authenticates
through the existing global admin/session middleware, resolves tenant scope
server-side, and reads the canonical session state. It does not accept client
geometry as a source of truth and does not persist an evaluation.

## 9. Tenant and security behavior

The session query requires both `sessionId` and the server-resolved placement
tenant. A missing or cross-tenant session returns the canonical non-disclosure
404. Invalid UUIDs are rejected before database access. The route is under the
existing authenticated `/api` router and is not public.

## 10. Canvas integration

The existing WP-06B Placement Canvas exposes an explicit **Evaluate Layout**
action. The result shows valid/invalid status, score, hard violations, soft
warnings, pair checks, per-rule status, and remediation hints. Dragging and
keyboard movement remain local preview operations; evaluation is never fired
per pointer event. Approved sessions remain read-only.

## 11. Performance bounds

Active placements are ordered deterministically and capped at 200 by the
existing collision-session limit. Pair evaluation is bounded O(n²), with no
unbounded recursion or retry loop. Result metadata records item count, rule
count, pair checks, violation counts, and diagnostic elapsed time. Timing is
not used as a correctness assertion.

## 12. Deterministic guarantees

Inputs are not mutated. Placements, violations, warnings, remediations, and
pair evaluations use stable ordering. The score uses finite arithmetic,
explicit weights, and no random or provider-generated values. Identical
canonical state produces the same semantic result.

## 13. Limitations

The current canonical model exposes only the metadata present on a layout
session and placement. Missing metadata is therefore reported as
`not_applicable`. The engine reports advisory remediation hints; it does not
automatically reposition furniture or persist a proposed solution.

## 14. WP-07 / future optimizer boundary

WP-07 is a validator and explainer. Automatic layout optimization, candidate
search, and furniture repositioning belong to a later work package and must
remain separate from this read-only evaluation endpoint.