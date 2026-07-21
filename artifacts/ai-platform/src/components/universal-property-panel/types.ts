/**
 * Universal Property Panel Engine — Public Contracts
 *
 * Domain-neutral. No mention of Fashion, Interior, Packaging, etc.
 * All IDs are opaque strings. Selection IDs are opaque (core must not
 * interpret sleeve, wall, logo-mark, sofa, etc.).
 */

import type React from "react";

// ── Primitive value types ─────────────────────────────────────────────────────

export interface DimensionsValue {
  width: number;
  height: number;
  unit?: string;
}

export interface AssetReference {
  id: string;
  url?: string;
  name?: string;
  mimeType?: string;
}

/**
 * Union of all storable property values.
 * string[]   → multi-select selections
 * DimensionsValue → dimensions field
 * AssetReference  → asset-reference field
 */
export type PropertyValue =
  | string
  | number
  | boolean
  | string[]
  | DimensionsValue
  | AssetReference
  | null
  | undefined;

// ── Field types ───────────────────────────────────────────────────────────────

export type PropertyFieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "multi-select"
  | "color"
  | "date"
  | "dimensions"
  | "percentage"
  | "range"
  | "asset-reference"
  | "enum"
  | "readonly-metadata"
  | "custom";

// ── Selection context ─────────────────────────────────────────────────────────

/**
 * PropertyPanelContext — describes what is currently selected.
 * IDs are opaque; core MUST NOT interpret domain meaning.
 * tenantId MUST be server-resolved. Never trust client-provided tenantId.
 */
export interface PropertyPanelContext {
  /** Opaque artifact ID (e.g. a project, document, or canvas artifact) */
  selectedArtifactId?: string;
  /** Opaque frame/view ID within the artifact */
  selectedFrameId?: string;
  /** Opaque element ID within the frame */
  selectedElementId?: string;
  /** Opaque region ID */
  selectedRegionId?: string;
  /** Opaque layer ID */
  selectedLayerId?: string;
  /** Capability keys granted to current user in current context */
  capabilities: string[];
  /** Panel is in view-only mode (user cannot edit) */
  isReadOnly: boolean;
  /** Server-resolved tenant ID — NEVER accept from client without auth */
  tenantId: string;
}

export const EMPTY_CONTEXT: PropertyPanelContext = {
  capabilities: [],
  isReadOnly: false,
  tenantId: "",
};

// ── Validation ────────────────────────────────────────────────────────────────

export interface PropertyValidationError {
  fieldId?: string; // undefined = section-level / cross-field
  message: string;  // human-readable; NEVER raw Zod message
}

export interface PropertyValidationResult {
  valid: boolean;
  errors: PropertyValidationError[];
}

export const VALID: PropertyValidationResult = { valid: true, errors: [] };

// ── Field option (for select / enum / multi-select) ───────────────────────────

export interface PropertyFieldOption {
  value: string;
  label: string;
  disabled?: boolean;
}

// ── Field definition ──────────────────────────────────────────────────────────

export interface PropertyFieldDefinition {
  /** Unique within a section. Opaque to core. */
  id: string;
  /** Field type — determines which renderer is resolved */
  type: PropertyFieldType | string;
  /** Human-readable label. Rendered as text, NEVER as HTML. */
  label: string;
  description?: string;
  placeholder?: string;
  /** Whether the field must have a non-empty value */
  required?: boolean | ((ctx: PropertyPanelContext) => boolean);
  /** Override read-only per-field */
  readOnly?: boolean | ((ctx: PropertyPanelContext) => boolean);
  /** Hide this field based on context */
  visible?: boolean | ((ctx: PropertyPanelContext) => boolean);
  /** Default value when no canonical value exists */
  defaultValue?: PropertyValue;
  // ── Type-specific ──────────────────────────────────────────────────────────
  /** Options for select / enum / multi-select */
  options?: PropertyFieldOption[];
  /** Numeric bounds (number / range / percentage) */
  min?: number;
  max?: number;
  step?: number;
  /** Display unit (dimensions / number) */
  unit?: string;
  /** Accepted MIME types (asset-reference) */
  accept?: string;
  /** Capabilities required for this field to appear */
  capabilities?: string[];
  /**
   * Field-level validator. Return null for valid, or a result with errors.
   * Cross-field validation: receive allValues.
   */
  validate?: (
    value: PropertyValue,
    allValues: Record<string, PropertyValue>,
    ctx: PropertyPanelContext,
  ) => PropertyValidationResult | null;
}

// ── Section definition ────────────────────────────────────────────────────────

export interface PropertySectionDefinition {
  /** Unique across the entire registry. Rejection on duplicate. */
  id: string;
  /** Human-readable label. Rendered as text, never HTML. */
  label: string;
  /** Lower = appears first. Ties broken by registration order. */
  order?: number;
  defaultOpen?: boolean;
  fields: PropertyFieldDefinition[];
  visible?: boolean | ((ctx: PropertyPanelContext) => boolean);
  /** All fields in the section inherit read-only when this is true */
  readOnly?: boolean | ((ctx: PropertyPanelContext) => boolean);
  /** Capabilities required to show this section */
  capabilities?: string[];
  stability?: "stable" | "beta" | "experimental";
}

