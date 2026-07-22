/**
 * Universal Property Panel Engine — Public API
 *
 * Domain-neutral property panel with plugin extension support.
 * Import this module to use the panel in any workspace context.
 *
 * Quick start:
 *   import { PropertyPanelShell, globalSectionRegistry } from "@/components/universal-property-panel";
 *
 *   // Register sections (core or plugin)
 *   globalSectionRegistry.register({ id: "upp:transform", label: "Transform", fields: [...] });
 *
 *   // Render
 *   <PropertyPanelShell context={panelContext} onSave={handleSave} />
 */

// ── Shell (main entry point) ──────────────────────────────────────────────────
export { PropertyPanelShell } from "./PropertyPanelShell";
export type { PropertyPanelShellProps } from "./PropertyPanelShell";

// ── Sub-components (composable) ───────────────────────────────────────────────
export { PropertySection } from "./PropertySection";
export { PropertyFieldRendererHost } from "./PropertyFieldRendererHost";
export { ValidationSummary } from "./ValidationSummary";
export { SaveStatus as SaveStatusBar } from "./SaveStatus";

// ── Context ───────────────────────────────────────────────────────────────────
export { PropertyPanelProvider, usePropertyPanelCtx } from "./context";
export type { PropertyPanelContextValue } from "./context";

// ── Registries ────────────────────────────────────────────────────────────────
export {
  PropertySectionRegistry,
  PropertyFieldRendererRegistry,
  globalSectionRegistry,
  globalRendererRegistry,
  createPluginRegistration,
} from "./registry";

// ── Editing model (hook) ──────────────────────────────────────────────────────
export { usePropertyPanelModel } from "./use-property-panel-model";
export type {
  UsePropertyPanelModelOptions,
  UsePropertyPanelModelResult,
} from "./use-property-panel-model";

// ── Editing model (pure reducer — for custom integration) ─────────────────────
export {
  editingModelReducer,
  makeInitialEditingState,
  isDirty,
  hasErrors,
  canSave,
  getFieldError,
  buildPatch,
} from "./editing-model";

// ── Selection adapter ─────────────────────────────────────────────────────────
export {
  LocalSelectionAdapter,
  BridgedSelectionAdapter,
  selectionToContextFields,
} from "./workspace-selection-adapter";

// ── Security utilities ────────────────────────────────────────────────────────
export { sanitizeLabel, generateInputId, isValueSafe, sanitizePropertyValue } from "./security";

// ── Built-in renderers ────────────────────────────────────────────────────────
export { BUILT_IN_RENDERERS, registerBuiltInRenderers } from "./renderers/index";

// ── Types (all public contracts) ──────────────────────────────────────────────
export type {
  // Values
  PropertyValue,
  DimensionsValue,
  AssetReference,
  // Field types
  PropertyFieldType,
  PropertyFieldOption,
  PropertyFieldDefinition,
  // Section
  PropertySectionDefinition,
  // Context
  PropertyPanelContext,
  // Validation
  PropertyValidationResult,
  PropertyValidationError,
  // Patch
  PropertyPatch,
  // Renderer
  PropertyFieldRenderer,
  PropertyFieldRendererProps,
  // Editing model
  EditingModelState,
  EditingModelAction,
  SaveStatus as SaveStatusType,
  // Selection
  WorkspaceSelection,
  WorkspaceSelectionSource,
  SelectionChangeHandler,
  // Plugin
  PluginPropertyRegistration,
} from "./types";

export { EMPTY_CONTEXT, VALID } from "./types";
