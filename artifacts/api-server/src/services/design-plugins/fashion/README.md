# Fashion Design Domain Plugin

**Plugin ID:** `fashion-design`
**Version:** `1.0.0`
**Contract Version:** `1.0`
**Domain:** `fashion`

---

## Overview

The Fashion Design Plugin is a self-contained domain plugin built on top of the Universal Design Engine. It contributes a complete 11-step fashion design workflow, 9 artifact types, 12 AI capability boundaries, 8 material categories, 6 garment component categories, 7 property sections, 3 renderer metadata blocks, and 7 export presets.

**Fashion-specific fields are isolated inside this plugin.** No fashion semantics are injected into core types (`MaterialInput`, `WorkflowDefinition`, `ImageBatchType`, etc.).

---

## File Structure

```
design-plugins/fashion/
├── types/
│   └── pluginContracts.ts          # Local plugin contract adapter (see Team 39 notes)
├── brief/
│   └── fashionBriefSchema.ts       # Zod schema + TypeScript types for fashion briefs
├── workflow/
│   └── fashionWorkflowDefinition.ts# 11-step WorkflowDefinition DAG
├── artifacts/
│   └── fashionArtifactTypes.ts     # 9 artifact type definitions
├── contributions/
│   ├── capabilities.ts             # 12 AI capability boundary descriptions
│   ├── components.ts               # 6 garment component categories
│   ├── exportPresets.ts            # 7 export presets
│   ├── materials.ts                # 8 fashion material categories
│   ├── properties.ts               # 7 property sections (silhouette → production notes)
│   └── rendererMetadata.ts         # 3 renderer metadata blocks
├── examples/
│   └── fashionExamples.ts          # 4 domain examples (parseable, non-production)
├── __tests__/
│   └── fashionPlugin.test.ts       # 16 required test cases
├── fashionPlugin.ts                # Plugin loader / assembler
├── index.ts                        # Public barrel export
└── README.md                       # This file
```

---

## Usage

```typescript
import { loadFashionPlugin } from "@workspace/api-server/services/design-plugins/fashion";

const plugin = loadFashionPlugin();

// Access the manifest
console.log(plugin.manifest.pluginId);       // "fashion-design"
console.log(plugin.manifest.version);        // "1.0.0"

// Access artifact types
plugin.artifactTypes.forEach(at => console.log(at.id));

// Validate a fashion brief
import { FashionBriefSchema } from "@workspace/api-server/services/design-plugins/fashion";
const result = FashionBriefSchema.safeParse(incomingBrief);
if (!result.success) { /* handle validation errors */ }
```

---

## Workflow — 11 Steps

| # | Node ID              | Label                          | Job Type                               |
|---|----------------------|--------------------------------|----------------------------------------|
| 1 | `brief`              | Brief & Design Intent          | `fashion.brief.validate`               |
| 2 | `research`           | Research & Reference           | `fashion.research.compile`             |
| 3 | `moodboard`          | Moodboard Creation             | `fashion.moodboard.generate`           |
| 4 | `creative_direction` | Creative Direction             | `fashion.creative_direction.define`    |
| 5 | `concept_sketch`     | Concept Sketch                 | `fashion.concept_sketch.generate`      |
| 6 | `technical_drawing`  | Technical Drawing (Flat Sketch)| `fashion.technical_drawing.generate`   |
| 7 | `colorway`           | Colorway Definition            | `fashion.colorway.define`              |
| 8 | `material_assignment`| Material & Fabric Assignment   | `fashion.material_assignment.compile`  |
| 9 | `visualization`      | Fashion Visualization          | `fashion.visualization.render`         |
|10 | `review`             | Design Review & QA             | `fashion.review.qa`                    |
|11 | `export`             | Export & Delivery Packaging    | `fashion.export.package`               |

The workflow is a DAG (verified by Test 7 — no cycles). It is **configurable** — individual nodes can be skipped or substituted by the execution engine via the WorkflowDefinition contract. No second execution engine is introduced.

---

## Artifact Types (9)

| ID                           | Format(s)         | Workflow Step |
|------------------------------|-------------------|---------------|
| `fashion_moodboard`          | image, pdf        | 3             |
| `fashion_creative_direction` | pdf, json         | 4             |
| `fashion_concept_sketch`     | image, svg        | 5             |
| `fashion_technical_drawing`  | svg, pdf          | 6             |
| `fashion_colorway`           | pdf, image        | 7             |
| `fashion_material_board`     | pdf, image        | 8             |
| `fashion_visualization`      | image             | 9             |
| `fashion_campaign_asset`     | image, zip        | 10            |
| `fashion_production_spec`    | pdf, zip          | 11            |

---

## Fashion Brief Schema

All fields live in the plugin schema — not in any core brief type.

**Required fields:** `productCategory`, `targetUser`, `season`, `styleDirection`, `silhouette`, `colorDirection`, `materialPreference`, `marketSegment`

**Conditional required fields:**
- `performanceRequirements` — required when `productCategory` is `activewear` or `swimwear`
- `luxuryDetails` — required when `marketSegment` is `luxury` or `bespoke`

