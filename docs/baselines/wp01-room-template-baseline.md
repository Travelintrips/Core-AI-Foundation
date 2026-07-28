# WP-01 Room Template Library — Baseline Snapshot

---

## Release Information

| Field | Value |
|---|---|
| Version | material-v6.0.0-wp01 |
| Commit SHA | 2286edfea27565c60737e905c32792295d537124 |
| Release Date | 2026-07-28 |
| Branch | main |
| Tag | `material-v6.0.0-wp01` (annotated) |

---

## Database

### Tables (WP-01 scope — 5 tables, all in `ai_platform` schema)

| Table | Primary Key | Description |
|---|---|---|
| `room_types` | UUID | Functional room taxonomy (bedroom, kitchen, etc.) |
| `room_styles` | UUID | Design style catalog (Minimalist Modern, Japandi, etc.) |
| `room_themes` | UUID | Curated theme bundles referencing styles |
| `layout_constraint_sets` | UUID | Layout rules per room type (FK → room_types) |
| `room_templates` | UUID | Composable design templates (FK → room_types, room_styles) |

### Indexes (WP-01 scope — 11 indexes)

| Index | Table | Column(s) |
|---|---|---|
| `idx_room_types_code` | room_types | code |
| `idx_room_styles_status` | room_styles | status |
| `idx_room_styles_slug` | room_styles | slug |
| `idx_room_themes_status` | room_themes | status |
| `idx_room_themes_slug` | room_themes | slug |
| `idx_layout_constraint_sets_room_type` | layout_constraint_sets | room_type_id |
| `idx_room_templates_room_type` | room_templates | room_type_id |
| `idx_room_templates_style` | room_templates | style_id (WHERE NOT NULL) |
| `idx_room_templates_status` | room_templates | status |
| `idx_room_templates_tenant` | room_templates | tenant_id (WHERE NOT NULL) |
| `idx_room_templates_slug` | room_templates | slug |

### Foreign Keys

| Table | Column | References | On Delete |
|---|---|---|---|
| layout_constraint_sets | room_type_id | room_types(id) | CASCADE |
| room_templates | room_type_id | room_types(id) | — |
| room_templates | style_id | room_styles(id) | — |

### RLS / FORCE RLS / Policies

RLS is not applied to WP-01 tables at the database level. Tenant isolation is enforced at the application layer:
- Platform-wide templates: `tenant_id IS NULL`
- Tenant-scoped templates: `tenant_id = <uuid>`
- Admin routes protected by `adminAuthWithExceptions` middleware
- Public routes declared as explicit exceptions in `adminAuth.ts` (`PUBLIC_ROUTE_RULES`)

---

## API Inventory

### Admin Endpoints (9 — require `x-admin-api-key` header)

| Method | Path | Purpose |
|---|---|---|
| GET | /api/ai/room-templates | List templates (filter by status, roomTypeId, search; paginated) |
| GET | /api/ai/room-templates/:id | Get single template by ID |
| POST | /api/ai/room-templates | Create new template (draft) |
| PATCH | /api/ai/room-templates/:id | Update template fields |
| POST | /api/ai/room-templates/:id/publish | Transition draft → published |
| POST | /api/ai/room-templates/:id/archive | Transition published/draft → archived |
| POST | /api/ai/room-templates/:id/restore | Transition archived → draft |
| POST | /api/ai/room-templates/:id/duplicate | Clone any template as new draft |
| POST | /api/ai/room-templates/seed | Seed catalog with starter data (idempotent) |

### Public Endpoints (5 — no auth required)

| Method | Path | Purpose |
|---|---|---|
| GET | /api/ai/room-types | List all room types (B1) |
| GET | /api/ai/room-styles | List room styles (filtered by status=active) (B2) |
| GET | /api/ai/room-themes | List room themes (B3) |
| GET | /api/ai/room-catalog/templates | Browse published templates (paginated, max 50/page) (C1) |
| GET | /api/ai/room-catalog/templates/:id | Get published template detail (returns 404 for non-published) (C2) |

**Total endpoints: 14**

---

## Frontend

### Admin (`artifacts/ai-platform`)

| Page | Route | Features |
|---|---|---|
| Room Templates List | `/admin/room-templates` | List, search, filter (room type/status), sort, paginate, create, archive, restore, duplicate, publish, navigate to detail |
| Room Template Detail | `/admin/room-templates/:id` | View detail, edit fields, status transitions, audit trail |

Navigation: Linked from main admin sidebar under the Interior Design section.

### Customer (`artifacts/customer-portal`)

| Page | Route | Features |
|---|---|---|
| Room Template Browser | `/room-templates` | Browse published templates, search, filter by room type & style, sort, paginate |
| Room Template Detail | `/room-templates/:id` | View template details (published only) |

