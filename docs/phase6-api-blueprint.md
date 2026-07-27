# Phase 6 — API Blueprint

**Version:** 1.0.0  
**Baseline:** `material-v5.0.1`  
**Status:** Architecture only — do NOT implement  
**Convention:** All paths are final mounted paths under the existing `/api` prefix already mounted in `app.ts`

---

## Global Conventions

| Aspect | Convention |
|---|---|
| Authentication | Admin endpoints: `Authorization: Bearer <ADMIN_API_KEY>` or active internal session. Customer endpoints: workspace token via `x-workspace-token` header |
| Tenant Isolation | All endpoints resolve `tenantId` server-side from auth context; never trust client-supplied `tenantId` |
| Versioning | Contract version embedded in request body as `"_v": "1.0"` |
| Idempotency | `POST` creation endpoints accept `Idempotency-Key: <uuid>` header; duplicate requests within 24h return the original response |
| Error format | `{ "error": { "code": string, "message": string, "details"?: object } }` |
| Pagination | `?page=1&pageSize=20` for list endpoints; response includes `{ data: [], pagination: { total, page, pageSize, hasNext } }` |
| Soft Deletes | Items are archived, not hard-deleted |

---

## A. Room Template Catalog

### A1. List Room Templates
```
GET /api/ai/room-templates

Auth: Admin API key or internal session
Query:
  roomTypeId?: string
  status?: 'published' | 'draft' | 'archived'
  page?: number
  pageSize?: number

Response 200:
{
  data: RoomTemplate[],
  pagination: PaginationMeta
}

Errors:
  401 Unauthorized
  403 Forbidden
```

### A2. Get Room Template
```
GET /api/ai/room-templates/:id

Auth: Admin API key or internal session
Response 200: RoomTemplate
Errors: 401, 404
```

### A3. Create Room Template
```
POST /api/ai/room-templates

Auth: Admin API key, platform scope
Idempotency: Yes (Idempotency-Key header)
Request:
{
  "_v": "1.0",
  "name": string,
  "slug": string,
  "roomTypeId": string,
  "styleId": string | null,
  "dimensions": { "widthCm": number, "depthCm": number, "heightCm": number },
  "fixedElements": FixedElement[],
  "tenantId": string | null
}

Response 201: { "id": string, "status": "draft" }
Errors: 400 (validation), 401, 409 (slug conflict)
```

### A4. Publish Room Template
```
POST /api/ai/room-templates/:id/publish

Auth: Admin API key, platform scope
Request: {}
Response 200: { "id": string, "status": "published" }
Errors: 400 (draft required), 401, 404
```

### A5. Archive Room Template
```
POST /api/ai/room-templates/:id/archive

Auth: Admin API key
Request: {}
Response 200: { "id": string, "status": "archived" }
Errors: 401, 404
```

---

## B. Room Type & Style Catalog

### B1. List Room Types
```
GET /api/ai/room-types

Auth: Public exception (catalog read)
Response 200: { data: RoomType[] }
```

### B2. List Room Styles
```
GET /api/ai/room-styles

Auth: Public exception
Query: status?: string
Response 200: { data: RoomStyle[] }
```

### B3. List Room Themes
```
GET /api/ai/room-themes

Auth: Public exception
Response 200: { data: RoomTheme[] }
```

---

## C. Furniture Catalog

### C1. List Furniture Categories
```
GET /api/ai/furniture/categories

Auth: Public exception
Response 200: { data: FurnitureCategory[] }
```

### C2. Search Furniture
```
GET /api/ai/furniture

Auth: Public exception
Query:
  categoryId?: string
  styleId?: string
  roomTypeId?: string
  budgetMin?: number
  budgetMax?: number
  q?: string          (full-text search)
  page?: number
  pageSize?: number

Response 200: { data: FurnitureItem[], pagination: PaginationMeta }
```

### C3. Get Furniture Item
```
GET /api/ai/furniture/:id

Auth: Public exception
Response 200: FurnitureItem (with variants embedded)
Errors: 404
```

### C4. Create Furniture Item (admin)
```
POST /api/ai/furniture

Auth: Admin API key
Idempotency: Yes
Request:
{
  "_v": "1.0",
  "name": string,
  "slug": string,
  "categoryId": string,
  "dimensions": PhysicalDimensions,
  "surfaceList": string[],
  "placementRules": PlacementRule[]
}

Response 201: { "id": string }
Errors: 400, 401, 409
```

