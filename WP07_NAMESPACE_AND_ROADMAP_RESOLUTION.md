# WP-07 Namespace and Roadmap Resolution

Status: **GO/NO-GO = NO-GO for implementation**

This report follows the continuation instruction to resolve the WP-07 naming
collision before implementing a feature. The owner selected
**Layout Constraint Engine** as the desired scope, but repository lineage
contains multiple independent meanings for the same label. The selected
scope is therefore recorded as an owner preference, not treated as proof that
the repository namespace is resolved.

## 1. Verified main and WP-06B evidence

| Item | Result |
|---|---|
| Branch | `main` |
| Main SHA | `3e6ccc1893a1c5ba047c29428d01059682727a11` |
| Local SHA = `origin/main` | Yes |
| Library typecheck | PASS |
| API build | PASS |
| API regression | PASS — 6103/6103 |
| AI Platform typecheck | PASS |
| AI Platform tests | PASS — 493/493 |
| AI Platform build | PASS |
| Full API typecheck | 127 pre-existing errors in 40 files; isolated in `docs/technical-debt/API_TYPECHECK_BASELINE.md` |
| Supabase/runtime state | Existing services were previously verified healthy; no WP-07 code was started |

WP-06B ancestry was verified:

- `33aab04` is an ancestor of `origin/main`.
- `226b466` is an ancestor of `origin/main`.
- `809c264` is an ancestor of `origin/main`.

The production surface is present on main:

- placement canvas: `artifacts/ai-platform/src/components/interior-design/PlacementCanvas.tsx`
- suggest endpoint: `POST /ai/layout-sessions/:sessionId/suggest-placement`
- apply endpoint: `POST /ai/layout-sessions/:sessionId/apply-placement`
- candidate-only apply: `applyPlacement()` decodes and validates `candidateId`
- locked placement protection: UI and service guards
- approved/read-only protection: editor and placement controls honor read-only state

The remote branch `feature/wp06b-placement-canvas-rebuild` differs from
`origin/main` only by `.replit` and an instruction artifact. It is classified
**OBSOLETE — DO NOT MERGE**. No redundant WP-06B PR is required.

GitHub write access is **UNAVAILABLE** in this environment: the GitHub
connector is `not_setup`. The technical conclusion is based on main ancestry,
not on a redundant push or PR.

## 2. WP-07 source matrix

| Source | Commit / date | Roadmap or domain | Objective | Dependencies | Code status | Confidence |
|---|---|---|---|---|---|---|
| `docs/specifications/p0-work-package-plan.md`, WP-07 | `b9e6694`, 2026-07-14 | P0 enterprise foundation | Add `tenant_id`/`actor_type` to `ai_audit_logs` and remove application update/delete capability | Baseline schema tooling; WP-01 context for future population | Already implemented as part of the canonical audit-log work; `ai_audit_logs.ts`, DDL, and service guards exist | High within P0 |
| `docs/implementation/wp03-audit-log-report.md` | `a0e19a5`, 2026-07-14 | P0 audit implementation | Explicitly maps “WP-03” to P0 plan WP-07 + WP-08 and reports schema, redaction, immutability, and pilot auto-emission | Repository pilot and RequestContext | Implemented and tested; report says 527 tests passed at that time | High as completion evidence |
| `docs/implementation/wp06-wp07-worker-sse-report.md` | `8012dd7`, 2026-07-14 | Worker / scheduler / SSE context | Tenant-isolate SSE subscribers and reconnect cursors | Existing RequestContext and SSE manager | Implemented in `sseManager.ts` and `customer-workspace-sse.ts` | High as completion evidence; not an unbuilt next WP |
| `docs/phase6-work-packages.md`, WP-07 | `b45e438`, 2026-07-27 | Phase 6 interior design | Build Layout Constraint Engine, rule DSL, six rule types, RoomPlannerAgent, admin editor, and seeds for eight room types | WP-01 room types and WP-06 furniture placement/session tables | Partially present only: a generic layout-composer solver and empty `layout_constraint_sets`; no authoritative WP-07 service/seed/editor set was found | High within Phase 6 |
| `docs/wp01-room-template-library.md`, deferred-work notes | repository support for the Phase 6 plan | Phase 6 interior design | Confirms `layout_constraint_sets` is intentionally empty and that constraint evaluation is WP-07 scope | WP-01 catalog | Schema exists; rules are not populated | High as supporting evidence |
| `NEXT_WP_DISCOVERY_AND_IMPLEMENTATION_PLAN.md` | `c7e8bc7`, 2026-08-04 | Phase 6 active-track discovery | Identifies WP-05 Material Recommendation Engine as the active next package, not WP-07 | WP-01 and Phase 5 material catalog | WP-05 is documented as ready; this creates a separate roadmap signal | Medium for WP-07 resolution; high for active-track conflict |

