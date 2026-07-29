# WP-03 Domain Model — Placement Engine

## Aggregate: LayoutSession

A `LayoutSession` represents a single room design session. It defines the canvas on which furniture placements occur.

### Fields

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Stable primary key |
| `tenantId` | UUID \| NULL | Owning tenant; NULL = platform-wide |
| `roomTemplateId` | UUID \| NULL | Optional reference to WP-01 room_templates |
| `name` | string | Human-readable session name |
| `status` | `active` \| `archived` | Lifecycle state |
| `coordinateUnit` | string | Always `cm` for canonical sessions |
| `roomWidthCm` | decimal | Room width in centimetres (must be > 0) |
| `roomLengthCm` | decimal | Room length in centimetres (must be > 0) |
| `metadata` | JSONB | Extensible key-value store |
| `createdBy` | string | Actor identifier |
| `createdAt` | timestamptz | Immutable creation timestamp |
| `updatedAt` | timestamptz | Updated on any mutation |
| `archivedAt` | timestamptz \| NULL | Set when archived |

### Status Transitions

```
          create
            │
            ▼
         [active]
            │
          archive
            │
            ▼
        [archived]
            │
          restore
            │
            ▼
         [active]
```

Only `active` sessions accept new placements.

---

## Entity: Placement

A `Placement` represents a single furniture item positioned within a `LayoutSession`.

### Fields

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Stable primary key |
| `tenantId` | UUID \| NULL | Must match parent session's tenantId |
| `sessionId` | UUID | FK → layout_sessions (CASCADE delete) |
| `furnitureItemId` | UUID | Reference to WP-02 furniture_items |
| `xCm` | decimal | X position in room coordinates |
| `yCm` | decimal | Y position in room coordinates |
| `widthCm` | decimal | Item width footprint (must be > 0) |
| `depthCm` | decimal | Item depth footprint (must be > 0) |
| `heightCm` | decimal | Item height (must be > 0) |
| `rotationDeg` | decimal | Rotation in degrees `[0, 360)` |
| `anchorType` | enum | `none` \| `wall` \| `corner` \| `item` |
| `anchorData` | JSONB | Anchor-specific data (e.g. wall side, reference item ID) |
| `snapType` | enum | `none` \| `grid` \| `wall` \| `corner` \| `item_anchor` |
| `snapData` | JSONB | Snap-specific data (e.g. grid size, snap distance) |
| `metadata` | JSONB | Extensible key-value store |
| `version` | integer | Monotonically incremented on every mutation |
| `createdBy` | string | Actor identifier |
| `createdAt` | timestamptz | Immutable |
| `updatedAt` | timestamptz | Updated on every mutation |
| `archivedAt` | timestamptz \| NULL | Soft-delete via archive |

### Placement Rules

- A placement MUST belong to an `active` session
- `rotationDeg` is always normalized to `[0, 360)` before storage
- Dimensions (width, depth, height) must all be `> 0`
- Coordinates are not range-checked against room bounds at service layer (WP-03B responsibility)
- `furnitureItemId` is a soft reference — validated at service layer, not via DB FK constraint

---

## Value Objects

### BoundingRect

```typescript
interface BoundingRect {
  xMin: number;   // x position of item
  yMin: number;   // y position of item
  xMax: number;   // x + widthCm
  yMax: number;   // y + depthCm
  widthCm: number;
  depthCm: number;
}
```

### SnapResult

```typescript
interface SnapResult {
  x: number;
  y: number;
  snapped: boolean;
  snapType: SnapType;
}
```

---

## Tenant Invariant

```
placements.tenant_id IS NOT DISTINCT FROM layout_sessions.tenant_id

Allowed:
  session.tenant_id = NULL  AND  placement.tenant_id = NULL   → ✅
  session.tenant_id = 'T1'  AND  placement.tenant_id = 'T1'  → ✅

Rejected:
  session.tenant_id = NULL  AND  placement.tenant_id = 'T1'  → ❌
  session.tenant_id = 'T1'  AND  placement.tenant_id = NULL  → ❌
  session.tenant_id = 'T1'  AND  placement.tenant_id = 'T2'  → ❌
```

Enforced at two layers:
1. **Service layer** — `assertTenantConsistency()` before any DB write
2. **Database layer** — `trg_placements_tenant_consistency` trigger on INSERT/UPDATE

---

## Relationships

```
room_templates (WP-01)
      │
      │ (optional FK)
      ▼
layout_sessions ─────────────────┐
      │                          │ tenant_id must match
      │ (1:N)                    │
      ▼                          │
 placements ◄────────────────────┘
      │
      │ (soft reference)
      ▼
furniture_items (WP-02)
```
