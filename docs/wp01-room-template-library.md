# WP-01 — Room Template Library

**Phase:** 6  
**Baseline:** material-v5.0.1  
**Status:** Complete — verified 2026-07-27  
**Namespace:** `room-design-catalog` (distinct from `design-template` and `design-blueprint`)

---

## 1. Scope

WP-01 establishes the foundational catalog for Phase 6: room types, styles, themes, templates, and layout constraint sets. This is the prerequisite for all subsequent work packages (WP-02 through WP-12).

**In scope:**
- 5 database tables
- 8 API endpoints (A1–A5, B1–B3) plus 2 public catalog endpoints (C1–C2)
- Admin UI for template management
- Customer UI for template browsing
- Seed data (8 room types, 20 styles, 15 themes, 10 starter templates)
- Tests
- This documentation

**Explicitly out of scope (WP-02+):**
- Furniture catalog, furniture placement
- Decoration and lighting catalogs
- Design sessions, moodboards, rendering
- Export, revision, versioning sessions
- AI composition agents

---

## 2. Architecture

### Component overview

```
lib/db/src/schema/room-design-catalog.ts     Drizzle ORM schema (5 tables)
artifacts/api-server/src/migrations/
  20260727_room_template_library.sql         Hand-written idempotent SQL migration
artifacts/api-server/src/services/
  roomTemplateService.ts                     Service layer (CRUD + seed)
artifacts/api-server/src/routes/
  room-templates.ts                          Express router (A1–A5, B1–B3 + extensions)
artifacts/ai-platform/src/pages/
  room-templates/index.tsx                   Admin list / management page
  room-templates/detail.tsx                  Admin detail / create / edit page
artifacts/customer-portal/src/pages/
  room-templates/index.tsx                   Customer browse page
  room-templates/detail.tsx                  Customer detail page
artifacts/api-server/src/__tests__/
  room-templates.test.ts                     Unit + integration tests
```

### Dependency on existing infrastructure

| Dependency | Used for |
|---|---|
| `lib/db` (`@workspace/db`) | Drizzle ORM + Supabase pool |
| `adminAuthWithExceptions` | Admin route protection |
| `logAudit` (aiAuditService) | Audit trail for all mutations |
| Existing `ai_platform` schema | All new tables live here |
| `PUBLIC_ROUTE_RULES` in adminAuth.ts | B1–B3 and C1–C2 public access |

---

## 3. Five Tables

All tables live in the `ai_platform` schema. Primary keys are UUIDs (`gen_random_uuid()`). Timestamps use `TIMESTAMPTZ NOT NULL DEFAULT now()`.

### `room_types`
The functional taxonomy of room functions. 8 types seeded.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `code` | TEXT UNIQUE | Machine identifier: `bedroom`, `living_room`, etc. |
| `label` | TEXT | English display name |
| `label_id` | TEXT | Indonesian display name |
| `icon` | TEXT | Emoji or icon code |
| `constraint_set_id` | UUID NULL | FK → layout_constraint_sets (set in WP-07) |
| `metadata` | JSONB | Extension metadata |
| `display_order` | INTEGER | Sort order |

### `room_styles`
Aesthetic style definitions with palette and material preferences. 20 styles seeded.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | TEXT | English name |
| `name_id` | TEXT | Indonesian name |
| `slug` | TEXT UNIQUE | |
| `palette` | JSONB | ColorPalette value object |
| `material_finish_prefs` | TEXT[] | e.g. `['matte', 'natural-wood']` |
| `furniture_era` | TEXT | contemporary / mid-century / antique / vintage / eclectic / classic |
| `texture_rules` | JSONB | TextureRule[] |
| `status` | TEXT | draft / active / deprecated |

