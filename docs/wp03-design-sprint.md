# WP-03 Design Sprint — Placement Engine

## Overview

WP-03 introduces the **Placement Engine** for the Phase 6 Interior Design Platform. It manages layout sessions and item placements within rooms, providing the spatial foundation for all subsequent design tools.

---

## Work Packages

| WP | Name | Status |
|---|---|---|
| WP-03A | Placement Engine Core | ✅ Complete (v2 rebuild) |
| WP-03B | Collision Engine | 🔒 Blocked — awaits WP-03A review |
| WP-03C | Layout State Manager | 🔒 Blocked — awaits WP-03B |
| WP-03D | Undo/Redo | 🔒 Blocked — awaits WP-03C |
| WP-03E | Constraint Validator | 🔒 Blocked — awaits WP-03C |
| WP-03F | Persistence and Publish | 🔒 Blocked — awaits WP-03E |

---

## WP-03A Sprint Scope

### Included

- `layout_sessions` and `placements` tables
- Session lifecycle: create → active → archived → restored
- Placement CRUD: create, move, rotate, duplicate, archive, restore
- Pure geometry helpers: normalizeRotation, bounding rectangle, coordinate/dimension validation
- Snapping system: grid, wall, corner, item-anchor (priority order)
- Tenant isolation at service and database level
- RLS + FORCE RLS with 4 policies per table (SELECT/INSERT/UPDATE/DELETE)
- Database-level tenant consistency trigger

### Explicitly Excluded (WP-03B+)

- Collision detection (AABB, OBB, SAT)
- Clearance soft-warnings
- Undo/redo (command pattern)
- Layout constraint engine
- AI layout generation
- Publishing / public layout catalog
- Rendering pipeline
- Admin visual editor

---

## Dependencies

| Dependency | Version | Status |
|---|---|---|
| WP-01 Room Template Library | material-v6.0.0-wp01 | ✅ Merged |
| WP-02 Furniture & Object Library | material-v6.0.1-wp02 | ✅ Merged |

---

## Coordinate System

- **Type**: 2D top-down projection
- **Unit**: centimetres (cm)
- **Origin**: lower-left corner of room
- **X-axis**: positive → right (West→East)
- **Y-axis**: positive → up (South→North)
- **Rotation**: degrees, normalized to `[0, 360)`, clockwise from North

---

## State Model

- Session state stored as row data with JSONB `metadata`
- Placement state stored per-row (no event sourcing in WP-03A)
- Snapshots: full session serialize/deserialize available as service helpers
- Versioning: `version` integer incremented on every placement mutation

---

## Tenant Model

- `tenant_id UUID NULL` on both `layout_sessions` and `placements`
- `NULL` tenant_id = platform-wide (reserved for system/admin use)
- Non-NULL tenant_id = scoped to that tenant only
- **Invariant**: `placements.tenant_id IS NOT DISTINCT FROM layout_sessions.tenant_id`
- Enforced at: (1) service layer early check, (2) database trigger final guard

---

## Snapping Priority

When multiple snap candidates match, apply in this order (first match wins):

1. **Grid snap** — always available when grid is enabled
2. **Wall snap** — when item is within `snapDistanceCm` of a room wall
3. **Corner snap** — when item is within `snapDistanceCm` of a room corner
4. **Item-anchor snap** — only when `snapType === 'item_anchor'` is explicitly requested

---

## History

| Event | Date | Note |
|---|---|---|
| WP-03A original implementation | 2026-07-28 | Lost — workspace cleared before push |
| WP-03A v2 rebuild | 2026-07-29 | This sprint; complete rebuild from spec |
