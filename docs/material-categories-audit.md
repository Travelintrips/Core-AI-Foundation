# Material Categories Hierarchy Audit
## Core AI Foundation — Dev Database

**Audited:** 2026-07-27
**Database:** Supabase dev (`xssrfshdrtdfupgqwfdw`) — `ai_platform` schema
**Table:** `ai_platform.material_categories`
**Auditor:** Engineering (automated query)

> **Policy:** This audit documents findings only.
> No data modifications were made or recommended for immediate action.
> Recommended changes are listed in the backlog section at the end.

---

## 1. Current Hierarchy — Raw Data

```
id | name       | icon      | display_order | created_at
---+------------+-----------+---------------+------------------------
 1 | Wall       | square    |             1 | 2026-07-25 18:41:27 UTC
 2 | Floor      | grid      |             2 | 2026-07-25 18:41:27 UTC
 3 | Ceiling    | layers    |             3 | 2026-07-25 18:41:27 UTC
 4 | Furniture  | sofa      |             4 | 2026-07-25 18:41:27 UTC
 5 | Lighting   | lightbulb |             5 | 2026-07-25 18:41:28 UTC
 6 | Fabric     | shirt     |             6 | 2026-07-25 18:41:28 UTC
 7 | Kitchen    | utensils  |             7 | 2026-07-25 18:41:28 UTC
 8 | Bathroom   | bath      |             8 | 2026-07-25 18:41:28 UTC
 9 | Outdoor    | trees     |             9 | 2026-07-25 18:41:28 UTC
10 | Decorative | sparkles  |            10 | 2026-07-25 18:41:28 UTC
11 | Doors      | door-open |            11 | 2026-07-25 18:41:29 UTC
12 | Windows    | frame     |            12 | 2026-07-25 18:41:29 UTC
13 | Landscape  | mountain  |            13 | 2026-07-25 18:41:29 UTC
```

**Total categories:** 13
**Total materials:** 505

**Materials per category:**

| Category | Count | % of total |
|---|---|---|
| Furniture | 50 | 9.9% |
| Floor | 48 | 9.5% |
| Wall | 47 | 9.3% |
| Decorative | 40 | 7.9% |
| Kitchen | 40 | 7.9% |
| Outdoor | 40 | 7.9% |
| Fabric | 40 | 7.9% |
| Bathroom | 40 | 7.9% |
| Lighting | 40 | 7.9% |
| Windows | 30 | 5.9% |
| Ceiling | 30 | 5.9% |
| Landscape | 30 | 5.9% |
| Doors | 30 | 5.9% |

---

## 2. Verification Findings

### 2.1 Duplicate Nodes

**Finding: PASS — No duplicates**

All 13 category names are unique. `name` column has a `UNIQUE` constraint enforced at schema level.

```sql
-- Verified: SELECT name, COUNT(*) FROM material_categories GROUP BY name HAVING COUNT(*) > 1;
-- Result: 0 rows
```

---

### 2.2 Orphan Categories

**Finding: PASS — No orphans**

All 13 categories have at least 30 materials assigned. No category exists without materials.

```sql
-- Verified: All 13 categories appear in SELECT DISTINCT category FROM materials;
-- Materials with unrecognised category: 0
```

No materials reference a category name that does not exist in `material_categories`.

---

### 2.3 Parent-Child Integrity

**Finding: OBSERVATION — Flat hierarchy (no parent_id column)**

The `material_categories` table does not have a `parent_id` column. The hierarchy is flat — 13 top-level categories with no subcategories at the category table level.

Subcategories exist as free-text `subcategory` column values in the `materials` table (not normalised). This is consistent with the current schema design but limits filtering and Phase 6 Room Template composition.

**Impact:** For Phase 6 (Room Design Template Library), a Room Template will need to reference categories like "Wall", "Floor", "Ceiling" — the flat structure is sufficient for this use case. However, if subcategory filtering is needed (e.g. "Porcelain Tile" subcategory of "Floor"), the current schema requires a `materials.subcategory` filter rather than a category hierarchy filter.

---

### 2.4 Depth Consistency

**Finding: PASS — Single depth level**

All 13 categories are at depth 0 (root level). No nesting. Depth is consistent across all records.