### C5. Add Furniture Variant
```
POST /api/ai/furniture/:furnitureId/variants

Auth: Admin API key
Idempotency: Yes
Request:
{
  "_v": "1.0",
  "sku": string,
  "colorName": string,
  "finishCode": string,
  "priceAmount": number,
  "priceCurrency": string
}

Response 201: { "variantId": string }
Errors: 400, 401, 404
```

---

## D. Decoration & Lighting Catalogs

### D1. List Decorations
```
GET /api/ai/decorations

Auth: Public exception
Query: decorationType?: string, styleId?: string, themeId?: string
Response 200: { data: DecorationItem[] }
```

### D2. List Lighting Fixtures
```
GET /api/ai/lighting-fixtures

Auth: Public exception
Query: fixtureType?: string, roomTypeId?: string
Response 200: { data: LightingFixture[] }
```

---

## E. Design Session Lifecycle

### E1. Create Design Session
```
POST /api/public/customer/workspace/:token/design-sessions

Auth: Workspace token
Idempotency: Yes
Request:
{
  "_v": "1.0",
  "templateId": string | null,
  "roomTypeId": string,
  "brief": {
    "description": string,
    "stylePreference": string | null,
    "themeId": string | null,
    "budgetMin": number | null,
    "budgetMax": number | null,
    "currency": string,
    "dimensionOverride": RoomDimensions | null,
    "priorityItems": string[],
    "constraints": string[]
  }
}

Response 201: { "sessionId": string, "status": "brief_submitted" }
Errors: 400, 401, 422 (invalid template for room type)
```

### E2. Get Design Session
```
GET /api/public/customer/workspace/:token/design-sessions/:sessionId

Auth: Workspace token (customer must own session)
Response 200: DesignSessionView (public-safe projection)
Errors: 401, 403, 404
```

### E3. List Design Sessions
```
GET /api/public/customer/workspace/:token/design-sessions

Auth: Workspace token
Query: status?: string, page?, pageSize?
Response 200: { data: DesignSessionSummary[], pagination: PaginationMeta }
```

### E4. Submit Brief Update
```
PATCH /api/public/customer/workspace/:token/design-sessions/:sessionId/brief

Auth: Workspace token; session must not be in terminal state
Request: { "_v": "1.0", "brief": DesignBrief }
Response 200: { "sessionId": string, "status": string }
Errors: 400, 401, 403, 409 (session in terminal state)
```

### E5. Approve Moodboard
```
POST /api/public/customer/workspace/:token/design-sessions/:sessionId/moodboard/approve

Auth: Workspace token
Request: { "moodboardId": string }
Response 200: { "sessionId": string, "status": "layout_in_progress" }
Errors: 401, 403, 404, 409
```

### E6. Request Preview Render
```
POST /api/public/customer/workspace/:token/design-sessions/:sessionId/renders/preview

Auth: Workspace token; session must be in layout_in_progress
Request:
{
  "_v": "1.0",
  "cameraAngles": ["front", "isometric", "top_down"]
}

Response 202: { "renderJobId": string, "status": "render_requested" }
Errors: 400, 401, 403, 409
```

### E7. Select Render Concept
```
POST /api/public/customer/workspace/:token/design-sessions/:sessionId/renders/select

Auth: Workspace token
Request: { "renderJobId": string, "conceptIndex": number }
Response 200: { "sessionId": string, "status": "render_requested" }
Errors: 400, 401, 404
```

### E8. Request Export Package
```
POST /api/public/customer/workspace/:token/design-sessions/:sessionId/export

Auth: Workspace token; session must be approved
Request:
{
  "_v": "1.0",
  "includeSpecPdf": true,
  "includeMaterialList": true,
  "includeFurnitureList": true,
  "includeMoodboard": true,
  "include3dModel": false
}

Response 202: { "exportId": string, "status": "requested" }
Errors: 400, 401, 403, 409
```

### E9. Get Export Status
```
GET /api/public/customer/workspace/:token/design-sessions/:sessionId/export/:exportId

Auth: Workspace token
Response 200: ExportPackage (with downloadUrl when ready)
Errors: 401, 403, 404
```

---

## F. Designer / Admin Session Management

