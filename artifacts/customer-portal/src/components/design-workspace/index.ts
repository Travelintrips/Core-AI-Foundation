/**
 * design-workspace — Public API
 * Keep exports minimal: only what external consumers actually need.
 */

import { CanvasRendererRegistry } from './renderers/registry';
import { IMAGE_RENDERER } from './renderers/ImageRenderer';
import { FALLBACK_RENDERER } from './renderers/FallbackRenderer';

// Shell
export { DesignWorkspaceShell } from './DesignWorkspaceShell';
export type { DesignWorkspaceShellProps } from './DesignWorkspaceShell';

// Viewport
export { CanvasViewport } from './CanvasViewport';
export type { CanvasViewportProps } from './CanvasViewport';

// Renderer host
export { CanvasRendererHost } from './CanvasRendererHost';
export type { CanvasRendererHostProps } from './CanvasRendererHost';

// Toolbar & status bar (for custom layouts)
export { WorkspaceToolbar } from './WorkspaceToolbar';
export { WorkspaceStatusBar } from './WorkspaceStatusBar';

// Registry
export { CanvasRendererRegistry } from './renderers/registry';
export type { RendererResolveResult } from './renderers/registry';

// Built-in renderers (register explicitly — no auto-registration side effects)
export { IMAGE_RENDERER } from './renderers/ImageRenderer';
export { FALLBACK_RENDERER } from './renderers/FallbackRenderer';

// Overlay host
export { CanvasOverlayHost, LoadingOverlay, ErrorOverlay, GeneratingOverlay } from './overlays/CanvasOverlayHost';

// Hook
export { useCanvasTransform } from './hooks/use-canvas-transform';
export type { UseCanvasTransformReturn } from './hooks/use-canvas-transform';

// Types
export type {
  CanvasTransform,
  CanvasArtifact,
  CanvasArtifactStatus,
  CanvasFrame,
  CanvasSelection,
  CanvasOverlayDefinition,
  CanvasOverlayProps,
  CanvasRendererAdapter,
  RendererProps,
  RendererIntrinsicSize,
  CanvasWorkspaceError,
  WorkspacePermissions,
} from './types';
export { EMPTY_SELECTION, READ_ONLY_PERMISSIONS } from './types';

// Transform utilities (for plugin/domain authors)
export {
  calculateFitTransform,
  clampTransform,
  clampScale,
  zoomAroundPoint,
  panByKeyboard,
  resetTransform,
  transformToCss,
  serializeTransform,
  deserializeTransform,
  DEFAULT_TRANSFORM,
  CANVAS_MIN_SCALE,
  CANVAS_MAX_SCALE,
  CANVAS_PAN_STEP,
} from './utils/transform';

// Selection state
export { selectionReducer, initialSelection } from './state/selection';
export type { SelectionAction } from './state/selection';

/**
 * Factory: build a registry with the two built-in renderers pre-registered.
 * Additional adapters can be registered after creation.
 *
 * Usage:
 *   import { createDefaultRegistry } from '@/components/design-workspace';
 *   const registry = createDefaultRegistry(); // image + fallback built in
 *   registry.register(myDomainRenderer);
 */
export function createDefaultRegistry(): CanvasRendererRegistry {
  const registry = new CanvasRendererRegistry();
  registry.register(IMAGE_RENDERER);
  registry.register(FALLBACK_RENDERER);
  return registry;
}
