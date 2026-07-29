# WP-03A API Blueprint — Placement Engine

## Base Path

All endpoints are mounted under: `/api/ai/`

All endpoints require the `x-admin-api-key` header (admin auth).
No public endpoints in WP-03A scope.

---

## Layout Session Endpoints

### POST `/api/ai/layout-sessions`

Create a new layout session.

**Request body:**
```json
{
  "tenantId": "uuid | null",
  "roomTemplateId": "uuid | null",
  "name": "Living Room Session 1",
  "coordinateUnit": "cm",
  "roomWidthCm": 500,
  "roomLengthCm": 700,
  "metadata": {},
  "createdBy": "admin"
}
```

**Response 201:**
```json
{
  "session": { ...LayoutSession }
}
```

---

### GET `/api/ai/layout-sessions`

List sessions with optional filters.

**Query params:**
- `tenantId` — filter by tenant (exact match)
- `status` — `active` | `archived`
- `search` — name partial match
- `limit` — default 50, max 200
- `offset` — default 0

**Response 200:**
```json
{
  "sessions": [...],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

---

### GET `/api/ai/layout-sessions/:sessionId`

Get a single session.

**Response 200:**
```json
{
  "session": { ...LayoutSession }
}
```

**Response 404:**
```json
{ "error": "Session not found", "code": "NOT_FOUND" }
```

---

### PATCH `/api/ai/layout-sessions/:sessionId`

Update a session's mutable fields.

**Request body (all optional):**
```json
{
  "name": "New Name",
  "roomWidthCm": 600,
  "roomLengthCm": 800,
  "metadata": {}
}
```

**Response 200:**
```json
{
  "session": { ...LayoutSession }
}
```

---

### POST `/api/ai/layout-sessions/:sessionId/archive`

Archive a session (soft-delete).

**Response 200:**
```json
{
  "session": { ...LayoutSession, "status": "archived" }
}
```

---

### POST `/api/ai/layout-sessions/:sessionId/restore`

Restore an archived session.

**Response 200:**
```json
{
  "session": { ...LayoutSession, "status": "active" }
}
```

---

## Placement Endpoints

### POST `/api/ai/layout-sessions/:sessionId/placements`

Create a new placement in a session.

**Request body:**
```json
{
  "tenantId": "uuid | null",
  "furnitureItemId": "uuid",
  "xCm": 100,
  "yCm": 200,
  "widthCm": 90,
  "depthCm": 60,
  "heightCm": 85,
  "rotationDeg": 0,
  "anchorType": "none",
  "anchorData": {},
  "snapType": "grid",
  "snapData": { "gridSizeCm": 10 },
  "metadata": {},
  "createdBy": "admin"
}
```

**Response 201:**
```json
{
  "placement": { ...Placement }
}
```

---

### GET `/api/ai/layout-sessions/:sessionId/placements`

List placements in a session.

**Query params:**
- `includeArchived` — `true` | `false` (default `false`)
- `limit` — default 200, max 1000
- `offset` — default 0

**Response 200:**
```json
{
  "placements": [...],
  "total": 12,
  "limit": 200,
  "offset": 0
}
```

---

### GET `/api/ai/layout-sessions/:sessionId/placements/:placementId`

Get a single placement.

**Response 200:**
```json
{
  "placement": { ...Placement }
}
```

---

### PATCH `/api/ai/layout-sessions/:sessionId/placements/:placementId`

Update placement position, rotation, dimensions, or metadata.

**Request body (all optional):**
```json
{
  "xCm": 150,
  "yCm": 250,
  "rotationDeg": 90,
  "widthCm": 90,
  "depthCm": 60,
  "heightCm": 85,
  "anchorType": "wall",
  "anchorData": { "wall": "left" },
  "snapType": "wall",
  "snapData": {},
  "metadata": {}
}
```

**Response 200:**
```json
{
  "placement": { ...Placement }
}
```

---

### DELETE `/api/ai/layout-sessions/:sessionId/placements/:placementId`

Archive (soft-delete) a placement.

**Response 200:**
```json
{
  "placement": { ...Placement, "archivedAt": "2026-07-29T..." }
}
```

---

### POST `/api/ai/layout-sessions/:sessionId/placements/:placementId/restore`

Restore an archived placement.

**Response 200:**
```json
{
  "placement": { ...Placement, "archivedAt": null }
}
```

---

### POST `/api/ai/layout-sessions/:sessionId/placements/:placementId/duplicate`

Duplicate a placement at `(x + 10cm, y + 10cm)`.

**Response 201:**
```json
{
  "placement": { ...Placement, "id": "new-uuid", "version": 1 }
}
```

---

## Error Response Format

All errors follow:

```json
{
  "error": "Human-readable message",
  "code": "ERROR_CODE"
}
```

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `INVALID_INPUT` | Bad request body or params |
| 401 | `UNAUTHORIZED` | Missing or invalid admin API key |
| 403 | `TENANT_MISMATCH` | Tenant isolation violation |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | State conflict (e.g. archived session) |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

SQL trigger error text is never surfaced in API responses.
