---
name: Phase 5 Visual Template Editor
description: Design template visual editor (react-konva) — completion rules, gotchas, and file layout
---

## Rules & Gotchas

**z-index normalization must happen in adapter, not just reducer:**
`schemaToEditor` must sort elements by original zIndex then reassign 1-based sequential indices. Tests validate this. The reducer's `LOAD_TEMPLATE` action also normalizes but tests hit the adapter directly.

**vite build requires PORT env var:**
`pnpm --filter @workspace/ai-platform run build` fails with `PORT environment variable is required`. Use `pnpm run typecheck` (tsc --noEmit) to validate TypeScript without running Vite. CI checks must inject PORT.

**vitest config for ai-platform:**
`vitest.config.ts` at `artifacts/ai-platform/` with `environment: "node"` and `@` alias to `./src`. The `"test"` script in package.json runs `vitest run --config vitest.config.ts`.

**PropertyPanel receives element type as string discriminant:**
PropertyPanel conditionally renders sections based on `el.type === "text" | "shape" | "image" | "qrcode" | "line"`. Cast partial updates as `Partial<SpecificElement>` to avoid TS errors on narrowed props.

**TextNode `ellipsis` is not on TextElement:**
Use `element.overflow === "truncate"` not `element.ellipsis` — the latter doesn't exist on the type.

**EditorCanvas passes `sampleData` separately:**
`EditorCanvas` receives `containerWidth` and `containerHeight` props. The `sampleData` comes from `useEditorState()` inside element nodes directly via context — elements should call `useEditorState` themselves or receive `sampleData` via prop drilling from the canvas.

**base64 data URIs must be stripped before serialization:**
`editorToSchema` removes any image `src` where the value is an object with `type: "dataurl"`. `validateTemplate` also rejects base64 strings in image elements directly.

## File layout

```
artifacts/ai-platform/src/
├── state/design-editor/
│   ├── types.ts        — All domain types (EditorState, DesignElement variants, etc.)
│   ├── constants.ts    — DESIGN_TEMPLATE_SCHEMA_VERSION, DESIGN_LIMITS
│   ├── reducer.ts      — editorReducer, initialEditorState
│   └── context.tsx     — EditorProvider, useEditor, useEditorState, useEditorDispatch
├── utils/design-editor/
│   ├── adapter.ts      — schemaToEditor, editorToSchema, validateTemplate, createDefaultTemplate
│   ├── constants.ts    — SAFE_FONTS (25), ELEMENT_DEFAULTS, SNAP_THRESHOLD
│   └── elementFactory.ts — createTextElement, createImageElement, etc.
├── services/
│   └── design-editor-api.ts — designEditorApi (getTemplate, saveDraft, publish, preview)
├── components/design-editor/
│   ├── TopBar.tsx            — undo/redo/zoom/save/publish/preview header
│   ├── LeftSidebar.tsx       — tabs: Elements / Layers / Variables / Canvas
│   ├── LayerList.tsx         — z-ordered layer panel with rename/visible/lock
│   ├── VariablePanel.tsx     — add/edit/delete template variables + sample data
│   ├── CanvasSettingsPanel.tsx — canvas size presets + background color
│   ├── PropertyPanel.tsx     — right panel with element-type-specific property sections
│   ├── EditorCanvas.tsx      — Konva Stage+Layer+Transformer
│   └── elements/
│       ├── TextNode.tsx, ShapeNode.tsx, ImageNode.tsx, QrNode.tsx, LineNode.tsx
├── pages/
│   ├── design-templates.tsx       — listing page (/design-templates)
│   └── design-template-editor.tsx — editor shell (/design-templates/:id/editor)
└── tests/
    └── design-editor-adapter.test.ts — 38 tests all passing
```

## Route registration (App.tsx)
```tsx
<Route path="/design-templates" component={DesignTemplatesPage} />
<Route path="/design-templates/:id/editor" component={DesignTemplateEditor} />
```

**Why:** Phase 5 spec required `/design-templates/:id/editor` with Konva canvas. Listing page at `/design-templates` was added to support nav link.

**How to apply:** Editor is self-contained behind EditorProvider. The listing page calls `/api/ai/design-templates` (Phase 1 backend). Preview calls `/api/ai/design-templates/:id/preview` which requires Phase 2 renderer.