---

## AI Capabilities (12)

Each capability describes a **prompt template boundary** only — no model or provider is hard-coded. The execution engine resolves the actual model at runtime.

| ID                                        | Job Type                              |
|-------------------------------------------|---------------------------------------|
| `fashion.brief.validate`                  | `fashion.brief.validate`              |
| `fashion.research.compile`                | `fashion.research.compile`            |
| `fashion.moodboard.generate`              | `fashion.moodboard.generate`          |
| `fashion.creative_direction.define`       | `fashion.creative_direction.define`   |
| `fashion.concept_sketch.generate`         | `fashion.concept_sketch.generate`     |
| `fashion.technical_drawing.generate`      | `fashion.technical_drawing.generate`  |
| `fashion.colorway.define`                 | `fashion.colorway.define`             |
| `fashion.material_assignment.compile`     | `fashion.material_assignment.compile` |
| `fashion.visualization.render`            | `fashion.visualization.render`        |
| `fashion.visualization.render_simplified` | `fashion.visualization.render_simplified` |
| `fashion.review.qa`                       | `fashion.review.qa`                   |
| `fashion.export.package`                  | `fashion.export.package`              |

---

## Material Categories (8)

Fashion-specific material metadata (`stretch`, `weightGsm`, `drape`, `opacity`, `composition`, `care`, `finish`) is defined in this plugin only. These fields are **not** added to `MaterialInput` in `dynamic-design-composer/types.ts`.

Categories: Woven Natural, Woven Synthetic, Knit & Stretch, Denim & Chambray, Leather & Faux Leather, Sheer & Delicate, Technical & Performance, Sustainable & Eco.

---

## Component Categories (6)

All garment component categories live in this plugin contribution:

- `fashion_component_neckline` *(required)*
- `fashion_component_sleeve`
- `fashion_component_collar`
- `fashion_component_pocket`
- `fashion_component_closure` *(required)*
- `fashion_component_trim`

---

## Property Sections (7)

| ID                               | Display Name        | Order |
|----------------------------------|---------------------|-------|
| `fashion_prop_silhouette`        | Silhouette          | 10    |
| `fashion_prop_garment_details`   | Garment Details     | 20    |
| `fashion_prop_dimensions`        | Dimensions          | 30    |
| `fashion_prop_colorway`          | Colorway            | 40    |
| `fashion_prop_material`          | Material            | 50    |
| `fashion_prop_construction`      | Construction        | 60    |
| `fashion_prop_production_notes`  | Production Notes    | 70    |

---

## Export Presets (7)

| ID                                  | Format | Color Space | DPI  |
|-------------------------------------|--------|-------------|------|
| `fashion_export_screen_preview`     | image  | sRGB        | 72   |
| `fashion_export_print_spec`         | pdf    | CMYK        | 300  |
| `fashion_export_social_media`       | zip    | sRGB        | 150  |
| `fashion_export_editorial_highres`  | image  | sRGB        | 300  |
| `fashion_export_technical_svg`      | svg    | sRGB        | 300  |
| `fashion_export_production_package` | zip    | CMYK        | 300  |
| `fashion_export_p3_digital`         | image  | P3          | 150  |

---

## Plugin Isolation Contract

- ✅ Fashion fields are **not** added to `MaterialInput` (dynamic-design-composer)
- ✅ `fashion_design` is **not** added to `ImageBatchType` union (imageBatchTypes)
- ✅ Fashion workflow does not create a second execution engine
- ✅ No AI provider/model names are hard-coded anywhere
- ✅ No direct AI provider calls from plugin code
- ✅ Uses `RequestContext` and existing authorization — no custom auth
- ✅ No database access from plugin code (pure domain definitions)
- ✅ All changes additive and backward-compatible

---

## Team 39 Integration Notes

The `types/pluginContracts.ts` file is a **local adapter** for domain plugin contracts. It was created because Team 21's Universal Design Engine plugin contract package (`@workspace/design-engine-contracts`) was not available at build time.

**When Team 21 publishes the package:**
1. Replace imports in `fashionPlugin.ts` and individual contribution files from `./types/pluginContracts.js` → `@workspace/design-engine-contracts`
2. Delete `types/pluginContracts.ts`
3. Mark the `design-engine-contracts` dependency in the manifest as `required: true`
4. Run `pnpm test` and `pnpm typecheck` to confirm compatibility

**Adapter interfaces to map:**
- `DomainPluginManifest` → Team 21 equivalent
- `ArtifactTypeDefinition` → Team 21 equivalent
- `CapabilityContribution` → Team 21 equivalent
- `MaterialCategoryContribution` → Team 21 equivalent (note: `FashionMaterialMetadata` is fashion-specific, not part of core contract)
- `ComponentCategoryContribution`, `PropertySectionContribution`, `RendererMetadataContribution`, `ExportPreset` → Team 21 equivalents

---

## Running Tests

```bash
cd artifacts/api-server
pnpm test -- --testPathPattern=fashionPlugin
```

## Running Typecheck

```bash
pnpm --filter @workspace/api-server run typecheck
```
