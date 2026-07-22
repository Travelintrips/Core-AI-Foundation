# Canvas Workspace — Team 11 Architecture

## Purpose

The Universal Design Canvas Workspace is a **domain-neutral** visual workspace for the Creative AI Platform. It displays, navigates, and inspects design artifacts across all project types — Fashion, Interior, Packaging, Branding, Furniture, Architecture, Jewelry, and future domains.

It is **not** a full creative editor (not Figma, CLO3D, AutoCAD, or Illustrator). V1 is an orchestration and inspection canvas.

---

## Boundaries

| In scope (Team 11) | Out of scope |
|---|---|
| Artifact display, zoom, pan, fit-to-screen | Vector drawing, 3D mesh editing |
| Renderer adapter contract + registry | Material/component library |
| Overlay host contract | Full annotation system (Team 18) |
| Selection model (opaque IDs) | Property editing panel (Team 12) |
| Frame/page navigation | Layer engine (Team 13) |
| Status bar, toolbar | Advanced interaction engine (Team 19) |
| Read-only and error states | AI image generation |
| Accessible keyboard navigation | Database migrations |

---

## Module Structure

```
artifacts/customer-portal/src/components/design-workspace/
├── types/index.ts            — All shared TypeScript types
├── utils/transform.ts        — Pure viewport math (no React, fully testable)
├── state/selection.ts        — Selection reducer (pure)
├── hooks/use-canvas-transform.ts — Viewport state hook (useReducer)
├── renderers/
│   ├── registry.ts           — CanvasRendererRegistry class
│   ├── ImageRenderer.tsx     — Built-in image renderer adapter
│   └── FallbackRenderer.tsx  — Explicit "unsupported" fallback adapter
├── overlays/
│   └── CanvasOverlayHost.tsx — Overlay host + LoadingOverlay, ErrorOverlay
├── CanvasRendererHost.tsx    — Resolves + renders via registry (no switches)
├── CanvasViewport.tsx        — Zoom/pan/resize viewport
├── WorkspaceToolbar.tsx      — Toolbar (zoom, fit, reset, overlays, fullscreen)
├── WorkspaceStatusBar.tsx    — Status bar (artifact info, zoom, status)
├── DesignWorkspaceShell.tsx  — Top-level shell (presentational, no fetch)
├── index.ts                  — Public API barrel
└── __tests__/
    ├── transform.test.ts     — Pure logic tests
    └── registry.test.ts      — Registry + adapter tests
```

---

## Renderer Adapter Contract

```typescript
interface CanvasRendererAdapter {
  rendererId: string;              // Globally unique
  supportedArtifactTypes: string[];
  priority?: number;               // Higher wins; tie → insertion order
  canRender(artifact: CanvasArtifact): boolean;
  Component: React.ComponentType<RendererProps>;
  getIntrinsicSize(artifact: CanvasArtifact): { width: number; height: number } | null;
  supportsFrames?: boolean;
  supportsOverlays?: boolean;
  supportsSelection?: boolean;
}
```

**Rules:**
- Adapters are compiled modules — never loaded from arbitrary URLs.
- `canRender()` must be a pure, synchronous function.
- The registry rejects duplicate `rendererId` and invalid contracts (throws).
- `FALLBACK_RENDERER` (priority: -999) is always registered last and renders any unknown type explicitly as "unavailable".

---

## Renderer Registry

```typescript
const registry = new CanvasRendererRegistry();
registry.register(IMAGE_RENDERER);       // priority 10
registry.register(FALLBACK_RENDERER);    // priority -999
// Domain plugins register their adapters after creation:
registry.register(myFashionRenderer);    // priority 20 → wins over image for 'fashion_sketch'
```

Resolution is deterministic: `resolve(artifact)` returns either `{ adapter }` (success) or `{ adapter: null, reason }` (failure — never silently uses wrong renderer).

---

## Viewport Transform Model

```typescript
type CanvasTransform = { scale: number; offsetX: number; offsetY: number };
```

All transform math is in `utils/transform.ts` as pure functions. No DOM references are stored in transform state.

Key functions:
- `calculateFitTransform(vW, vH, cW, cH)` — fit content to viewport
- `zoomAroundPoint(transform, nextScale, focalX, focalY)` — zoom keeping focal stationary
- `clampTransform(transform, vW, vH, cW, cH)` — keep content visible
- `transformToCss(transform)` — produces CSS transform string
- `serializeTransform` / `deserializeTransform` — for persistence

