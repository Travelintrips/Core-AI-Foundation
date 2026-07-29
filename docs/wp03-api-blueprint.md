# WP-03 — API Blueprint

## Authentication

All WP-03 endpoints require admin authentication (API key or internal session). No public access.

## Tenant isolation

`tenantId` is ALWAYS resolved server-side from the authenticated principal — never accepted from the request body.

## WP-03A Endpoints

### Layout Sessions

| Method | Path | Description |
|---|---|---|
| GET | `/api/ai/layout-sessions` | List sessions for current tenant |
| POST | `/api/ai/layout-sessions` | Create session |
| GET | `/api/ai/layout-sessions/:sessionId` | Get session |
| PATCH | `/api/ai/layout-sessions/:sessionId` | Update session |
| POST | `/api/ai/layout-sessions/:sessionId/archive` | Archive |
| POST | `/api/ai/layout-sessions/:sessionId/restore` | Restore |
| DELETE | `/api/ai/layout-sessions/:sessionId` | Soft-delete |

### Placements

| Method | Path | Description |
|---|---|---|
| GET | `/api/ai/layout-sessions/:sessionId/placements` | List placements |
| POST | `/api/ai/layout-sessions/:sessionId/placements` | Create placement |
| GET | `/api/ai/layout-sessions/:sessionId/placements/:placementId` | Get placement |
| PATCH | `/api/ai/layout-sessions/:sessionId/placements/:placementId` | Update placement |
| POST | `/api/ai/layout-sessions/:sessionId/placements/:placementId/archive` | Archive |
| DELETE | `/api/ai/layout-sessions/:sessionId/placements/:placementId` | Delete |

## WP-03B Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/ai/layout-sessions/:sessionId/collision-check` | Check all placements in session |
| GET | `/api/ai/layout-sessions/:sessionId/collisions` | Get collision summary |
| POST | `/api/ai/layout-sessions/:sessionId/placements/:placementId/collision-check` | Check single placement |
| POST | `/api/ai/collision/check` | Stateless geometry check (no DB) |

## Error response format

```json
{
  "error": {
    "code": "PLACEMENT_NOT_FOUND",
    "message": "Human-readable message"
  }
}
```

No stack traces in responses.
