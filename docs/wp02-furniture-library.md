# WP-02 — Furniture & Object Library

**Phase 6 · Baseline: `material-v6.0.1-wp01`**

## Architecture

WP-02 adds a standalone Furniture & Object Library to the interior-design
platform. It is strictly additive: it does not modify any WP-01 contract and
contains no placement, collision, layout, or AI-composition logic (all WP-03
scope).

```
┌─────────────────────────────────────────────────────────┐
│  Customer Portal                                        │
│  /furniture-catalog     /furniture-catalog/:id          │
└─────────────────────────────────────────────────────────┘
              │  GET (public)
┌─────────────────────────────────────────────────────────┐
│  API Server  /api/ai/furniture-catalog/*                │
│              /api/ai/furniture-library/*  (admin)       │
├────────────────────────┬────────────────────────────────┤
│  Routes layer          │  furnitureLibraryService.ts    │
│  furniture-library.ts  │  (business logic, validation)  │
└────────────────────────┴────────────────────────────────┘
              │  Drizzle ORM
┌─────────────────────────────────────────────────────────┐
│  Database  (ai_platform schema)                         │
│  furniture_categories   furniture_brands                │
│  furniture_collections  furniture_items                 │
│  furniture_assets       furniture_tags                  │
│  furniture_item_tags                                    │
└─────────────────────────────────────────────────────────┘
```

---

## Database

### Tables

| Table | PK | Key columns | Notes |
|---|---|---|---|
| `furniture_categories` | UUID | `code` (unique), `slug` (unique), `parent_id` | Hierarchical; self-referential `parent_id` |
| `furniture_brands` | UUID | `code` (unique), `slug` (unique) | |
| `furniture_collections` | UUID | `code` (unique), `slug` (unique), `brand_id` (FK) | |
| `furniture_items` | UUID | `code` (unique), `slug` (unique), `category_id`, `brand_id`, `collection_id` | Versioned, soft-deletable, tenant-scoped |
| `furniture_assets` | UUID | `furniture_item_id` (FK), `asset_type`, `sort_order` | Cascades on item delete |
| `furniture_tags` | UUID | `name` (unique), `slug` (unique) | |
| `furniture_item_tags` | (`furniture_item_id`, `tag_id`) | — | M:N join |

### Lifecycle states (furniture_items)

```
draft ──publish──▶ published ──archive──▶ archived
                                            │
                                      restore/▼
                                          draft
```

`deleted_at IS NOT NULL` means soft-deleted — excluded from all public and
admin listing by default (pass `include_deleted=true` as admin to see them).

### Versioning

`version` is incremented on every `publish` transition. The field is a simple
integer counter. Full revision history is not stored in this table; `logAudit`
records every mutation for audit purposes.

### Tenant Isolation

`tenant_id = NULL` means a platform-wide item visible to all consumers. A
non-null `tenant_id` scopes the item to a single tenant. RLS enforces this at
the DB layer; application-layer auth is the primary guard.

---

## Indexes

18 indexes cover: category/brand/collection FK lookups, status, deleted_at,
tenant_id, price_tier, style, furniture_type, and a partial index for the hot
path (`WHERE status='published' AND deleted_at IS NULL`). GIN indexes cover
array columns `primary_materials`, `colors`, and `search_keywords`.

---

## API

### Admin Endpoints (`/api/ai/furniture-library/*`)