The `useCanvasTransform()` hook wraps these in a `useReducer`-based state machine.

---

## Selection Model

```typescript
interface CanvasSelection {
  artifactId: string | null;
  frameId: string | null;
  regionId: string | null;   // Opaque — canvas core never interprets semantic meaning
  source: 'user' | 'programmatic' | 'clear';
}
```

Canvas core never knows what a `regionId` means (not "sleeve", not "sofa", not "box panel"). Semantic meaning lives entirely in the renderer/plugin that produced the ID.

Selection events are forwarded via `onSelectionChange` prop for Team 12 (Property Panel) to consume.

---

## Overlay System

```typescript
interface CanvasOverlayDefinition {
  id: string;          // Stable ID
  label: string;
  zOrder: number;      // Higher = on top
  enabled: boolean;
  pointerEvents: boolean;
  Component: React.ComponentType<CanvasOverlayProps>;
}
```

`CanvasOverlayHost` renders enabled overlays in z-order. Overlays receive `{ transform, artifact }` — they follow the viewport transform.

**Team integration points:**
- **Team 18 (Annotations)**: Pass `CanvasOverlayDefinition[]` via `overlays` prop to `DesignWorkspaceShell`.
- **Team 12 (Property Panel)**: Mount in `rightPanel` slot.
- **Team 13 (Layer System)**: Mount in `leftPanel` slot.

---

## Security Assumptions

- `artifact.url` MUST be a presigned/authenticated URL resolved server-side. Canvas core never constructs storage paths.
- `artifact.metadata` is a pass-through bag — canvas core never reads or renders domain fields.
- SVG from external sources is rendered as `<img>` (MIME: `image/svg+xml`), never injected via `dangerouslySetInnerHTML`.
- `WorkspaceStatusBar` deliberately excludes raw storage paths, provider payloads, and API keys from display.
- `tenantId` is never accepted from the client URL or query string — callers resolve server-side.

---

## Accessibility

- Canvas viewport has `role="region"`, `aria-label`, `tabIndex={0}` for keyboard focus.
- All toolbar buttons have `aria-label` and `disabled` states.
- Frame navigation uses `aria-current="page"`.
- Loading/error/status states use `role="status"` and `role="alert"`.
- Keyboard: `Arrow` keys = pan, `+`/`-` = zoom, `0` = fit, `Escape` = exit fullscreen.
- `prefers-reduced-motion` is respected (transitions are suppressed).

---

## Team Integration Guide

### Adding a domain renderer (e.g. fashion plugin)

```typescript
import { CanvasRendererAdapter } from '@/components/design-workspace';

const fashionRenderer: CanvasRendererAdapter = {
  rendererId: 'domain:fashion',
  supportedArtifactTypes: ['fashion_sketch', 'fashion_moodboard'],
  priority: 20,
  canRender: (a) => ['fashion_sketch', 'fashion_moodboard'].includes(a.type),
  Component: FashionRendererComponent,
  getIntrinsicSize: (a) => (a.metadata?.width ? { width: a.metadata.width as number, height: a.metadata.height as number } : { width: 1200, height: 1600 }),
};

registry.register(fashionRenderer);
```

Canvas core has zero knowledge of garments, seams, collars, or any fashion concepts.

### Team 12 — Property Panel
Receive `onSelectionChange` from shell → show properties for `selection.regionId`.

### Team 13 — Layer System
Mount layer tree in `leftPanel` slot of `DesignWorkspaceShell`.

### Team 18 — Annotation System
Contribute `CanvasOverlayDefinition[]` via `overlays` prop. Your overlay component receives `{ transform, artifact }`.

### Team 19 — Workspace Interactions
Advanced interactions (selection handles, rulers, snap-to-grid) plug into `CanvasViewport` via `overlayChildren` or future interaction callbacks. Do not add to canvas core.

### Team 20 — Design System
The workspace uses Tailwind v4 CSS variables and existing `@/components/ui/*` components. Do not introduce a second token set.

---

## V1 Known Limitations

1. No PDF renderer (no new PDF engine built — boundary for Team 11).
2. No 3D renderer (boundary is defined; `FALLBACK_RENDERER` shows "unavailable").
3. No multi-touch pinch-to-zoom with precise calibration on all browsers.
4. Signed URL refresh is the responsibility of the calling page/container — canvas core does not auto-refresh URLs.
5. No collaborative cursors or real-time multi-user selection.
6. No undo/redo history (viewport transform only; no document mutations).
