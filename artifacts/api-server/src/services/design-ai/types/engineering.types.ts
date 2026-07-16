/**
 * Engineering Team — Type Contracts
 *
 * Defines the AgentOutput<T> contract (per Master Rule), team input interfaces,
 * and all engineering pipeline output types.
 *
 * DO NOT import from frontend packages — this file is backend-only.
 */

import type { DesignElement, DesignTemplate } from "../../../types/designTemplate.js";

// ── Master Rule agent contract ─────────────────────────────────────────────────

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

// ── Validation ─────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning" | "info";
  nodeId?: string;
  field?: string;
  message: string;
  suggestedFix?: string;
}

export interface ValidationReport {
  /** true only when zero blocking errors exist */
  passed: boolean;
  /** 0–100; 100 = perfect */
  score: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
}

// ── Optimization ───────────────────────────────────────────────────────────────

export interface OptimizationChange {
  type: string;
  nodeId?: string;
  before: unknown;
  after: unknown;
  reason: string;
}

export interface OptimizationResult {
  template: DesignTemplate;
  changes: OptimizationChange[];
  unresolvedIssues: ValidationIssue[];
}

// ── Team input contracts ───────────────────────────────────────────────────────

/**
 * Output from Team 1 — Discovery Team.
 * Describes what the template must communicate and what variables it needs.
 */
export interface DiscoveryTeamOutput {
  briefSummary: string;
  targetAudience: string;
  communicationGoals: string[];
  requiredVariables: Array<{
    key: string;
    label: string;
    type: "text" | "number" | "currency" | "image" | "color" | "url" | "date" | "boolean";
    required?: boolean;
    defaultValue?: string | number | boolean;
  }>;
  recommendedSizePreset?: "instagram-square" | "instagram-portrait" | "instagram-landscape" | "a4" | "custom";
  canvasWidth?: number;
  canvasHeight?: number;
  brandGuidelines?: {
    primaryColors: string[];
    secondaryColors: string[];
    fonts: string[];
    tone: string;
  };
}

/**
 * Output from Team 2 — Design Team.
 * Describes the visual language to apply across elements.
 */
export interface DesignTeamOutput {
  templateName: string;
  category?: string;
  description?: string;
  layoutStrategy: "centered" | "left-aligned" | "grid" | "hero-bottom" | "split";
  colorPalette: {
    background: string;
    primary: string;
    secondary?: string;
    accent?: string;
    text: string;
    textMuted?: string;
  };
  typography: {
    heading: { fontFamily: string; fontSize: number; fontWeight: number | "bold" };
    body: { fontFamily: string; fontSize: number; fontWeight?: number | "normal" };
    cta?: { fontFamily: string; fontSize: number; fontWeight: number | "bold" };
  };
  decorativeElements?: Array<{
    shape: "rectangle" | "circle" | "rounded-rectangle";
    role: "background" | "accent" | "divider";
    color: string;
  }>;
}

/**
 * Output from Team 3 — Component Team.
 * Describes each visual component in the template.
 */
export interface ComponentTeamOutput {
  componentPlan: Array<{
    id: string;
    componentType: DesignElement["type"];
    purpose: "heading" | "subheading" | "body" | "cta" | "image" | "logo" | "background" | "decoration" | "qrcode" | "divider";
    suggestedContent?: string;
    variableKey?: string;
    suggestedPosition?: { x: number; y: number };
    suggestedSize?: { width: number; height: number };
    zIndexHint?: number;
  }>;
}

export interface EngineeringTeamInput {
  discovery: DiscoveryTeamOutput;
  design: DesignTeamOutput;
  components: ComponentTeamOutput;
}

// ── Pipeline output ────────────────────────────────────────────────────────────

export interface EngineeringPipelineOutput {
  initialTemplate: DesignTemplate;
  initialValidation: ValidationReport;
  optimizedTemplate: DesignTemplate;
  finalValidation: ValidationReport;
  optimizationChanges: OptimizationChange[];
}

// ── Model provider (dependency injection for tests) ───────────────────────────

export interface ModelProviderResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelProvider {
  chat(params: {
    model: string;
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
  }): Promise<ModelProviderResponse>;
}

// ── Safe fonts (backend copy — frontend-independent) ──────────────────────────

export const SAFE_FONT_FAMILIES = new Set([
  "Inter", "Roboto", "Open Sans", "Lato", "Poppins", "Montserrat",
  "Nunito", "Raleway", "Playfair Display", "Merriweather", "Source Sans Pro",
  "PT Sans", "Oswald", "Ubuntu", "Work Sans", "DM Sans", "Plus Jakarta Sans",
  "Fira Sans", "Noto Sans", "Rubik", "Space Grotesk", "IBM Plex Sans",
  "Josefin Sans", "Quicksand", "Karla",
  // Common fallbacks (still safe)
  "Arial", "Helvetica", "Georgia", "Times New Roman", "Verdana",
]);
