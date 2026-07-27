# Phase 6 — Database Blueprint

**Version:** 1.0.0  
**Baseline:** `material-v5.0.1`  
**Status:** Architecture only — do NOT create migrations  
**Schema:** All new tables in `ai_platform` schema (existing convention)

---

## 1. Principles

- **Additive only**: No changes to any existing Phase 5 table.
- **FK references**: New tables reference `materials.id`, `creative_render_sessions.id`, `ai_jobs.id`, `customer_profiles.id` from the existing schema.
- **Soft deletes**: All catalog tables use `status` column; no physical DELETE.
- **Timestamps**: All tables carry `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` and `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
- **UUIDs**: All primary keys use `UUID DEFAULT gen_random_uuid()`.
- **Search path**: Raw SQL must `SET search_path TO ai_platform, public;` before any DML.
- **Drizzle schema**: New Drizzle definitions in `lib/db/src/schema/` as separate files per domain (e.g., `room-design.ts`, `furniture-catalog.ts`).

---

## 2. Catalog Tables

### `room_types`
```sql
CREATE TABLE ai_platform.room_types (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,           -- 'bedroom', 'living_room', etc.
  label         TEXT NOT NULL,
  constraint_set_id UUID NULL,                  -- FK → layout_constraint_sets
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `room_styles`
```sql
CREATE TABLE ai_platform.room_styles (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  palette                JSONB NOT NULL DEFAULT '{}',   -- ColorPalette value object
  material_finish_prefs  TEXT[] NOT NULL DEFAULT '{}',
  furniture_era          TEXT NOT NULL DEFAULT 'contemporary',
  texture_rules          JSONB NOT NULL DEFAULT '[]',
  status                 TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'deprecated')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `room_themes`
```sql
CREATE TABLE ai_platform.room_themes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  style_ids         UUID[] NOT NULL DEFAULT '{}',
  decoration_set_ids UUID[] NOT NULL DEFAULT '{}',
  lighting_preset_ids UUID[] NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `room_templates`
```sql
CREATE TABLE ai_platform.room_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  room_type_id     UUID NOT NULL REFERENCES ai_platform.room_types(id),
  style_id         UUID NULL REFERENCES ai_platform.room_styles(id),
  dimensions       JSONB NOT NULL,               -- RoomDimensions value object
  fixed_elements   JSONB NOT NULL DEFAULT '[]',  -- FixedElement[]
  preview_image_url TEXT NULL,
  thumbnail_url     TEXT NULL,
  status           TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  version          INTEGER NOT NULL DEFAULT 1,
  tenant_id        UUID NULL,                    -- NULL = platform-wide
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
**Indexes:**
```sql
CREATE INDEX idx_room_templates_room_type  ON ai_platform.room_templates(room_type_id);
CREATE INDEX idx_room_templates_status     ON ai_platform.room_templates(status);
CREATE INDEX idx_room_templates_tenant     ON ai_platform.room_templates(tenant_id) WHERE tenant_id IS NOT NULL;
```

### `furniture_categories`
```sql
CREATE TABLE ai_platform.furniture_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  parent_id   UUID NULL REFERENCES ai_platform.furniture_categories(id),
  depth       INTEGER NOT NULL DEFAULT 0,
  room_type_ids UUID[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `furniture_items`
```sql
CREATE TABLE ai_platform.furniture_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  category_id     UUID NOT NULL REFERENCES ai_platform.furniture_categories(id),
  dimensions      JSONB NOT NULL,               -- PhysicalDimensions
  weight_kg       NUMERIC(8,2) NULL,
  model_url       TEXT NULL,
  surface_list    TEXT[] NOT NULL DEFAULT '{}',
  placement_rules JSONB NOT NULL DEFAULT '[]',  -- PlacementRule[]
  search_vector   TSVECTOR NULL,                -- generated full-text vector
  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'discontinued')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
**Indexes:**
```sql
CREATE INDEX idx_furniture_items_category   ON ai_platform.furniture_items(category_id);
CREATE INDEX idx_furniture_items_status     ON ai_platform.furniture_items(status);
CREATE INDEX idx_furniture_items_fts        ON ai_platform.furniture_items USING GIN(search_vector);
```

### `furniture_variants`
```sql
CREATE TABLE ai_platform.furniture_variants (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  furniture_id       UUID NOT NULL REFERENCES ai_platform.furniture_items(id) ON DELETE CASCADE,
  sku                TEXT NOT NULL UNIQUE,
  color_name         TEXT NOT NULL,
  finish_code        TEXT NOT NULL,
  dimension_override JSONB NULL,
  price_amount       NUMERIC(12,2) NOT NULL,
  price_currency     CHAR(3) NOT NULL DEFAULT 'IDR',
  lead_time_days     INTEGER NULL,
  supplier_code      TEXT NULL,
  thumbnail_url      TEXT NULL,
  status             TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'discontinued')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
**Indexes:**
```sql
CREATE INDEX idx_furniture_variants_furniture ON ai_platform.furniture_variants(furniture_id);
CREATE INDEX idx_furniture_variants_status    ON ai_platform.furniture_variants(status);
```

### `decoration_items`
```sql
CREATE TABLE ai_platform.decoration_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  decoration_type  TEXT NOT NULL
    CHECK (decoration_type IN ('art','plant','rug','cushion','curtain','mirror','accessory')),
  thumbnail_url    TEXT NOT NULL,
  style_ids        UUID[] NOT NULL DEFAULT '{}',
  theme_ids        UUID[] NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `lighting_fixtures`
```sql
CREATE TABLE ai_platform.lighting_fixtures (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  fixture_type        TEXT NOT NULL
    CHECK (fixture_type IN ('ceiling','pendant','floor','table','wall','recessed','strip')),
  lumen_output        INTEGER NOT NULL,
  color_temperature_k INTEGER NOT NULL,
  beam_angle_deg      NUMERIC(5,2) NULL,
  mounting_type       TEXT NOT NULL,
  dimensions          JSONB NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'discontinued')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `layout_constraint_sets`
```sql
CREATE TABLE ai_platform.layout_constraint_sets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  room_type_id UUID NOT NULL REFERENCES ai_platform.room_types(id),
  rules       JSONB NOT NULL DEFAULT '[]',  -- LayoutConstraintRule[]
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 3. Session Tables

### `design_sessions`
```sql
CREATE TABLE ai_platform.design_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profile_id  UUID NOT NULL,    -- FK → customer_profiles (Phase 5)
  tenant_id            UUID NOT NULL,
  template_id          UUID NULL REFERENCES ai_platform.room_templates(id),
  room_type_id         UUID NOT NULL REFERENCES ai_platform.room_types(id),
  brief                JSONB NOT NULL,   -- DesignBrief value object
  status               TEXT NOT NULL DEFAULT 'brief_submitted'
    CHECK (status IN (
      'brief_submitted','moodboard_generating','moodboard_ready',
      'layout_in_progress','render_requested','render_ready',
      'in_review','approved','exporting','exported','archived'
    )),
  current_version_id   UUID NULL,
  active_render_job_id UUID NULL,        -- FK → ai_jobs (Phase 5)
  estimated_cost       JSONB NULL,       -- MoneyAmount
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
**Indexes:**
```sql
CREATE INDEX idx_design_sessions_customer ON ai_platform.design_sessions(customer_profile_id);
CREATE INDEX idx_design_sessions_tenant   ON ai_platform.design_sessions(tenant_id);
CREATE INDEX idx_design_sessions_status   ON ai_platform.design_sessions(status);
CREATE INDEX idx_design_sessions_template ON ai_platform.design_sessions(template_id) WHERE template_id IS NOT NULL;
```

### `design_rooms`
```sql
CREATE TABLE ai_platform.design_rooms (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL REFERENCES ai_platform.design_sessions(id) ON DELETE CASCADE,
  dimensions     JSONB NOT NULL,
  orientation    TEXT NULL CHECK (orientation IN ('north','south','east','west')),
  fixed_elements JSONB NOT NULL DEFAULT '[]',
  -- Material surface assignments (FK → materials from Phase 5)
  floor_material_id   UUID NULL,
  wall_material_id    UUID NULL,
  ceiling_material_id UUID NULL,
  snapshot_at    TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id)
);
```

### `furniture_placements`
```sql
CREATE TABLE ai_platform.furniture_placements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id           UUID NOT NULL REFERENCES ai_platform.design_rooms(id) ON DELETE CASCADE,
  variant_id        UUID NOT NULL REFERENCES ai_platform.furniture_variants(id),
  position          JSONB NOT NULL,                -- Vector3D {x,y,z}
  rotation_deg      NUMERIC(6,2) NOT NULL DEFAULT 0,
  validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending','valid','constraint_violation','accepted')),
  violation_codes   TEXT[] NOT NULL DEFAULT '{}',
  placed_by         TEXT NOT NULL DEFAULT 'ai'
    CHECK (placed_by IN ('ai','designer','customer')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
**Indexes:**
```sql
CREATE INDEX idx_furniture_placements_room    ON ai_platform.furniture_placements(room_id);
CREATE INDEX idx_furniture_placements_variant ON ai_platform.furniture_placements(variant_id);
```

### `room_decoration_assignments`
```sql
CREATE TABLE ai_platform.room_decoration_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID NOT NULL REFERENCES ai_platform.design_rooms(id) ON DELETE CASCADE,
  decoration_id UUID NOT NULL REFERENCES ai_platform.decoration_items(id),
  position      JSONB NOT NULL,   -- Vector3D
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_decoration_asgn_room ON ai_platform.room_decoration_assignments(room_id);
```

### `room_lighting_assignments`
```sql
CREATE TABLE ai_platform.room_lighting_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES ai_platform.design_rooms(id) ON DELETE CASCADE,
  fixture_id  UUID NOT NULL REFERENCES ai_platform.lighting_fixtures(id),
  position    JSONB NOT NULL,   -- Vector3D
  intensity   NUMERIC(5,2) NULL DEFAULT 1.0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lighting_asgn_room ON ai_platform.room_lighting_assignments(room_id);
```

### `design_moodboards`
```sql
CREATE TABLE ai_platform.design_moodboards (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL REFERENCES ai_platform.design_sessions(id) ON DELETE CASCADE,
  theme_id            UUID NULL REFERENCES ai_platform.room_themes(id),
  style_id            UUID NULL REFERENCES ai_platform.room_styles(id),
  reference_image_urls TEXT[] NOT NULL DEFAULT '{}',
  palette_swatches    JSONB NOT NULL DEFAULT '[]',
  furniture_previews  TEXT[] NOT NULL DEFAULT '{}',
  style_keywords      TEXT[] NOT NULL DEFAULT '{}',
  generated_image_url TEXT NULL,
  quality_score       INTEGER NULL CHECK (quality_score BETWEEN 0 AND 100),
  status              TEXT NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating','ready','approved','rejected')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_moodboards_session ON ai_platform.design_moodboards(session_id);
```

### `design_revisions`
```sql
CREATE TABLE ai_platform.design_revisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES ai_platform.design_sessions(id) ON DELETE CASCADE,
  version_id      UUID NOT NULL,
  revision_number INTEGER NOT NULL,
  room_snapshot   JSONB NOT NULL,    -- RoomSnapshot value object (immutable)
  triggered_by    TEXT NOT NULL
    CHECK (triggered_by IN ('customer_feedback','designer_action','ai_recompose','system')),
  notes           TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- immutable: no updated_at
  UNIQUE (session_id, revision_number)
);
CREATE INDEX idx_revisions_session ON ai_platform.design_revisions(session_id);
CREATE INDEX idx_revisions_version ON ai_platform.design_revisions(version_id);
```

### `design_versions`
```sql
CREATE TABLE ai_platform.design_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES ai_platform.design_sessions(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','named','locked')),
  revision_ids UUID[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_versions_session ON ai_platform.design_versions(session_id);
```

### `export_packages`
```sql
CREATE TABLE ai_platform.export_packages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            UUID NOT NULL REFERENCES ai_platform.design_sessions(id) ON DELETE CASCADE,
  include_spec_pdf      BOOLEAN NOT NULL DEFAULT true,
  include_material_list BOOLEAN NOT NULL DEFAULT true,
  include_furniture_list BOOLEAN NOT NULL DEFAULT true,
  include_moodboard     BOOLEAN NOT NULL DEFAULT true,
  include_3d_model      BOOLEAN NOT NULL DEFAULT false,
  storage_object_key    TEXT NULL,
  download_url          TEXT NULL,
  expires_at            TIMESTAMPTZ NULL,
  status                TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','generating','ready','downloaded','expired')),
  job_id                UUID NULL,       -- FK → ai_jobs
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_export_packages_session ON ai_platform.export_packages(session_id);
CREATE INDEX idx_export_packages_status  ON ai_platform.export_packages(status);
```

---

## 4. Supporting Tables

### `design_session_render_jobs`
```sql
-- Join table linking design sessions to their render sessions (Phase 5)
CREATE TABLE ai_platform.design_session_render_jobs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id              UUID NOT NULL REFERENCES ai_platform.design_sessions(id),
  render_session_id       UUID NOT NULL,  -- FK → creative_render_sessions (Phase 5)
  quality                 TEXT NOT NULL CHECK (quality IN ('preview', 'final')),
  camera_angles           TEXT[] NOT NULL DEFAULT '{}',
  selected_concept_index  INTEGER NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_render_jobs_session ON ai_platform.design_session_render_jobs(session_id);
```

### `design_agent_logs`
```sql
-- Audit log for AI agent invocations per session
CREATE TABLE ai_platform.design_agent_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES ai_platform.design_sessions(id),
  agent_type   TEXT NOT NULL,      -- 'room_planner', 'furniture_selector', etc.
  model_id     UUID NULL,          -- FK → ai_models (Phase 5)
  input_hash   TEXT NOT NULL,      -- SHA256 of input JSON
  output_json  JSONB NOT NULL,
  latency_ms   INTEGER NULL,
  token_count  INTEGER NULL,
  cost_usd     NUMERIC(10,6) NULL,
  status       TEXT NOT NULL CHECK (status IN ('success','error','timeout')),
  error_code   TEXT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_logs_session ON ai_platform.design_agent_logs(session_id);
CREATE INDEX idx_agent_logs_agent   ON ai_platform.design_agent_logs(agent_type);
CREATE INDEX idx_agent_logs_created ON ai_platform.design_agent_logs(created_at);
```

---

## 5. Table Inventory Summary

| Table | Rows | Purpose |
|---|---|---|
| `room_types` | ~10 (seed data) | Room function taxonomy |
| `room_styles` | ~20 (seed data) | Aesthetic style catalog |
| `room_themes` | ~15 (seed data) | Theme bundles |
| `room_templates` | Admin-managed | Structural room templates |
| `layout_constraint_sets` | Per room_type | Placement rule sets |
| `furniture_categories` | ~50 (seed data) | Hierarchical taxonomy |
| `furniture_items` | Catalog | Furniture catalog |
| `furniture_variants` | Catalog | SKU-level variants |
| `decoration_items` | Catalog | Accent item catalog |
| `lighting_fixtures` | Catalog | Lighting catalog |
| `design_sessions` | Per customer | Master session record |
| `design_rooms` | 1:1 session | Room state |
| `furniture_placements` | Per room | Placed furniture |
| `room_decoration_assignments` | Per room | Placed decorations |
| `room_lighting_assignments` | Per room | Placed fixtures |
| `design_moodboards` | Per session | Moodboard records |
| `design_revisions` | Per session | Immutable snapshots |
| `design_versions` | Per session | Named versions |
| `export_packages` | Per session | Export records |
| `design_session_render_jobs` | Per session | Render links |
| `design_agent_logs` | Per invocation | AI audit trail |

**Total new tables: 21**

---

## 6. RLS Considerations

| Table Group | RLS Strategy |
|---|---|
| Catalog tables (`room_types`, `room_styles`, `furniture_items`, etc.) | Read-only public (no RLS needed beyond existing `adminAuthWithExceptions`) |
| `design_sessions` | Row-level: customer can only SELECT/UPDATE their own rows (`customer_profile_id = current_setting('app.current_user_id')`) |
| `design_rooms`, `furniture_placements`, etc. | Row-level via session FK join |
| `design_agent_logs` | Admin-only SELECT; no customer access |

RLS DDL to be added to `scripts/migrations/rls-v14.sql` during WP-10.

---

## 7. Versioning Strategy

| Concern | Strategy |
|---|---|
| `room_templates` | Integer `version` column; bump on publish; sessions hold a FK to the template at session creation time (snapshot by value in `design_sessions.brief`) |
| `design_revisions` | Sequential `revision_number` per session; IMMUTABLE after creation (no UPDATE on revisions) |
| `design_versions` | Named milestones; `locked` status prevents further revision appends |
| Contract versioning | All JSONB fields carry a `_v: string` key; new fields are additive; removal requires migration of existing rows first |
| Schema migrations | New DDL hand-written (not drizzle-kit push) following the existing pattern established in Phase 5 |

---

## 8. Migration Execution Order

When implementation begins, migrations must be applied in this order:

```
1. room_types
2. room_styles, room_themes
3. layout_constraint_sets
4. room_templates
5. furniture_categories
6. furniture_items
7. furniture_variants
8. decoration_items, lighting_fixtures
9. design_sessions
10. design_rooms
11. furniture_placements, room_decoration_assignments, room_lighting_assignments
12. design_moodboards
13. design_revisions, design_versions
14. export_packages
15. design_session_render_jobs
16. design_agent_logs
17. RLS policies (rls-v14.sql)
18. Seed data (room_types, room_styles, furniture_categories)
```