---

### 2.5 Naming Consistency

**Finding: PASS with one observation**

All category names follow Title Case. Names are concise, single-word or noun-form.

**Observation:** `Landscape` and `Outdoor` have overlapping semantic scope:
- `Outdoor` (40 materials) — likely covers outdoor furniture, paving, exterior walls
- `Landscape` (30 materials) — likely covers plants, garden features, hardscape

For Room Template Library (Phase 6), these two categories may cause ambiguity when defining which category a template slot should reference. Recommend clarifying the boundary in the category description field (backlog item — no data change required now).

---

### 2.6 Slug Consistency

**Finding: OBSERVATION — No slug column on material_categories**

The `material_categories` table does not have a `slug` column. Slugs exist only on individual `materials` records (e.g. `wall-001`).

**Impact:** Category filtering in API requests currently uses the `name` string (e.g. `category: "Floor"`). This means category references in application code are coupled to the display name. If a category name is ever renamed, all `materials.category` values and all API consumers must be updated simultaneously.

For Phase 6 Room Template Library, if template slots reference categories by name, a name change would break existing templates. A `slug` column on `material_categories` would decouple display name from machine identity.

**Recommendation (backlog — not immediate):** Add `slug` column to `material_categories` with values: `wall`, `floor`, `ceiling`, `furniture`, `lighting`, `fabric`, `kitchen`, `bathroom`, `outdoor`, `decorative`, `doors`, `windows`, `landscape`. Use slug as the canonical reference in template slot definitions.

---

### 2.7 Search Compatibility

**Finding: PASS**

All 13 category names are compatible with the material intelligence search layer. The `materials.category` column is included in the full-text search `tsvector`. Category-based filtering is supported via `WHERE category = $1` on the `materials` table.

Indonesian alias resolution operates at the material name/keyword level and does not require category-level changes.

---

### 2.8 Future Room Template Compatibility

**Finding: CONDITIONAL PASS**

The current 13-category structure is sufficient to define Room Template material slots for the core interior design use case:

| Room Template slot need | Covered by existing categories |
|---|---|
| Flooring material | ✅ Floor |
| Wall treatment | ✅ Wall |
| Ceiling finish | ✅ Ceiling |
| Furniture pieces | ✅ Furniture |
| Lighting fixtures | ✅ Lighting |
| Soft furnishings | ✅ Fabric |
| Kitchen surfaces | ✅ Kitchen |
| Bathroom fittings | ✅ Bathroom |
| Decorative accessories | ✅ Decorative |
| Doors | ✅ Doors |
| Windows | ✅ Windows |

**Gap for exterior/landscape projects:** `Outdoor` and `Landscape` overlap needs resolution before exterior room templates are defined.

**Gap for slug-based template references:** See 2.6 above.

---

## 3. Audit Summary

| Check | Result |
|---|---|
| No duplicate nodes | ✅ PASS |
| No orphan categories | ✅ PASS |
| Parent-child integrity | ✅ PASS (flat — no parent_id by design) |
| Depth consistency | ✅ PASS |
| Naming consistency | ✅ PASS |
| Slug consistency | ⚠️ OBSERVATION — no slug column |
| Search compatibility | ✅ PASS |
| Room Template compatibility | ⚠️ CONDITIONAL — slug gap + Outdoor/Landscape boundary |

**Overall assessment: Hierarchy is sound and production-ready for Phase 5 and Phase 6 core use cases.**

---

## 4. Backlog Recommendations

The following changes are recommended but must NOT be implemented until Phase 6 is formally approved. No data modifications are authorised at this stage.

| Priority | Item | Description |
|---|---|---|
| Medium | Add `slug` column to `material_categories` | Decouple category name from machine identity for template references |
| Low | Add `description` column to `material_categories` | Clarify category scope (especially Outdoor vs Landscape boundary) |
| Low | Add `parent_id` column to `material_categories` | Enable subcategory hierarchy if subcategory filtering becomes a product requirement |
| Low | Add `is_active` column | Allow categories to be deactivated without deletion |
| Low | Clarify Outdoor vs Landscape boundary | Write category descriptions before Room Template Library slots are defined |