Navigation: Public-facing; accessible without login.

---

## Seed Data

All seed operations use `ON CONFLICT DO NOTHING` — fully idempotent.

| Entity | Count | Status breakdown |
|---|---|---|
| Room Types | 8 | All active: living_room, bedroom, dining_room, kitchen, home_office, bathroom, terrace, garage |
| Room Styles | 20 | 18 active, 2 draft (French Country, Urban Industrial Loft) |
| Room Themes | 15 | 13 published, 2 draft (Entertainment Hub, Study & Focus) |
| Room Templates | 10 | 8 published, 2 draft (Coastal Terrace Lounge, Wabi-Sabi Minimalist Bedroom) |

Seed endpoint: `POST /api/ai/room-templates/seed` (admin-authenticated)

---

## Security

### Authentication
- Admin endpoints: `adminAuthWithExceptions` middleware validates `x-admin-api-key` HTTP header against `ADMIN_API_KEY` environment variable
- Public endpoints (B1–B3, C1–C2): declared in `PUBLIC_ROUTE_RULES` in `adminAuth.ts`; no credentials required

### Authorization
- All mutation endpoints (create, update, publish, archive, restore, duplicate, seed) are admin-only
- Public catalog endpoints (`/ai/room-catalog/*`) hard-code `status=published` — callers cannot retrieve drafts or archived templates

### Tenant Isolation
- Templates support optional `tenant_id` (UUID or NULL)
- `tenant_id = NULL` = platform-wide template (visible to all)
- `tenant_id = <uuid>` = scoped to a specific tenant
- Isolation enforced in service layer queries

### RLS Verification
RLS policies are not defined at the DB level for WP-01 tables. Access control is enforced entirely at the application layer via `adminAuthWithExceptions`. This is consistent with the existing platform pattern.

---

## Test Results

| Suite | Result |
|---|---|
| API Server build | ✅ PASS — esbuild compiled `dist/index.mjs` (7.9 MB) in < 1s, 0 errors |
| WP-01 targeted tests | ✅ PASS — 21/21 tests passed (534 ms) |
| Customer Portal typecheck | ✅ PASS — `tsc --noEmit` 0 errors |
| Admin Platform typecheck | ⚠️ PRE-EXISTING — 16 errors in non-WP-01 files (`service-detail.tsx`, `services.tsx`, `settings.tsx`, `workflow-executions.tsx`, `workflows.tsx`); caused by `lib/api-client-react` not yet compiled — unrelated to WP-01 |

### WP-01 Test Coverage (21 tests in `src/__tests__/room-templates.test.ts`)

| Test Group | Tests |
|---|---|
| Status transitions | publishRoomTemplate rejects non-draft; archiveRoomTemplate rejects archived; restoreRoomTemplate rejects non-archived; ServiceError carries correct status code (4) |
| createRoomTemplate validation | valid body accepted; empty name rejected; non-UUID roomTypeId rejected; negative dimensions rejected; optional slug accepted (5) |
| Route handler | GET /ai/room-types returns array; 404 for missing template; 409 maps to SLUG_CONFLICT; 201 on successful create (4) |
| Tenant isolation | platform template has null tenantId; tenant-scoped has UUID tenantId (2) |
| Seed idempotency | same slug seeded twice does not throw (1) |
| Authorization | B routes are GET /ai/; A routes require admin (2) |
| Pagination | hasNext calculated correctly; hasNext false on last page; pageSize clamped to 100 (3) |

---

## Performance

- API server build: ~775 ms (esbuild)
- Test suite duration: 534 ms (21 tests)
- No DB-level benchmark data available in this baseline (no live query profiling done)

---

## Known Limitations

1. `room_types.constraint_set_id` FK to `layout_constraint_sets` is deferred — it is intentionally not enforced as a real foreign key to avoid circular dependency. It will be set via `UPDATE` in WP-07.
2. Admin Platform typecheck has 16 pre-existing errors in non-WP-01 files (`lib/api-client-react` dist not built). These predate WP-01 and are not introduced by this work package.
3. `layout_constraint_sets` is structurally complete but has no seed data — rules population is deferred to WP-07 (Constraint Engine).
4. `room_templates.fixed_elements` JSONB column is seeded as empty arrays — actual fixed-element data depends on WP-02+ Furniture Library.
5. No RLS at DB level — tenant isolation is application-layer only.

---

## Explicitly Out Of Scope

- **Furniture Library** — WP-02
- **Placement Engine** — WP-03+
- **AI Composer** — WP-05+
- **Rendering** — WP-06+
- **Moodboard** — WP-08+
- **Export** — WP-09+
- **Design Sessions** — WP-04+
- **WP-02 and beyond** — not started
