---
name: Design Template Blueprints
description: How builtin design templates work — static code, no DB, served via API
---

## Rule
Templates defined in `artifacts/api-server/src/data/design-templates.ts` as `BUILTIN_TEMPLATES` array.
Served via `GET /api/ai/design/templates/builtin` and `GET /api/ai/design/templates/builtin/:code`.
List endpoint strips `canvasState` for small payload; detail endpoint includes full canvas state.

**Why:** No DB migration needed, templates are version-controlled in code, instantly available.

## How to apply
- To add a new template: add a `BuiltinTemplate` object to `BUILTIN_TEMPLATES`, run `pnpm run build:api`, restart api-server.
- templateCode convention: CATEGORY-INDUSTRY-STYLE-NNN (e.g. LOGO-FOOD-BOLD-002, SOC-FASHION-MINIMAL-001)
- canvasState elements use types: text | image | rect | circle | line | frame
- Frontend `TemplateSvgPreview` renders inline SVG preview based on templateCode prefix (LOGO- / SOC- / BAN-)

## Known pre-existing bug fixed alongside this
`creativeWorkflowRunner.ts` had duplicate `const documentType` in same function scope (lines 365+720).
Fixed by renaming the second declaration to `finalDocumentType`.
