/**
 * Component Plan Types — Team 3 (Component Team)
 *
 * Defines the shared contracts for Agents 9–11 and the upstream team stubs
 * that Team 3 depends on (DiscoveryTeamOutput / DesignTeamOutput).
 *
 * IMPORTANT: DiscoveryTeamOutput and DesignTeamOutput are defined as stubs
 * here because Teams 1 and 2 have not yet delivered their contracts. Once
 * those teams publish their types, import from their canonical location and
 * remove these stubs.
 */

// ─── Master Rule: common agent envelope ──────────────────────────────────────

export type AgentStatus = "success" | "failed" | "skipped";

export interface AgentExecutionMetadata {
  agentId: string;
  agentName: string;
  agentVersion: string;
  model?: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  retryCount: number;
}

export interface AgentOutput<T> {
  status: AgentStatus;
  data: T | null;
  warnings: string[];
  errors: string[];
  metadata: AgentExecutionMetadata;
}

// ─── Upstream team stubs (replace when Teams 1 & 2 publish) ─────────────────

/**
 * @stub Replace with the canonical export from Team 1 once available.
 * Minimum fields required by Component Team agents.
 */
export interface DiscoveryTeamOutput {
  /** Service / product category (e.g. "restaurant", "fashion", "logistics") */
  category: string;
  /** Industry vertical (e.g. "F&B", "retail") */
  industry?: string;
  /** High-level objective of the design */
  objective?: string;
  /** Target audience description */
  targetAudience?: string;
  /** Key messages to communicate */
  keyMessages?: string[];
  /** Brand name discovered from brief */
  brandName?: string;
}

/**
 * @stub Replace with the canonical export from Team 2 once available.
 * Minimum fields required by Component Team agents.
 */
export interface DesignTeamOutput {
  /** Design style identifier (e.g. "bold-modern", "minimalist") */
  style: string;
  /** Primary color palette (hex values) */
  colorPalette?: string[];
  /** Font family recommendations */
  fontPrimary?: string;
  fontSecondary?: string;
  /** Canvas dimensions in pixels */
  canvasWidth: number;
  canvasHeight: number;
  /** Section layout from design team */
  sections: Array<{
    id: string;
    name: string;
    /** Relative vertical order */
    order: number;
    /** Purpose of the section (e.g. "hero", "product", "footer") */
    purpose: string;
  }>;
}

// ─── Team 3 Input ─────────────────────────────────────────────────────────────

export interface ComponentTeamInput {
  discovery: DiscoveryTeamOutput;
  design: DesignTeamOutput;
}

// ─── Agent 9: Component Builder AI ───────────────────────────────────────────

export type ComponentType =
  | "logo"
  | "image_placeholder"
  | "title"
  | "subtitle"
  | "description"
  | "price"
  | "cta"
  | "qr_code"
  | "contact_information"
  | "footer"
  | "social_icon"
  | "badge"
  | "divider"
  | "background"
  | "shape";

export type ContentSource = "static" | "variable" | "asset" | "generated-placeholder";

export type LayerRole = "background" | "decoration" | "content" | "foreground";

export interface ComponentRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComponentDefinition {
  /** Semantic, stable ID (e.g. "hero-title", "product-image") */
  id: string;
  sectionId: string;
  type: ComponentType;
  role: string;
  required: boolean;
  contentSource: ContentSource;
  /** Key into VariablePlan.variables[].key when contentSource === "variable" */
  bindingKey?: string;
  region: ComponentRegion;
  layerRole: LayerRole;
  properties: Record<string, unknown>;
}

export interface ComponentPlan {
  components: ComponentDefinition[];
}

// ─── Agent 10: Variable Designer AI ──────────────────────────────────────────

export type VariableType =
  | "text"
  | "multiline"
  | "number"
  | "currency"
  | "url"
  | "phone"
  | "email"
  | "date";

export interface VariableValidation {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
}

export interface VariableFormatting {
  locale?: string;
  currency?: string;
  prefix?: string;
  suffix?: string;
}

export interface VariableDefinition {
  key: string;
  label: string;
  type: VariableType;
  required: boolean;
  defaultValue?: string | number;
  placeholder?: string;
  validation?: VariableValidation;
  formatting?: VariableFormatting;
  /** IDs of components that reference this variable */
  usedByComponentIds: string[];
}

export interface VariablePlan {
  variables: VariableDefinition[];
}

// ─── Agent 11: Asset Planner AI ───────────────────────────────────────────────

export type AssetType = "photo" | "logo" | "icon" | "background" | "illustration" | "qr";

export type AssetFit = "cover" | "contain" | "fill";

export type CropFocus = "center" | "top" | "bottom" | "left" | "right";

export interface AssetDimensions {
  width: number;
  height: number;
}

export interface AssetDefinition {
  /** Unique, stable ID (e.g. "hero-logo", "product-photo-1") */
  id: string;
  type: AssetType;
  /** ID of the component this asset populates */
  componentId: string;
  purpose: string;
  required: boolean;
  placeholderLabel: string;
  dimensions: AssetDimensions;
  /** e.g. "1:1", "4:3", "16:9" */
  aspectRatio: string;
  fit: AssetFit;
  cropFocus?: CropFocus;
  acceptedMimeTypes?: string[];
  /** Human-readable visual guidance for upload (e.g. "Use a high-contrast logo on transparent background") */
  visualGuidance: string[];
}

export interface AssetPlan {
  assets: AssetDefinition[];
}

// ─── Team 3 Output ────────────────────────────────────────────────────────────

export interface ComponentTeamOutput {
  componentPlan: ComponentPlan;
  variablePlan: VariablePlan;
  assetPlan: AssetPlan;
}

// ─── Validation error ─────────────────────────────────────────────────────────

export interface ComponentTeamValidationError {
  code:
    | "DUPLICATE_COMPONENT_ID"
    | "DUPLICATE_VARIABLE_KEY"
    | "COMPONENT_WITHOUT_SECTION"
    | "VARIABLE_WITHOUT_COMPONENT"
    | "ASSET_WITHOUT_COMPONENT"
    | "REGION_OUT_OF_CANVAS"
    | "INVALID_ASSET_DIMENSION"
    | "REQUIRED_COMPONENT_WITHOUT_SOURCE";
  message: string;
  context?: Record<string, unknown>;
}
