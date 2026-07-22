/**
 * Workspace UI Primitives — Public barrel export
 *
 * Teams 11–19: import from this path:
 *   import { WorkspacePanel, WorkspaceStatusBadge, … } from "@/components/workspace";
 */

// Density context
export {
  WorkspaceDensityProvider,
  useDensity,
  DENSITY_PADDING,
  DENSITY_GAP,
  DENSITY_TEXT,
} from "./workspace-density";
export type { WorkspaceDensity } from "./workspace-density";

// Status vocabulary
export {
  resolveWorkspaceStatus,
  STATUS_TONE_CLASSES,
  STATUS_DOT_CLASSES,
} from "./workspace-status";
export type {
  WorkspaceStatus,
  WorkspaceStatusTone,
  WorkspaceStatusMeta,
} from "./workspace-status";

// Panel layout
export {
  WorkspacePanel,
  WorkspacePanelHeader,
  WorkspaceSection,
  WorkspaceDivider,
} from "./workspace-panel";
export type {
  WorkspacePanelProps,
  WorkspacePanelHeaderProps,
} from "./workspace-panel";

// Toolbar
export {
  WorkspaceToolbarGroup,
  WorkspaceToolbarButton,
  WorkspaceIconButton,
} from "./workspace-toolbar";
export type {
  WorkspaceToolbarGroupProps,
  WorkspaceToolbarButtonProps,
  WorkspaceIconButtonProps,
} from "./workspace-toolbar";

// Status badge
export { WorkspaceStatusBadge } from "./workspace-status-badge";
export type { WorkspaceStatusBadgeProps } from "./workspace-status-badge";

// State components
export {
  WorkspaceLoadingState,
  WorkspaceEmptyState,
  WorkspaceErrorState,
  WorkspaceUnavailableState,
} from "./workspace-states";
export type {
  WorkspaceLoadingStateProps,
  WorkspaceEmptyStateProps,
  WorkspaceErrorStateProps,
  WorkspaceUnavailableStateProps,
  UnavailableReason,
} from "./workspace-states";

// Overlays & resize
export {
  WorkspaceTooltip,
  WorkspaceKeyboardHint,
  WorkspaceDrawer,
  WORKSPACE_RESIZE_HANDLE_CLASSES,
} from "./workspace-overlays";
export type {
  WorkspaceTooltipProps,
  WorkspaceKeyboardHintProps,
  WorkspaceDrawerProps,
} from "./workspace-overlays";
