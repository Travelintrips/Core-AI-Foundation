# Workspace UX Guidelines — Team 20

> **Audience:** Teams 11–19 building workspace features on the Creative AI Universal Design Platform.
> These guidelines define how to use the shared workspace primitives, maintain visual consistency, and meet accessibility requirements.

---

## Contents

1. [Primitives Reference](#primitives-reference)
2. [Density](#density)
3. [Status Visuals](#status-visuals)
4. [Toolbar Patterns](#toolbar-patterns)
5. [Panel Layout](#panel-layout)
6. [Empty / Error / Loading / Unavailable States](#state-components)
7. [Responsive Strategy](#responsive-strategy)
8. [Dark & Light Mode](#dark--light-mode)
9. [Accessibility](#accessibility)
10. [Anti-Patterns](#anti-patterns)
11. [Team 11–19 Handoff](#team-1119-handoff)
12. [Visual QA Checklist](#visual-qa-checklist)

---

## Primitives Reference

All workspace primitives live in `artifacts/ai-platform/src/components/workspace/`.

```
workspace/
  index.ts                   ← public barrel — always import from here
  workspace-density.tsx      ← DensityContext, useDensity, DENSITY_* maps
  workspace-status.ts        ← resolveWorkspaceStatus, STATUS_TONE_CLASSES
  workspace-panel.tsx        ← WorkspacePanel, WorkspacePanelHeader, WorkspaceSection, WorkspaceDivider
  workspace-toolbar.tsx      ← WorkspaceToolbarGroup, WorkspaceToolbarButton, WorkspaceIconButton
  workspace-status-badge.tsx ← WorkspaceStatusBadge
  workspace-states.tsx       ← WorkspaceLoadingState, WorkspaceEmptyState, WorkspaceErrorState, WorkspaceUnavailableState
  workspace-overlays.tsx     ← WorkspaceTooltip, WorkspaceKeyboardHint, WorkspaceDrawer, WORKSPACE_RESIZE_HANDLE_CLASSES
```

**Always import via the barrel:**
```tsx
import { WorkspacePanel, WorkspaceStatusBadge, useDensity } from "@/components/workspace";
```

---

## Density

Wrap your workspace root in `<WorkspaceDensityProvider>` once. All descendant primitives adapt automatically.

```tsx
<WorkspaceDensityProvider defaultDensity="comfortable">
  <MyWorkspaceLayout />
</WorkspaceDensityProvider>
```

Support exactly two modes:

| Mode | Use-case |
|---|---|
| `comfortable` | Default — full padding, larger icons, spacious gaps |
| `compact` | Power users, low-resolution screens, secondary panels |

**Consume in custom components:**
```tsx
const { density, pick } = useDensity();
const padding = pick("p-4", "p-2");   // comfortable → compact
```

**Do not** create intermediate sizes (e.g. "cozy", "dense"). Two levels only.

---

## Status Visuals

Use `WorkspaceStatusBadge` for **all** workspace project/asset status indicators.
Use `CommercialStatusBadge` (customer-portal) only for commercial/payment flows.

### Canonical workspace statuses

| Status key | Label | Tone |
|---|---|---|
| `draft` | Draft | neutral |
| `generating` | Generating | info (blue) |
| `ready` | Ready | success (green) |
| `in_review` | In Review | warning (amber) |
| `approved` | Approved | success (green) |
| `revision_requested` | Revision Requested | warning (amber) |
| `failed` | Failed | danger (red) |
| `archived` | Archived | dim (faded) |
| `unavailable` | Unavailable | dim (faded) |
| `read_only` | Read-Only | dim (faded) |

**Platform aliases** (existing backend status strings) are mapped automatically by `resolveWorkspaceStatus()`. Do not create new business statuses.

```tsx
// ✅ Correct — platform status string resolved automatically
<WorkspaceStatusBadge status={project.status} />

// ✅ Correct — canonical key
<WorkspaceStatusBadge status="in_review" />

// ❌ Wrong — hard-coding a label
<span className="text-green-500">Approved</span>
```

### Status rules
- Status must **never** be communicated by colour alone — the text label is always visible.
- `aria-label` on the badge provides a screen-reader-safe description.
- Pulsing dot is automatic for `generating` / `info` tone; override with `pulse={false}`.

---

## Toolbar Patterns

```tsx
<WorkspaceToolbarGroup label="Draw tools">
  <WorkspaceTooltip content="Pen">
    <WorkspaceToolbarButton
      icon={<PenIcon />}
      label="Pen"
      active={activeTool === "pen"}
      onClick={() => setActiveTool("pen")}
    />
  </WorkspaceTooltip>
  <WorkspaceIconButton icon={<PlusIcon />} label="Add layer" onClick={onAdd} />
</WorkspaceToolbarGroup>
```

- Every button **must** have a `label` prop — it becomes `aria-label` when no visible text.
- Wrap with `<WorkspaceTooltip>` to surface the label on hover.
- Tooltip must **not** be the only source of accessible information; `label` on the button already handles that.
- Use `showLabel` when the toolbar has room for visible text (e.g. top bar, not side panel).

### Keyboard shortcut display

```tsx
<WorkspaceKeyboardHint keys={["⌘", "Z"]} label="Undo" />
```

- Always include a `label` — screen readers announce the shortcut name, not the key characters.

---

## Panel Layout

```tsx
<WorkspacePanel elevated>
  <WorkspacePanelHeader
    title="Layers"
    description="12 layers"
    actions={<WorkspaceIconButton icon={<PlusIcon />} label="Add layer" />}
  />
  <WorkspaceSection>
    {/* layer list */}
  </WorkspaceSection>
  <WorkspaceDivider label="Hidden" />
  <WorkspaceSection>
    {/* hidden layers */}
  </WorkspaceSection>
</WorkspacePanel>
```

- `WorkspacePanel` is the outermost container — sets bg, overflow, flex direction.
- `WorkspacePanelHeader` is `shrink-0` — never scrolls away.
- `WorkspaceSection` provides density-aware padding and gap.
- `WorkspaceDivider` with `label` adds a labelled section break; without `label` renders a simple `<hr>`.

### Resize handles

When implementing resizable panels, apply `WORKSPACE_RESIZE_HANDLE_CLASSES`:

```tsx
import { WORKSPACE_RESIZE_HANDLE_CLASSES as R } from "@/components/workspace";
<div className={cn(R.base, R.vertical)}>
  <span className={cn(R.indicator, R.indicatorVertical)} />
</div>
```

---

## State Components

Replace custom loading/error/empty divs with the standard workspace states:

```tsx
// Loading
{isLoading && <WorkspaceLoadingState message="Loading assets…" />}

// Error
{error && <WorkspaceErrorState message="Failed to load." onRetry={refetch} />}

// Empty
{items.length === 0 && (
  <WorkspaceEmptyState
    icon={<LayersIcon />}
    title="No layers yet"
    description="Add a layer to your canvas to get started."
    action={<Button size="sm" onClick={onAdd}>Add Layer</Button>}
  />
)}

// Unavailable (premium, permission, offline)
<WorkspaceUnavailableState reason="premium" />
```

All state components:
- Adjust padding / icon size automatically per density.
- Carry `role="status"`, `role="alert"`, or `role="region"` as appropriate.
- Never hard-code domain-specific text (no "Fashion layers", etc.).

---

## Responsive Strategy

### Desktop (≥ 1024px)
- Multi-panel layout with `WorkspacePanel` side-by-side.
- Horizontal `WorkspaceToolbarGroup` in the top bar.
- Status bar at the bottom (use `WorkspaceStatusBadge`).

### Tablet (768–1023px)
- Collapse secondary panels (layers, properties) behind `WorkspaceDrawer`.
- Compact toolbar — use `<WorkspaceDensityProvider defaultDensity="compact">`.

### Mobile (< 768px)
- Canvas / viewer as the primary surface; all auxiliary panels via `WorkspaceDrawer side="bottom"`.
- No horizontal page overflow — avoid fixed pixel widths.
- Touch targets: minimum `44 × 44px` effective area. Both `WorkspaceToolbarButton` and `WorkspaceIconButton` in comfortable mode are `28px` — wrap in a `p-2` tap target if needed on mobile.
- Property / layer / review access exclusively through Sheet/Tab triggered by a persistent toolbar.

---

## Dark & Light Mode

- All token-based classes (`bg-card`, `text-muted-foreground`, etc.) respond to `.dark` class automatically.
- Status tones in `STATUS_TONE_CLASSES` include explicit `dark:` overrides for amber, green (warn/success).
- **Never** use hard-coded arbitrary colours if a token exists.

```tsx
// ❌ Wrong
<div className="bg-[#1e293b] text-[#94a3b8]">…</div>

// ✅ Correct
<div className="bg-card text-muted-foreground">…</div>
```

### High-contrast consideration
- All text meets WCAG AA (4.5:1) against the card background in both modes.
- Do not rely on low-opacity overlays as the sole means of differentiation.

### Reduced motion
- Spinner carries `motion-reduce:animate-none`.
- Pulsing status dots use `animate-pulse` — browsers with `prefers-reduced-motion` will pause it.
- Avoid `animate-spin`, `animate-bounce` on informational UI without `motion-reduce:` guard.

### Browser zoom 200%
- All components use relative sizing (`rem`, `em`, `text-sm`) — no fixed `px` font sizes.
- Panels flex-wrap and scroll rather than overflow.

---

## Accessibility

### Required on every interactive element
- `aria-label` or visible label text.
- `focus-visible` ring (all workspace buttons use `focus-visible:ring-2 focus-visible:ring-ring`).
- Logical tab order — do not use positive `tabIndex`.

### Required on toolbars
- `role="toolbar"` on `WorkspaceToolbarGroup` with `aria-label`.
- `aria-pressed` on toggle-style `WorkspaceToolbarButton`.

### Required on status badges
- `role="status"` with `aria-label` containing the human description.
- Status communicated via **both** colour and text.

### Minimum touch size
- Smallest workspace button in comfortable mode: 28 × 28px (`size-7`).
- For primary actions on touch screens, apply `min-h-[44px] min-w-[44px]`.

### Screen-reader labels
- `WorkspaceIconButton` always renders `<span className="sr-only">{label}</span>`.
- Tooltip is supplementary — the button's own `aria-label` is the primary label.

---

## Anti-Patterns

| Anti-pattern | Correct approach |
|---|---|
| `<div style={{ color: 'green' }}>Approved</div>` | `<WorkspaceStatusBadge status="approved" />` |
| Creating a second loading spinner component | Use `<WorkspaceLoadingState>` |
| Copying `WorkspacePanel` into a feature file | Import from `@/components/workspace` |
| `tabIndex={2}` on a button | Remove — use DOM order |
| Colour-only status indicator | Status badge always shows text label |
| Hard-coding `"Fashion"` or `"Interior"` in a workspace primitive | Pass as prop; primitives are domain-agnostic |
| Creating a `WorkspaceDensityProvider` per panel | One provider at the workspace root |
| Using `console.log` to surface errors to users | Use `WorkspaceErrorState` with `onRetry` |
| `animate-spin` without `motion-reduce:animate-none` | Add `motion-reduce:` variant |

---

## Team 11–19 Handoff

### What's ready to use
All primitives in `artifacts/ai-platform/src/components/workspace/` are stable and tested. Import from the barrel:

```tsx
import { WorkspacePanel, WorkspaceStatusBadge, WorkspaceEmptyState, … } from "@/components/workspace";
```

### Integration checklist for each team feature
- [ ] Wrap workspace root in `<WorkspaceDensityProvider>`.
- [ ] Replace all custom status badges with `<WorkspaceStatusBadge status={…}>`.
- [ ] Replace all custom empty / error / loading views with workspace state components.
- [ ] All toolbar buttons use `WorkspaceToolbarButton` or `WorkspaceIconButton`.
- [ ] Panels use `WorkspacePanel` + `WorkspacePanelHeader` + `WorkspaceSection`.
- [ ] All interactive elements have `focus-visible` ring.
- [ ] No hard-coded colours — tokens only.
- [ ] Passes visual QA checklist below.

### Adapter note (Teams 11–19 branches not yet merged)
If a Team 11–19 branch defines a local status badge or empty state that conflicts with these primitives, the migration path is:
1. Replace local component with the workspace primitive.
2. Ensure the `status` prop value the team passes is handled by `resolveWorkspaceStatus()` (add an alias to `PLATFORM_ALIAS` if the backend status string is new).
3. Remove the local component file.

---

## Visual QA Checklist

### Component render
- [ ] Renders in comfortable density without clipping
- [ ] Renders in compact density without overflow
- [ ] Renders in dark mode (add `.dark` to `<html>`)
- [ ] Renders at 200% browser zoom without horizontal scroll

### States
- [ ] Loading state shows spinner and accessible message
- [ ] Empty state shows icon, title, description, and optional action
- [ ] Error state shows red icon, message, and retry button that fires `onRetry`
- [ ] Unavailable state shows correct copy per `reason` prop

### Status badge
- [ ] All 10 canonical statuses render with correct tone
- [ ] Label is always visible (not colour-only)
- [ ] `aria-label` is present on the badge element

### Toolbar
- [ ] Active button has `aria-pressed="true"`
- [ ] Disabled button has `disabled` attribute and muted style
- [ ] Focus ring appears on keyboard focus
- [ ] Tooltip appears on hover with the button label

### Accessibility (manual)
- [ ] Tab through all interactive elements in logical order
- [ ] Screen reader (VoiceOver/NVDA) announces button labels correctly
- [ ] Status badges announced as "status: [label]"
- [ ] No focus trap outside of dialogs/sheets

### No regressions
- [ ] Existing `ui/badge`, `ui/empty`, `ui/spinner` still render correctly
- [ ] Vitest suite passes: `pnpm --filter @workspace/ai-platform run test`
