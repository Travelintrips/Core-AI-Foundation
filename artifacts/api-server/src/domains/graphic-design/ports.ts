/**
 * graphic-design/ports.ts — Team 15
 *
 * Port interfaces for Teams 7–14 integration.
 * This domain depends ONLY on these contracts — never on concrete implementations.
 *
 * Adapters that wire these ports to the real Team 7-14 services live in
 * service.ts (resolveAdapters). This keeps the domain logic testable in
 * isolation via mock adapters.
 *
 * Teams referenced:
 *   Team 7-8   → DesignRendererPort (imageDesignerService / designStudioService)
 *   Team 9-10  → TemplateMatcherPort (templateAiService)
 *   Team 11-12 → AssetLibraryPort (assetLibraryService)
 *   Team 13-14 → WorkflowEnginePort (dispatcher / job engine)
 */

import type { GraphicDesignBrief } from "./schema.js";
import type { RenderedDeliverable } from "./qc.js";

// ── Team 7-8: Design Renderer ─────────────────────────────────────────────────

export interface RenderSpec {
  serviceCode:   string;
  variant:       string;
  canvasWidthPx:  number;
  canvasHeightPx: number;
  resolutionDpi:  number;
  colorMode:     "RGB" | "CMYK";
  /** Canvas JSON state (elements, background, etc.) */
  canvasState:   Record<string, unknown>;
  /** Output formats requested */
  formats:       string[];
}

export interface RenderResult {
  success:     boolean;
  deliverable?: RenderedDeliverable;
  /** Signed storage URLs for each generated file, keyed by fileKey. */
  fileUrls:    Record<string, string>;
  error?:      string;
  durationMs:  number;
}

export interface DesignRendererPort {
  /**
   * Render a canvas spec into file deliverables.
   * Team 7-8 implementation: imageDesignerService / designStudioService.
   */
  render(spec: RenderSpec): Promise<RenderResult>;
}

// ── Team 9-10: Template Matcher ───────────────────────────────────────────────

export interface TemplateMatchRequest {
  serviceCode:     string;
  stylePreference: string;
  industry:        string;
  colorPalette:    string[];
  /** Free-text description of the brief for embedding-based matching. */
  briefSummary:    string;
  maxResults:      number;
}

export interface TemplateMatch {
  templateId:     string;
  templateCode:   string;
  score:          number;       // 0–1 similarity
  canvasState:    Record<string, unknown>;
  previewUrl?:    string;
}

export interface TemplateMatchResult {
  matches:   TemplateMatch[];
  usedFallback: boolean;
}

export interface TemplateMatcherPort {
  /**
   * Match a brief to the best design template(s).
   * Team 9-10 implementation: templateAiService.ts / design-templates route.
   */
  matchTemplate(req: TemplateMatchRequest): Promise<TemplateMatchResult>;
}

// ── Team 11-12: Asset Library ─────────────────────────────────────────────────

export interface AssetQuery {
  query:        string;
  style?:       string;
  colorHint?:   string;
  maxResults:   number;
  type:         "icon" | "photo" | "pattern" | "texture" | "illustration";
}

export interface AssetItem {
  assetId:    string;
  url:        string;
  thumbnailUrl?: string;
  license:    "royalty_free" | "creative_commons" | "proprietary";
  format:     string;
  widthPx:    number;
  heightPx:   number;
}

export interface AssetLibraryPort {
  /**
   * Search the asset library for design assets.
   * Team 11-12 implementation: assetLibraryService.ts.
   */
  searchAssets(query: AssetQuery): Promise<AssetItem[]>;

  /**
   * Fetch a specific asset by ID.
   */
  getAsset(assetId: string): Promise<AssetItem | null>;
}

// ── Team 13-14: Workflow / Job Engine ─────────────────────────────────────────

export type JobPriority = "low" | "normal" | "high" | "urgent";

export interface GraphicDesignJobPayload {
  briefId:         string;
  serviceCode:     string;
  packageTier:     string;
  outputFormat:    string;
  brief:           GraphicDesignBrief;
  variantKey:      string;
  conceptIndex:    number;   // 0-based concept number
  totalConcepts:   number;
  manifestFileKey: string;
}

export interface DispatchResult {
  jobId:       string;
  status:      "queued" | "running" | "completed" | "failed";
  estimatedMs?: number;
}

export interface JobStatus {
  jobId:       string;
  status:      "queued" | "running" | "completed" | "failed" | "cancelled";
  progressPct: number;
  result?:     Record<string, unknown>;
  error?:      string;
  startedAt?:  string;
  completedAt?: string;
}

export interface WorkflowEnginePort {
  /**
   * Dispatch a graphic design generation job.
   * Team 13-14 implementation: dispatcher / job engine routes.
   */
  dispatch(payload: GraphicDesignJobPayload, priority: JobPriority): Promise<DispatchResult>;

  /**
   * Poll job status.
   */
  getStatus(jobId: string): Promise<JobStatus>;

  /**
   * Cancel a queued or running job.
   */
  cancel(jobId: string): Promise<void>;
}

// ── Port registry (injected into service functions) ───────────────────────────

export interface GraphicDesignPorts {
  renderer:    DesignRendererPort;
  matcher:     TemplateMatcherPort;
  assets:      AssetLibraryPort;
  workflow:    WorkflowEnginePort;
}