All admin endpoints require the `ADMIN_API_KEY` or an active internal user
session cookie.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/ai/furniture-library/items` | List/search items (all statuses) |
| GET | `/ai/furniture-library/items/:id` | Get single item (includes assets + tags) |
| POST | `/ai/furniture-library/items` | Create item (starts as draft) |
| PATCH | `/ai/furniture-library/items/:id` | Update item |
| DELETE | `/ai/furniture-library/items/:id` | Soft-delete item |
| POST | `/ai/furniture-library/items/:id/publish` | Transition draft → published |
| POST | `/ai/furniture-library/items/:id/archive` | Transition published → archived |
| POST | `/ai/furniture-library/items/:id/restore` | Transition archived → draft |
| POST | `/ai/furniture-library/items/:id/duplicate` | Duplicate as new draft |
| GET | `/ai/furniture-library/items/:id/history` | Version history (audit log) |
| GET | `/ai/furniture-library/categories` | List categories |
| POST | `/ai/furniture-library/categories` | Create category |
| PATCH | `/ai/furniture-library/categories/:id` | Update category |
| DELETE | `/ai/furniture-library/categories/:id` | Delete category |
| GET | `/ai/furniture-library/brands` | List brands |
| POST | `/ai/furniture-library/brands` | Create brand |
| PATCH | `/ai/furniture-library/brands/:id` | Update brand |
| GET | `/ai/furniture-library/collections` | List collections |
| POST | `/ai/furniture-library/collections` | Create collection |
| PATCH | `/ai/furniture-library/collections/:id` | Update collection |
| GET | `/ai/furniture-library/tags` | List tags |
| POST | `/ai/furniture-library/tags` | Create tag |
| PATCH | `/ai/furniture-library/tags/:id` | Update tag |
| POST | `/ai/furniture-library/seed` | Seed catalog (idempotent) |

### Public Catalog Endpoints (`/api/ai/furniture-catalog/*`)

These are declared as public exceptions in `adminAuth.ts` — no admin key
required. They always enforce `status=published AND deleted_at IS NULL`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/ai/furniture-catalog/items` | Search published catalog |
| GET | `/ai/furniture-catalog/items/:id` | Item detail (published only) |
| GET | `/ai/furniture-catalog/categories` | Category tree |
| GET | `/ai/furniture-catalog/brands` | Active brands |
| GET | `/ai/furniture-catalog/collections` | Active collections |
| GET | `/ai/furniture-catalog/tags` | Tags |

### Query Parameters (list endpoints)

| Param | Type | Description |
|-------|------|-------------|
| `search` | string | Full-text search across name, description, type, keywords |
| `categoryId` | UUID | Filter by category |
| `brandId` | UUID | Filter by brand |
| `collectionId` | UUID | Filter by collection |
| `style` | string | Furniture style (e.g. Scandinavian) |
| `furnitureType` | string | Type (e.g. sofa, chair) |
| `priceTier` | budget\|mid\|premium\|luxury | Price tier filter |
| `status` | draft\|published\|archived | Admin only; ignored on public routes |
| `page` | integer ≥ 1 | Pagination (default: 1) |
| `pageSize` | integer 1–100 | Page size (default: 20) |
| `sortBy` | name\|created_at\|updated_at\|status | Sort column |
| `sortDir` | asc\|desc | Sort direction |

---

## Permissions

| Operation | Role |
|-----------|------|
| Admin CRUD (create, edit, delete, publish, archive, restore, duplicate, seed) | Admin API key or internal session |
| Public catalog read (published items, categories, brands, tags) | Anyone (no auth) |
| Admin list with `status=draft\|archived` or `include_deleted=true` | Admin only |

---

## RLS

See `scripts/migrations/rls-wp02-furniture-library.sql`.

- Catalog tables (categories, brands, collections, tags, assets, item_tags): `ENABLE RLS` + `allow_authenticated USING (true)` — service-role bypasses.
- `furniture_items`: `ENABLE + FORCE RLS` + `tenant_isolation` policy filtering on `app.current_tenant_id` session variable.

---

## Seed

`POST /api/ai/furniture-library/seed` is idempotent (uses `ON CONFLICT DO NOTHING`).

Seed counts: 12 categories, 8 brands, 10 collections, 6 tags, 20 furniture items.

---

## Search

Full-text search is implemented as `ILIKE` across `name`, `description`,
`furniture_type`, and `style`. Array columns `primary_materials`, `colors`, and
`search_keywords` are searchable via exact overlap. GIN indexes cover these
columns.

---

## Known Limitations

- Version history endpoint returns audit log entries only (no diff storage).
  Full diff-based revision history is WP-03 scope.
- `dimensions` is a JSONB blob; no per-axis DB-level constraints.
- `furniture_item_tags` join table has no `updated_at` (created_at only).
- `furniture_assets` URL validation is done at the application layer only.

---

## Explicit WP-03 Exclusions

The following are intentionally NOT implemented in WP-02:

- Placement engine
- Collision detection
- Layout engine
- AI composition
- 3D rendering or viewer
- Moodboard integration
- Design session integration
- Export pipeline
- Optimization engine

Any downstream work depending on `furniture_items` data for placement or
rendering belongs entirely in WP-03.