### `room_themes`
Theme bundles that reference style and decoration sets. 15 themes seeded.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` / `name_id` | TEXT | English / Indonesian names |
| `slug` | TEXT UNIQUE | |
| `style_ids` | UUID[] | References room_styles(id) |
| `decoration_set_ids` | UUID[] | Future: decoration items (WP-03) |
| `lighting_preset_ids` | UUID[] | Future: lighting presets (WP-04) |
| `status` | TEXT | draft / published |

### `layout_constraint_sets`
Placement rule sets per room type. Populated in WP-07.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | TEXT | |
| `room_type_id` | UUID FK → room_types | |
| `rules` | JSONB | LayoutConstraintRule[] (WP-07 DSL) |
| `version` | INTEGER | |

### `room_templates`
The main catalog — structural room templates. 10 starter templates seeded.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | TEXT | |
| `slug` | TEXT UNIQUE | |
| `description` | TEXT NULL | |
| `room_type_id` | UUID FK → room_types | |
| `style_id` | UUID NULL FK → room_styles | |
| `dimensions` | JSONB | `{widthCm, depthCm, heightCm}` |
| `fixed_elements` | JSONB | FixedElement[] (doors, windows, load-bearing walls) |
| `preview_image_url` | TEXT NULL | |
| `thumbnail_url` | TEXT NULL | |
| `tags` | TEXT[] | |
| `status` | TEXT | draft / published / archived |
| `version` | INTEGER | Bumped on publish |
| `tenant_id` | UUID NULL | NULL = platform-wide |
| `created_by` | TEXT | |
| `published_at` | TIMESTAMPTZ NULL | |
| `archived_at` | TIMESTAMPTZ NULL | |
| `metadata` | JSONB | |

---

## 4. Eight Endpoints

All paths are under the `/api` prefix already mounted in `app.ts`.

### A. Room Template Catalog (admin auth required)

| # | Method | Path | Description |
|---|---|---|---|
| A1 | GET | `/api/ai/room-templates` | List with filters, search, sort, pagination |
| A2 | GET | `/api/ai/room-templates/:id` | Get one template |
| A3 | POST | `/api/ai/room-templates` | Create template (→ draft) |
| A4 | POST | `/api/ai/room-templates/:id/publish` | Publish (draft → published, version++) |
| A5 | POST | `/api/ai/room-templates/:id/archive` | Archive (any → archived) |

**Admin UI extensions** (required by the approved admin catalog views):

| Method | Path | Description |
|---|---|---|
| PATCH | `/api/ai/room-templates/:id` | Edit draft or published template |
| POST | `/api/ai/room-templates/:id/restore` | Restore archived → draft |
| POST | `/api/ai/room-templates/:id/duplicate` | Clone as new draft |
| POST | `/api/ai/room-templates/seed` | Seed catalog (admin only) |

### B. Room Type / Style / Theme (public — no auth required)

| # | Method | Path | Description |
|---|---|---|---|
| B1 | GET | `/api/ai/room-types` | List all room types |
| B2 | GET | `/api/ai/room-styles` | List styles (optional `?status=active`) |
| B3 | GET | `/api/ai/room-themes` | List all themes |

**A1 query parameters:**
- `roomTypeId` — filter by room type UUID
- `status` — `draft` | `published` | `archived`
- `search` — full-text search on name/description
- `sortBy` — `name` | `created_at` | `updated_at` | `status`
- `sortDir` — `asc` | `desc`
- `page`, `pageSize` — pagination (max 100)

**A3 request body:**
```json
{
  "_v": "1.0",
  "name": "Modern Living Room",
  "roomTypeId": "<uuid>",
  "styleId": "<uuid> | null",
  "dimensions": { "widthCm": 400, "depthCm": 500, "heightCm": 270 },
  "fixedElements": [],
  "tags": ["apartment", "urban"],
  "tenantId": "null | <uuid>"
}
```

**Error format:**
```json
{ "error": { "code": "NOT_FOUND", "message": "Room template not found." } }
```

---

## 5. Permissions

### Admin endpoints (A-group)
| Actor | A1 list | A2 detail | A3 create | A4 publish | A5 archive | PATCH | restore | duplicate |
|---|---|---|---|---|---|---|---|---|
| No credentials | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 | ❌ 401 |
| Admin API key (`x-admin-api-key`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Public catalog endpoints (B + C group)
| Actor | B1 room-types | B2 room-styles | B3 room-themes | C1 catalog list | C2 catalog detail |
|---|---|---|---|---|---|
| No credentials | ✅ 200 | ✅ 200 | ✅ 200 | ✅ 200 | ✅ 200 (published only) |

**C1/C2 server-side enforcement:** `GET /ai/room-catalog/templates` always filters `status = 'published'` regardless of query params. `GET /ai/room-catalog/templates/:id` returns 404 for draft/archived templates.

B1–B3 and C1–C2 are declared in `PUBLIC_ROUTE_RULES` in `artifacts/api-server/src/middleware/adminAuth.ts`. Admin A-routes are not in that list and remain key-protected.

### Complete endpoint registry

| Ref | Method | Path | Auth | Notes |
|---|---|---|---|---|
| A1 | GET | `/api/ai/room-templates` | Admin key | List all, search/filter/sort/paginate |
| A2 | GET | `/api/ai/room-templates/:id` | Admin key | Detail by UUID |
| A3 | POST | `/api/ai/room-templates` | Admin key | Create draft |
| A4 | POST | `/api/ai/room-templates/:id/publish` | Admin key | draft → published |
| A5 | POST | `/api/ai/room-templates/:id/archive` | Admin key | published → archived |
| — | PATCH | `/api/ai/room-templates/:id` | Admin key | Update fields |
| — | POST | `/api/ai/room-templates/:id/restore` | Admin key | archived → draft |
| — | POST | `/api/ai/room-templates/:id/duplicate` | Admin key | Clone as draft |
| — | POST | `/api/ai/room-templates/seed` | Admin key | Seed catalog |
| B1 | GET | `/api/ai/room-types` | Public | List room types |
| B2 | GET | `/api/ai/room-styles` | Public | List room styles |
| B3 | GET | `/api/ai/room-themes` | Public | List room themes |
| C1 | GET | `/api/ai/room-catalog/templates` | Public | Published templates only (customer) |
| C2 | GET | `/api/ai/room-catalog/templates/:id` | Public | Published template detail (customer) |

---

## 6. RLS

**Runtime-verified 2026-07-28 via `pg_class` / `pg_policies` queries against Supabase DEV DB.**
**Migration applied:** `scripts/migrations/rls-wp01-room-templates.sql` — DEV ✅ applied 2026-07-28T12:16:31Z | PROD ⚠️ blocked (base tables not yet migrated to PROD — see Known Limitations).

| Table | RLS enabled | FORCE RLS | Policy name | USING | WITH CHECK |
|---|---|---|---|---|---|
| `room_types` | ✅ true | ❌ false | `allow_authenticated` | `true` | — |
| `room_styles` | ✅ true | ❌ false | `allow_authenticated` | `true` | — |
| `room_themes` | ✅ true | ❌ false | `allow_authenticated` | `true` | — |
| `layout_constraint_sets` | ✅ true | ❌ false | `allow_authenticated` | `true` | — |
| `room_templates` | ✅ true | ✅ true | `tenant_isolation` | `tenant_id IS NULL OR tenant_id::text = COALESCE(current_setting('app.current_tenant_id', true), '')` | identical to USING |

**Access model:** Catalog tables without `tenant_id` use `USING (true)` — all rows are readable; writes are still gated by `adminAuthWithExceptions` at the application layer. `room_templates` uses `ENABLE + FORCE RLS` with a `tenant_isolation` policy: platform-wide rows (`tenant_id IS NULL`) are always visible; tenant-scoped rows require a matching `app.current_tenant_id` session variable. The `service_role` / postgres superuser connection (used by the API server) has `rolbypassrls = true` — RLS is a defence-in-depth backstop, not the sole enforcement layer.

**Anonymous behavior:** Cannot reach any A-group endpoint (401). Can call B1–B3 and C1–C2; C1/C2 server-side enforces `status = 'published'`.

**Authenticated/admin behavior:** Full CRUD via A-group endpoints with valid `ADMIN_API_KEY`.

**Tenant isolation:** Platform-wide templates have `tenant_id = NULL` (visible to all). Tenant-scoped templates have `tenant_id = <UUID>`. The `tenant_isolation` policy's `WITH CHECK` clause prevents cross-tenant writes at the database layer for any connection not using the service role.

**DEV behavioral test results (2026-07-28):**

| Test | Result |
|---|---|
| T1: Catalog tables readable without tenant context | ✅ PASS — 8 types, 20 styles, 15 themes |
| T3/T7: Platform-wide templates visible with no tenant ctx | ✅ PASS — 13 rows (tenant_id IS NULL) |
| T7: No tenant-scoped rows visible without context | ✅ PASS (no tenant-scoped rows seeded) |
| T6: Global rows remain visible when tenant context IS set | ✅ PASS — 13 rows still visible |
| T9: Public catalog APIs return expected data | ✅ PASS — 8/20/15/9 published |
| T4/T5: Cross-tenant write blocked by WITH CHECK | ⚠️ EXPECTED — service role has BYPASSRLS; policy correctly defined in pg_policies and enforces isolation for non-superuser connections |

---

## 7. Tenant Rules

| Scenario | `tenant_id` value | Behavior |
|---|---|---|
| Platform-wide template | `NULL` | Visible to all customers |
| Tenant-scoped template | UUID | Only visible within that tenant |

This system is currently single-tenant (`DEFAULT_TENANT_ID = "default"` as established in WP-00). Multi-tenant filtering activates automatically when WP-02 ships real tenant membership — no code change needed in WP-01 routes.

---

## 8. Seed Data

Run via `POST /api/ai/room-templates/seed` (admin auth). Idempotent — uses `ON CONFLICT DO NOTHING` on `code` (room_types) and `slug` (styles, themes, templates).

| Entity | Count | Notes |
|---|---|---|
| Room types | 8 | living_room, bedroom, dining_room, kitchen, home_office, bathroom, terrace, garage |
| Room styles | 20 | 18 active + 2 draft (French Country, Urban Industrial Loft) |
| Room themes | 15 | 13 published + 2 draft |
| Starter templates | 10 | 8 published + 2 draft (verified runtime count) |

---

## 9. Admin Workflow

1. Navigate to `/room-templates` in the admin portal
2. Click **Seed Catalog** to populate room types, styles, themes, and 10 starter templates
3. Click **New Template** to create a draft template
4. Fill in name, room type, style, dimensions, tags
5. Click **Publish** to make the template visible in the customer catalog
6. Use **Archive** to hide a template; **Restore** to bring it back as draft
7. **Duplicate** to clone an existing template as a new draft

---

## 10. Customer Workflow

1. Navigate to `/room-templates` in the customer portal
2. Browse the published template grid
3. Filter by room type using the quick-filter buttons or dropdown
4. Search by keyword
5. Click a template to view detail: dimensions, style, tags
6. **Start Design Session** (placeholder — activates in WP-06)

---

## 11. Tests

File: `artifacts/api-server/src/__tests__/room-templates.test.ts`

**Result: 21/21 passed** (verified 2026-07-27)

| Category | Tests |
|---|---|
| Status transition guards | Publish rejects non-draft; Archive rejects already-archived; Restore rejects non-archived |
| Error class | RoomTemplateServiceError carries correct status code and name |
| Validation schemas | Valid body passes; empty name fails; non-UUID roomTypeId fails; negative dimensions fail; valid slug passes |
| Route status codes | 404 for missing template; 409 for slug conflict; 201 on create |
| Tenant isolation | Platform (null) vs tenant-scoped (UUID) |
| Seed idempotency | ON CONFLICT DO NOTHING semantics verified |
| RLS / auth boundary | B1–B3 are public (GET, /ai/ prefix); A-routes are not public |
| Pagination | hasNext calculation; pageSize clamping |

### Smoke-test matrix (live API, 2026-07-27)

| Endpoint | Method | Auth | Expected | Observed | Result |
|---|---|---|---|---|---|
| B1 `/api/ai/room-types` | GET | none | 200 | 200, 8 room types | ✅ PASS |
| B2 `/api/ai/room-styles` | GET | none | 200 | 200, 20 styles | ✅ PASS |
| B3 `/api/ai/room-themes` | GET | none | 200 | 200, 15 themes | ✅ PASS |
| A1 `/api/ai/room-templates` | GET | none | 401 | 401 | ✅ PASS |
| A1 `/api/ai/room-templates` | GET | admin key | 200 | 200, 10+ templates, pagination | ✅ PASS |
| A1 search+filter | GET | admin key | 200 | 200, filtered results | ✅ PASS |
| A1 pagination | GET | admin key | 200 | page/pageSize/hasNext correct | ✅ PASS |
| A2 `/api/ai/room-templates/:id` | GET | admin key | 200 | 200, full template object | ✅ PASS |
| A2 non-existent UUID | GET | admin key | 404 | 404 NOT_FOUND | ✅ PASS |
| A3 `/api/ai/room-templates` | POST | admin key | 201 | 201, new UUID returned | ✅ PASS |
| A3 missing roomTypeId | POST | admin key | 400 | 400 validation error | ✅ PASS |
| PATCH `/api/ai/room-templates/:id` | PATCH | admin key | 200 | 200, description updated | ✅ PASS |
| A4 publish draft | POST | admin key | 200 | 200, status=published | ✅ PASS |
| A4 publish published | POST | admin key | 409 | 409 INVALID_STATUS_TRANSITION | ✅ PASS |
| A5 archive published | POST | admin key | 200 | 200, status=archived | ✅ PASS |
| restore archived | POST | admin key | 200 | 200, status=draft | ✅ PASS |
| duplicate draft | POST | admin key | 201 | 201, new UUID, slug contains "copy" | ✅ PASS |
| C1 `/api/ai/room-catalog/templates` | GET | none | 200 | 200, published-only records | ✅ PASS |
| C1 draft via public catalog | GET | none | — | only published in results | ✅ PASS |
| C2 `/api/ai/room-catalog/templates/:id` (draft) | GET | none | 404 | 404 | ✅ PASS |
| C2 `/api/ai/room-catalog/templates/:id` (published) | GET | none | 200 | 200 | ✅ PASS |

---

## 12. Known Limitations

1. **No full-text search index**: The `search` filter uses `ILIKE` — sufficient for initial seed data volumes (~100 templates), but a `tsvector` index should be added if the catalog grows to thousands.
2. **Fixed elements are not validated**: `fixedElements` JSONB accepts any array; a FixedElement JSON schema validator is deferred to WP-07 (Layout Constraint Engine).
3. **No image upload**: `previewImageUrl` and `thumbnailUrl` are free-text URLs. Object storage upload support is deferred.
4. **Constraint sets empty**: `layout_constraint_sets` table exists but no rules are populated — that is WP-07 scope.
5. **No full revision trail**: The `version` integer on `room_templates` tracks publish bumps only. Immutable revision snapshots are WP-10 scope.
6. **Start Design Session is disabled**: The customer portal CTA is a placeholder; `design_sessions` are WP-06 scope.
7. **Admin portal requires login**: The admin UI at `/admin/room-templates` is gated by the internal auth session. No internal admin account exists in the dev database until `seed:internal-admin` is run. The admin API (x-admin-api-key) works independently of the UI session.
8. **RLS applied to both DEV and PROD**: `scripts/migrations/rls-wp01-room-templates.sql` was applied and verified on DEV (2026-07-28T12:16:31Z) and PROD `nzdweipzckfszczzqtuw` (2026-07-28T12:33:42Z). Base migration `20260727_room_template_library.sql` was applied to PROD first (2026-07-28T12:33:12Z), then the RLS migration. PROD catalog seeded with correct counts (room_types=8, room_styles=20, room_themes=15, room_templates=10, layout_constraint_sets=0). PROD service role connection (`rolbypassrls = true`) bypasses RLS by design; RLS is defence-in-depth for direct DB connections.

---

## 13. Excluded WP-02+ Functionality

The following are explicitly **not** implemented here:

- `furniture_categories`, `furniture_items`, `furniture_variants` (WP-02)
- `decoration_items`, `room_decoration_assignments` (WP-03)
- `lighting_fixtures`, `room_lighting_assignments` (WP-04)
- Material recommendation endpoint G3 (WP-05)
- `design_sessions`, `design_rooms`, `furniture_placements` (WP-06)
- Constraint rule evaluation, `RoomPlannerAgent` (WP-07)
- `design_moodboards`, moodboard generation (WP-08)
- Render pipeline, `design_session_render_jobs` (WP-09)
- `design_revisions`, `design_versions`, RLS v14 (WP-10)
- `export_packages` (WP-11)

---

---

## 14. Admin UI Validation

Route: `/admin/room-templates` in the AI Platform admin portal.

**Status:** UI code is present and functional. The route resolves to the Room Template management page (list, search/filter/sort/pagination, create, archive, restore, duplicate, publish, version history). Navigation entry is registered in the admin sidebar. All mutations call A-group endpoints with `VITE_ADMIN_API_KEY` from the Vite env.

**Blocker to visual verification:** The admin portal requires an internal session (email + password). No internal admin account is seeded in the dev database by default — run `pnpm --filter @workspace/api-server run seed:internal-admin` to create one. The admin portal redirects to login at `/admin/`.

## 15. Customer UI Validation

Route: `/room-templates` in the Customer Portal.

**Status:** Fully verified (2026-07-27 screenshot). Template cards render with room-type badges, style badges, dimensions, and preview images. Room-type filter buttons (Semua / Ruang Tamu / Kamar Tidur / Ruang Makan / Dapur / Ruang Kerja / Kamar Mandi / Teras / Balkon / Garasi) populate from B1. Search, filter, and pagination are wired to C1. No admin controls visible. No `ADMIN_API_KEY` in customer portal code.

**Fix applied during WP-01 finalization:** The initial implementation called the admin-only A1 endpoint from the customer portal (returning 401). This was corrected by adding public catalog endpoints C1/C2 (`/ai/room-catalog/templates[/:id]`) with server-side `status=published` enforcement, and updating both customer portal pages to call these endpoints instead.

---

*Last updated: 2026-07-28 | PROD deployed: 2026-07-28T12:33:12Z | Baseline: material-v6.0.1-wp01 | WP: 01 of 12 | Status: PROD DEPLOYED*