### F1. List Sessions (Admin)
```
GET /api/ai/design-sessions

Auth: Admin API key
Query: tenantId?, status?, page?, pageSize?
Response 200: { data: DesignSessionAdminView[], pagination: PaginationMeta }
```

### F2. Get Session (Admin)
```
GET /api/ai/design-sessions/:sessionId

Auth: Admin API key or internal session
Response 200: DesignSessionAdminView (full projection)
Errors: 401, 404
```

### F3. Approve Session (Reviewer)
```
POST /api/ai/design-sessions/:sessionId/approve

Auth: Internal session, reviewer role
Request: { "notes": string | null }
Response 200: { "sessionId": string, "status": "approved" }
Errors: 400, 401, 403, 409
```

### F4. Reject Session (Reviewer)
```
POST /api/ai/design-sessions/:sessionId/reject

Auth: Internal session, reviewer role
Request: { "reason": string, "returnToStatus": "layout_in_progress" | "moodboard_ready" }
Response 200: { "sessionId": string, "status": string }
Errors: 400, 401, 403, 409
```

### F5. Place Furniture (Designer Override)
```
POST /api/ai/design-sessions/:sessionId/furniture-placements

Auth: Internal session, designer role
Idempotency: Yes
Request:
{
  "_v": "1.0",
  "variantId": string,
  "position": { "x": number, "y": number, "z": number },
  "rotation": number
}

Response 201: { "placementId": string, "validationStatus": string }
Errors: 400, 401, 403, 422 (constraint violation)
```

### F6. Remove Furniture Placement
```
DELETE /api/ai/design-sessions/:sessionId/furniture-placements/:placementId

Auth: Internal session, designer role
Response 200: { "placementId": string }
Errors: 401, 403, 404
```

### F7. Create Revision
```
POST /api/ai/design-sessions/:sessionId/revisions

Auth: Internal session
Request: { "notes": string | null, "triggeredBy": string }
Response 201: { "revisionId": string, "revisionNumber": number }
Errors: 401, 403, 404
```

---

## G. AI Composition Endpoints (Internal/Worker)

These endpoints are called by the AI agent orchestration layer — not exposed to customers directly.

### G1. Trigger Moodboard Generation
```
POST /api/ai/design-sessions/:sessionId/compose/moodboard

Auth: Admin API key (internal worker)
Request: { "styleInput": StyleInput }
Response 202: { "moodboardId": string, "jobId": string }
Errors: 401, 409
```

### G2. Trigger Layout Composition
```
POST /api/ai/design-sessions/:sessionId/compose/layout

Auth: Admin API key (internal worker)
Request: { "brief": DesignBrief, "agentConfig": AgentConfig }
Response 202: { "jobId": string }
Errors: 401, 409
```

### G3. Get Material Recommendations
```
GET /api/ai/design-sessions/:sessionId/material-recommendations

Auth: Admin API key or internal session
Query: surface: string, styleId: string
Response 200: { data: MaterialRecommendation[] }
Errors: 400, 401, 404
```

### G4. Get Cost Estimate
```
GET /api/ai/design-sessions/:sessionId/cost-estimate

Auth: Admin API key or workspace token (owner)
Response 200:
{
  "total": MoneyAmount,
  "furnitureTotal": MoneyAmount,
  "materialEstimate": MoneyAmount,
  "breakdown": CostLineItem[]
}
Errors: 401, 403, 404
```

---

## H. Metrics & Health

### H1. Platform Design Metrics
```
GET /api/ai/design-metrics

Auth: Admin API key
Query: from: ISO date, to: ISO date, tenantId?: string
Response 200:
{
  "totalSessions": number,
  "sessionsByStatus": Record<DesignSessionStatus, number>,
  "avgRevisionCount": number,
  "renderSuccessRate": number,
  "exportSuccessRate": number,
  "avgCompositionLatencyMs": number,
  "avgRenderLatencyMs": number
}
```

---

## Summary — Endpoint Count

| Group | Endpoints |
|---|---|
| A. Room Templates | 5 |
| B. Room Type / Style / Theme | 3 |
| C. Furniture Catalog | 5 |
| D. Decoration & Lighting | 2 |
| E. Customer Design Session | 9 |
| F. Designer / Admin Session | 7 |
| G. AI Composition (internal) | 4 |
| H. Metrics | 1 |
| **Total** | **36** |
