# WP-03A — Placement Engine Core Specification

## Purpose

The Placement Engine is the spatial foundation of the Interior Design Platform. It provides the data structures and operations needed to position furniture items within a room canvas, without implementing collision detection, optimization, or AI-assisted layout.

---

## Service Contract

### Session Operations

#### `createSession(input)`
Creates a new layout session with `status = 'active'`.

- Validates `roomWidthCm > 0` and `roomLengthCm > 0`
- Assigns `coordinateUnit = 'cm'` if not provided
- `tenantId` may be NULL (platform-wide) or a UUID

#### `getSession(sessionId, tenantId?)`
Returns a session by ID. Throws `NOT_FOUND` (404) if missing.

#### `listSessions(filter)`
Returns paginated sessions filtered by tenantId, status, and optional name search.

#### `updateSession(sessionId, input, tenantId?)`
Updates `name`, `roomWidthCm`, `roomLengthCm`, or `metadata`. Increments `updatedAt`. Does not change `tenantId`.

#### `archiveSession(sessionId, tenantId?)`
Sets `status = 'archived'` and `archivedAt = now()`. Idempotent if already archived.

#### `restoreSession(sessionId, tenantId?)`
Sets `status = 'active'` and `archivedAt = null`. Throws if session does not exist.

---

### Placement Operations

#### `createPlacement(sessionId, input, tenantId?)`
Creates a new placement within a session.

- Validates session exists and is `active`
- Validates `furnitureItemId` is provided
- Validates dimensions > 0
- Validates coordinates are finite numbers
- Normalizes `rotationDeg` to `[0, 360)`
- Asserts tenant consistency between session and placement
- Returns the created placement with `version = 1`

#### `getPlacement(sessionId, placementId, tenantId?)`
Returns a single placement. Throws `NOT_FOUND` if missing.

#### `listPlacements(sessionId, filter)`
Returns paginated placements for a session, optionally filtered by archived state.

#### `movePlacement(sessionId, placementId, input, tenantId?)`
Updates `xCm`, `yCm`, `snapType`, `snapData`. Increments `version`.

#### `rotatePlacement(sessionId, placementId, input, tenantId?)`
Updates `rotationDeg` (normalized to `[0, 360)`). Increments `version`.

#### `duplicatePlacement(sessionId, placementId, tenantId?)`
Creates a copy of an existing placement at a small offset (+10cm x, +10cm y). Returns the new placement with `version = 1`.

#### `archivePlacement(sessionId, placementId, tenantId?)`
Sets `archivedAt = now()`. Soft-delete — placement remains in DB.

#### `restorePlacement(sessionId, placementId, tenantId?)`
Clears `archivedAt`. Throws if placement does not exist.

---

### Pure Helper Functions

These functions are stateless and have no DB side effects.

#### `normalizeRotation(deg: number): number`
Returns `deg mod 360`, adjusted for negative values to always be in `[0, 360)`.

```
normalizeRotation(0)    → 0
normalizeRotation(90)   → 90
normalizeRotation(360)  → 0
normalizeRotation(450)  → 90
normalizeRotation(-90)  → 270
normalizeRotation(-360) → 0
```

#### `validateCoordinates(x, y): void`
Throws `INVALID_INPUT` if either coordinate is not a finite number.

#### `validateDimensions(w, d, h): void`
Throws `INVALID_INPUT` if any dimension is `<= 0` or not finite.

#### `getBoundingRect(x, y, widthCm, depthCm): BoundingRect`
Returns the axis-aligned bounding rectangle for an item.

#### `serializeSession(session): object`
Returns a plain-object snapshot of a session suitable for logging/storage.

#### `serializePlacement(placement): object`
Returns a plain-object snapshot of a placement.

#### `deserializeSession(obj): LayoutSession`
Parses and validates a plain object into a LayoutSession shape.

#### `deserializePlacement(obj): Placement`
Parses and validates a plain object into a Placement shape.

---

## Snapping System

Snapping is applied during `createPlacement` and `movePlacement`. It adjusts the final `(xCm, yCm)` position before storage.

### Grid Snap

```typescript
snapToGrid(x, y, { gridSizeCm }): SnapResult
```

Rounds `x` and `y` to the nearest `gridSizeCm` multiple.

### Wall Snap

```typescript
snapToWall(x, y, { roomWidthCm, roomLengthCm, itemWidthCm, itemDepthCm, snapDistanceCm? }): SnapResult
```

Snaps item to the nearest wall if within `snapDistanceCm` (default 10cm). Checks all four walls.

### Corner Snap

```typescript
snapToCorner(x, y, { roomWidthCm, roomLengthCm, itemWidthCm, itemDepthCm, snapDistanceCm? }): SnapResult
```

Snaps to the nearest room corner if within `snapDistanceCm`.

### Item-Anchor Snap

```typescript
snapToItemAnchor(x, y, anchorItemBounds, { snapDistanceCm? }): SnapResult
```

Aligns one item edge/center to another item's anchor point. Only applied when `snapType === 'item_anchor'` is explicitly set.

### Priority

When multiple snap strategies are applicable, the first match wins:
1. Grid
2. Wall
3. Corner
4. Item-anchor (only when explicitly requested)

---

## Error Codes

| Code | HTTP Status | Description |
|---|---|---|
| `NOT_FOUND` | 404 | Session or placement not found |
| `SESSION_NOT_FOUND` | 404 | Referenced session does not exist |
| `TENANT_MISMATCH` | 403 | placement.tenant_id ≠ session.tenant_id |
| `INVALID_INPUT` | 400 | Coordinates, dimensions, or rotation invalid |
| `FORBIDDEN` | 403 | Operation not allowed on this resource |
| `CONFLICT` | 409 | State conflict (e.g. already archived) |
| `SESSION_ARCHIVED` | 409 | Cannot add placement to archived session |