## 3. Conflict classification

The repository contains a **naming collision across roadmaps**, not one
linear WP-07 definition:

1. P0 uses WP-07 for canonical audit-log schema and immutability.
2. A P0 implementation report states that audit work already delivered the
   WP-07 + WP-08 portion under a different team label.
3. The worker/SSE report uses WP-07 for SSE tenant isolation and reports it
   complete.
4. Phase 6 uses WP-07 for the Layout Constraint Engine, which is the only
   candidate with an unimplemented deliverable set connected to the
   placement-canvas domain.
5. The August discovery plan identifies Phase 6 WP-05 as the active track,
   so it does not establish WP-07 as the next package after WP-06B.

No source explicitly states that the P0 namespace was renamed to the Phase 6
namespace, that the SSE package superseded either one, or that WP-06B changes
the numbering of the Phase 6 plan.

## 4. Owner decision recorded

The owner selected:

> Layout Constraint Engine — aturan validasi penempatan furnitur

That decision resolves the desired product scope for this conversation, but
does not resolve the repository-wide namespace collision required by the
continuation instruction. Implementing now would risk creating a second
WP-07 lineage while P0 and Phase 6 still use the same identifier.

## 5. Recommended authoritative next package

**Recommended product scope:** Phase 6 WP-07 — Layout Constraint Engine.

**Objective:** evaluate furniture placements against room-type-specific rules
using the existing `layout_constraint_sets` catalog and integrate the
evaluation with the placement workflow.

**Proposed scope:**

- typed `LayoutConstraintRule` DSL and runtime validation
- `LayoutConstraintService`
- rule types: `min_clearance`, `wall_proximity`, `anchor_required`,
  `rotation_locked`, `zone_exclusion`, `circulation_path`
- seed rules for all eight room types
- integration with existing placement/session contracts
- `RoomPlannerAgent` only if its architecture and provider policy are
  confirmed as part of this Phase 6 package
- admin constraint-set editor only if the existing admin route and API
  contract are confirmed
- unit, route, tenant-isolation, and bounded-performance tests

**Out of scope:**

- P0 audit-log schema or immutability changes
- SSE tenant isolation
- the 127 API typecheck cleanup
- WP-06B placement-canvas reimplementation
- new persistence architecture beyond the existing constraint-set table
- LLM/provider work unless explicitly required by the Phase 6 contract

## 6. Required owner-level resolution before implementation

One repository-level decision is still required:

**Should the Phase 6 Layout Constraint Engine be officially treated as the
next WP-07 namespace for this repository, while P0 canonical audit and SSE
references are treated as completed packages from separate roadmaps?**

Until that lineage is recorded in an authoritative roadmap or ADR, the safe
state is:

- stay on `main`
- do not create a speculative feature branch
- do not implement Layout Constraint Engine
- keep the technical-debt baseline separate
- do not merge the obsolete WP-06B branch

## 7. Final classification

| Decision | Result |
|---|---|
| WP-06B | COMPLETE — PRESENT IN MAIN |
| WP-07 namespace | CONFLICT UNRESOLVED |
| Layout Constraint Engine | Owner-selected scope; implementation NO-GO pending namespace resolution |
| Technical debt | Isolated; no fixes included |
| Feature branch | Not created |
| Push / PR / merge | Not attempted; GitHub connector unavailable |

**Verdict: WP-06B CLOSED — WP-07 NAMESPACE CONFLICT UNRESOLVED**