// ── Patch (partial update sent to persistence layer) ─────────────────────────

export interface PropertyPatch {
  sectionId: string;
  fieldId: string;
  value: PropertyValue;
  /** Optimistic concurrency token from last confirmed save */
  concurrencyToken?: string;
}

// ── Field renderer ────────────────────────────────────────────────────────────

export interface PropertyFieldRendererProps {
  fieldDef: PropertyFieldDefinition;
  value: PropertyValue;
  onChange: (value: PropertyValue) => void;
  onBlur?: () => void;
  /** Human-readable error string (already translated from raw Zod/schema) */
  error?: string;
  isReadOnly: boolean;
  isDisabled: boolean;
  /**
   * Stable id string for <input id={inputId}> / <label htmlFor={inputId}>.
   * Generated by the shell as `prop-${sectionId}-${fieldId}`.
   */
  inputId: string;
  context: PropertyPanelContext;
}

export interface PropertyFieldRenderer {
  /** Must match the PropertyFieldType string (or a plugin-registered custom type) */
  type: PropertyFieldType | string;
  render: (props: PropertyFieldRendererProps) => React.ReactNode;
}

// ── Save status ───────────────────────────────────────────────────────────────

export type SaveStatus =
  | "idle"
  | "saving"
  | "saved"
  | "failed"
  | "conflict"
  | "permission-denied";

// ── Editing model state ───────────────────────────────────────────────────────

/**
 * EditingModelState separates the seven concerns from the spec:
 * 1. canonicalValues  — last confirmed server state
 * 2. draft            — local working copy
 * 3. dirtyFields      — set of field IDs that differ from canonical
 * 4. fieldErrors      — per-field validation errors
 * 5. saveStatus       — idle | saving | saved | failed | conflict | permission-denied
 * 6. saveError        — message for failed / permission-denied
 * 7. conflictServerValues — server values on stale-version conflict
 */
export interface EditingModelState {
  canonicalValues: Record<string, PropertyValue>;
  draft: Record<string, PropertyValue>;
  dirtyFields: ReadonlySet<string>;
  fieldErrors: Record<string, string[]>;
  saveStatus: SaveStatus;
  saveError?: string;
  conflictServerValues?: Record<string, PropertyValue>;
  concurrencyToken?: string;
  isReadOnly: boolean;
  /** If set, the panel should move focus to this field (e.g. first invalid) */
  focusFieldId?: string;
}

// ── Editing model actions ─────────────────────────────────────────────────────

export type EditingModelAction =
  | { type: "UPDATE_DRAFT"; fieldId: string; value: PropertyValue }
  | { type: "UPDATE_CANONICAL"; values: Record<string, PropertyValue>; token?: string }
  | { type: "RESET" }
  | { type: "BEGIN_SAVE" }
  | { type: "SAVE_SUCCESS"; token?: string }
  | { type: "SAVE_FAILED"; error: string }
  | { type: "PERMISSION_DENIED"; error: string }
  | {
      type: "STALE_VERSION_CONFLICT";
      serverValues: Record<string, PropertyValue>;
      token: string;
    }
  | { type: "RESOLVE_CONFLICT_USE_LOCAL" }
  | { type: "RESOLVE_CONFLICT_USE_SERVER" }
  | { type: "SET_FIELD_ERRORS"; errors: Record<string, string[]> }
  | { type: "CLEAR_FIELD_ERROR"; fieldId: string }
  | { type: "SET_READ_ONLY"; isReadOnly: boolean }
  | { type: "FOCUS_FIELD"; fieldId: string }
  | { type: "CLEAR_FOCUS" };

// ── Selection adapter (Team 11 interface) ─────────────────────────────────────

/**
 * WorkspaceSelection — minimal contract for Team 11 integration.
 * Core does NOT interpret domain meaning of any ID.
 */
export interface WorkspaceSelection {
  selectedArtifactId?: string;
  selectedFrameId?: string;
  selectedElementId?: string;
  selectedRegionId?: string;
  selectedLayerId?: string;
}

export type SelectionChangeHandler = (selection: WorkspaceSelection) => void;

export interface WorkspaceSelectionSource {
  /** Get current selection */
  getSelection(): WorkspaceSelection;
  /** Subscribe to selection changes. Returns unsubscribe function. */
  subscribe(handler: SelectionChangeHandler): () => void;
}

// ── Plugin registration API ───────────────────────────────────────────────────

/**
 * PluginPropertyRegistration — the public API surface available to plugins.
 * Plugins MUST NOT import internal state or hook into private modules.
 */
export interface PluginPropertyRegistration {
  registerSection(section: PropertySectionDefinition): void;
  registerFieldRenderer(renderer: PropertyFieldRenderer): void;
}
