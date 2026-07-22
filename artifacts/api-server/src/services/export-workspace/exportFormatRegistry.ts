/**
 * exportFormatRegistry.ts — Team 17: Universal Design Export Workspace
 *
 * Plugin-based format registry. Core does NOT hard-code every domain's
 * capabilities — formats and presets are registered by engines/plugins at
 * startup. Core only defines the contract types and the registry API.
 *
 * Honest capability rule: if a conversion is genuinely unavailable, the
 * registry exposes an ExportCapability with available=false and a clear
 * reason. We NEVER fabricate output or label spec-rendered previews as
 * real PDF conversions.
 */

// ── Contract types ─────────────────────────────────────────────────────────────

export type ExportEngineType = "document" | "presentation" | "image" | "zip" | "custom";

/**
 * Declares a single export format (e.g. "pdf", "pptx", "png", "zip").
 * Registered by engines/plugins — never hard-coded into core.
 */
export interface ExportFormatDefinition {
  /** Unique slug. Must match [a-z0-9_-]+  */
  formatId: string;
  /** Human-readable label (e.g. "PDF Document") */
  label: string;
  /** MIME type for the output file */
  mimeType: string;
  /** Which engine produces this format */
  engineType: ExportEngineType;
  /** File extension without dot (e.g. "pdf") */
  extension: string;

  // ── Feature flags — what this format supports ─────────────────────────────
  supportsResolution: boolean;
  supportsDimensions: boolean;
  supportsQuality: boolean;
  supportsCompression: boolean;
  supportsBackground: boolean;
  supportsAnnotations: boolean;
  supportsPageSelection: boolean;
  supportsVersionSelection: boolean;
  supportsMetadata: boolean;
  supportsFilename: boolean;

  // ── Domain scoping (empty = all domains) ─────────────────────────────────
  domains: string[];

  // ── Honest availability ───────────────────────────────────────────────────
  /** True only when the engine is actually wired and can produce output */
  available: boolean;
  /**
   * Required when available=false. Must clearly explain WHY this format
   * cannot be produced (e.g. "LibreOffice conversion not available in this
   * environment — use PDF instead"). Never omit this for unavailable formats.
   */
  unavailableReason?: string;

  // ── Cost / performance hints ──────────────────────────────────────────────
  estimatedCostCentsPerPage: number;
  estimatedSecondsPerPage: number;
  maxFileSizeMb: number;
}

/**
 * A named preset bundles export settings that users can save and reuse.
 */
export interface ExportPreset {
  presetId: string;
  label: string;
  formatId: string;
  settings: ExportSettings;
  /** Optional domain restriction */
  domains: string[];
  builtIn: boolean;
}

/**
 * The full set of export configuration knobs.
 */
export interface ExportSettings {
  /** Target format (must match a registered formatId) */
  formatId: string;
  /** DPI for raster outputs */
  resolution?: number;
  /** Width × height in pixels or mm, depending on format */
  dimensions?: { width: number; height: number; unit: "px" | "mm" | "pt" };
  /** Which pages/frames to include (1-based). Empty = all. */
  pages?: number[];
  /** Design version id. Undefined = latest. */
  versionId?: number;
  /** Background colour (CSS hex) or "transparent" */
  background?: string;
  /** Output quality 1–100 (for JPEG/WebP) */
  quality?: number;
  /** Compression level 0–9 (for PNG/ZIP) */
  compression?: number;
  /** Whether to embed document metadata (title, author, etc.) */
  includeMetadata?: boolean;
  /** Whether to include annotations/comments */
  includeAnnotations?: boolean;
  /** Sanitized output filename (no path separators, no null bytes) */
  filename?: string;
  /** Output destination tag (e.g. "download", "storage", "email") */
  outputDestination?: "download" | "storage";
}

/**
 * The capability of a specific format, optionally scoped to a domain.
 */
export interface ExportCapability {
  formatId: string;
  label: string;
  mimeType: string;
  extension: string;
  engineType: ExportEngineType;
  available: boolean;
  unavailableReason?: string;
  features: {
    resolution: boolean;
    dimensions: boolean;
    quality: boolean;
    compression: boolean;
    background: boolean;
    annotations: boolean;
    pageSelection: boolean;
    versionSelection: boolean;
    metadata: boolean;
    filename: boolean;
  };
  limits: {
    maxFileSizeMb: number;
    estimatedCostCentsPerPage: number;
    estimatedSecondsPerPage: number;
  };
}

/**
 * A validated, tenant-stamped export request submitted through the workspace.
 */
export interface ExportRequest {
  /** Design project identifier (domain-specific) */
  projectId: string;
  /** Optional domain tag (e.g. "fashion", "interior") */
  domain?: string;
  /** All export settings */
  settings: ExportSettings;
  /** Client-supplied idempotency key. Optional but recommended. */
  idempotencyKey?: string;
}

/**
 * Cost and time estimate before the job is submitted.
 */
export interface ExportEstimate {
  formatId: string;
  label: string;
  pageCount: number;
  estimatedCostCents: number;
  estimatedDurationSeconds: number;
  available: boolean;
  unavailableReason?: string;
  notes: string[];
}

/**
 * A lightweight summary of an in-flight or completed export job.
 * Returned by GET /ai/export-workspace/jobs/:jobId
 */
export interface ExportJobSummary {
  jobId: number;
  jobCode: string;
  status: "queued" | "processing" | "succeeded" | "failed" | "canceled" | "retrying";
  formatId: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  progressPct?: number;
  errorMessage?: string;
  retryCount: number;
  canCancel: boolean;
  canRetry: boolean;
}

/**
 * Final export result — includes signed download URL if succeeded.
 */
export interface ExportResult {
  jobId: number;
  status: "succeeded" | "failed";
  formatId: string;
  filename: string;
  mimeType: string;
  fileSizeBytes?: number;
  /** Short-lived signed download URL. Undefined when job has not succeeded. */
  downloadUrl?: string;
  /** ISO expiry of the download URL */
  downloadExpiresAt?: string;
  /** Only present if raw storage path available to admin caller */
  storagePath?: string;
  errorMessage?: string;
}

/**
 * Result of validating an ExportRequest.
 */
export interface ExportValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export class ExportFormatRegistry {
  private readonly formats = new Map<string, ExportFormatDefinition>();
  private readonly presets = new Map<string, ExportPreset>();

  // ── Format registration ──────────────────────────────────────────────────

  /**
   * Register a format definition. Throws if formatId already registered
   * (duplicate registrations signal a bug in plugin loading order).
   */
  register(definition: ExportFormatDefinition): void {
    if (this.formats.has(definition.formatId)) {
      throw new Error(
        `ExportFormatRegistry: duplicate formatId "${definition.formatId}" — each format must be registered exactly once.`,
      );
    }
    this.formats.set(definition.formatId, definition);
  }

  /** Register a preset. Throws on duplicate presetId. */
  registerPreset(preset: ExportPreset): void {
    if (this.presets.has(preset.presetId)) {
      throw new Error(
        `ExportFormatRegistry: duplicate presetId "${preset.presetId}".`,
      );
    }
    if (!this.formats.has(preset.formatId)) {
      throw new Error(
        `ExportFormatRegistry: preset "${preset.presetId}" references unknown formatId "${preset.formatId}".`,
      );
    }
    this.presets.set(preset.presetId, preset);
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  /** List all registered formats, optionally filtered by domain. */
  listFormats(options?: { domain?: string }): ExportFormatDefinition[] {
    const all = Array.from(this.formats.values());
    if (!options?.domain) return all;
    const d = options.domain;
    return all.filter((f) => f.domains.length === 0 || f.domains.includes(d));
  }

  /** Get a single format definition, or undefined if unknown. */
  getFormat(formatId: string): ExportFormatDefinition | undefined {
    return this.formats.get(formatId);
  }

  /** Derive an ExportCapability for a formatId + optional domain. */
  getCapability(formatId: string, domain?: string): ExportCapability | null {
    const f = this.formats.get(formatId);
    if (!f) return null;

    // Domain-scoped availability check
    const domainSupported =
      f.domains.length === 0 || !domain || f.domains.includes(domain);
    const available = f.available && domainSupported;
    const unavailableReason = !f.available
      ? f.unavailableReason
      : !domainSupported
        ? `Format "${formatId}" is not available for domain "${domain}".`
        : undefined;

    return {
      formatId: f.formatId,
      label: f.label,
      mimeType: f.mimeType,
      extension: f.extension,
      engineType: f.engineType,
      available,
      unavailableReason,
      features: {
        resolution: f.supportsResolution,
        dimensions: f.supportsDimensions,
        quality: f.supportsQuality,
        compression: f.supportsCompression,
        background: f.supportsBackground,
        annotations: f.supportsAnnotations,
        pageSelection: f.supportsPageSelection,
        versionSelection: f.supportsVersionSelection,
        metadata: f.supportsMetadata,
        filename: f.supportsFilename,
      },
      limits: {
        maxFileSizeMb: f.maxFileSizeMb,
        estimatedCostCentsPerPage: f.estimatedCostCentsPerPage,
        estimatedSecondsPerPage: f.estimatedSecondsPerPage,
      },
    };
  }

  /** List all registered presets, optionally filtered by domain. */
  listPresets(options?: { domain?: string }): ExportPreset[] {
    const all = Array.from(this.presets.values());
    if (!options?.domain) return all;
    const d = options.domain;
    return all.filter((p) => p.domains.length === 0 || p.domains.includes(d));
  }

  getPreset(presetId: string): ExportPreset | undefined {
    return this.presets.get(presetId);
  }

  /** How many formats are registered (useful for health checks). */
  get size(): number {
    return this.formats.size;
  }
}

// ── Singleton registry + built-in formats ─────────────────────────────────────

export const exportFormatRegistry = new ExportFormatRegistry();

/**
 * Register the platform's built-in formats.
 * Called once at server startup — idempotent via the duplicate guard above.
 * Engine-specific plugins may call registerAdditionalFormats() after this.
 */
export function initExportFormatRegistry(): void {
  // PDF — produced by the existing Document Engine
  exportFormatRegistry.register({
    formatId: "pdf",
    label: "PDF Document",
    mimeType: "application/pdf",
    engineType: "document",
    extension: "pdf",
    supportsResolution: false,
    supportsDimensions: false,
    supportsQuality: false,
    supportsCompression: false,
    supportsBackground: true,
    supportsAnnotations: false,
    supportsPageSelection: true,
    supportsVersionSelection: true,
    supportsMetadata: true,
    supportsFilename: true,
    domains: [],           // available for all domains
    available: true,
    estimatedCostCentsPerPage: 0,
    estimatedSecondsPerPage: 4,
    maxFileSizeMb: 50,
  });

  // PPTX — produced by the existing Presentation Engine
  exportFormatRegistry.register({
    formatId: "pptx",
    label: "PowerPoint Presentation",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    engineType: "presentation",
    extension: "pptx",
    supportsResolution: false,
    supportsDimensions: true,
    supportsQuality: false,
    supportsCompression: false,
    supportsBackground: true,
    supportsAnnotations: false,
    supportsPageSelection: true,
    supportsVersionSelection: true,
    supportsMetadata: true,
    supportsFilename: true,
    domains: [],
    available: true,
    estimatedCostCentsPerPage: 0,
    estimatedSecondsPerPage: 2,
    maxFileSizeMb: 100,
  });

  // PNG — produced by the existing Universal Renderer / Konva canvas export
  exportFormatRegistry.register({
    formatId: "png",
    label: "PNG Image",
    mimeType: "image/png",
    engineType: "image",
    extension: "png",
    supportsResolution: true,
    supportsDimensions: true,
    supportsQuality: false,
    supportsCompression: true,
    supportsBackground: true,
    supportsAnnotations: false,
    supportsPageSelection: true,
    supportsVersionSelection: true,
    supportsMetadata: false,
    supportsFilename: true,
    domains: [],
    available: true,
    estimatedCostCentsPerPage: 0,
    estimatedSecondsPerPage: 2,
    maxFileSizeMb: 30,
  });

  // JPEG — image export with quality compression
  exportFormatRegistry.register({
    formatId: "jpeg",
    label: "JPEG Image",
    mimeType: "image/jpeg",
    engineType: "image",
    extension: "jpg",
    supportsResolution: true,
    supportsDimensions: true,
    supportsQuality: true,
    supportsCompression: false,
    supportsBackground: true,
    supportsAnnotations: false,
    supportsPageSelection: true,
    supportsVersionSelection: true,
    supportsMetadata: false,
    supportsFilename: true,
    domains: [],
    available: true,
    estimatedCostCentsPerPage: 0,
    estimatedSecondsPerPage: 2,
    maxFileSizeMb: 20,
  });

  // SVG — honest: not yet wired to a renderer
  exportFormatRegistry.register({
    formatId: "svg",
    label: "SVG Vector",
    mimeType: "image/svg+xml",
    engineType: "image",
    extension: "svg",
    supportsResolution: false,
    supportsDimensions: false,
    supportsQuality: false,
    supportsCompression: false,
    supportsBackground: true,
    supportsAnnotations: false,
    supportsPageSelection: false,
    supportsVersionSelection: false,
    supportsMetadata: false,
    supportsFilename: true,
    domains: ["graphic_design"],
    available: false,
    unavailableReason:
      "SVG vector export is not yet available. The canvas renderer produces raster output only. Use PNG at high resolution as an alternative.",
    estimatedCostCentsPerPage: 0,
    estimatedSecondsPerPage: 0,
    maxFileSizeMb: 5,
  });

  // ZIP — bundles all deliverables (uses existing zipDeliveryService)
  exportFormatRegistry.register({
    formatId: "zip",
    label: "ZIP Bundle (all deliverables)",
    mimeType: "application/zip",
    engineType: "zip",
    extension: "zip",
    supportsResolution: false,
    supportsDimensions: false,
    supportsQuality: false,
    supportsCompression: true,
    supportsBackground: false,
    supportsAnnotations: false,
    supportsPageSelection: false,
    supportsVersionSelection: false,
    supportsMetadata: true,
    supportsFilename: true,
    domains: [],
    available: true,
    estimatedCostCentsPerPage: 0,
    estimatedSecondsPerPage: 10,
    maxFileSizeMb: 500,
  });

  // Built-in presets
  exportFormatRegistry.registerPreset({
    presetId: "print-ready-pdf",
    label: "Print-Ready PDF",
    formatId: "pdf",
    settings: { formatId: "pdf", includeMetadata: true, background: "#ffffff" },
    domains: [],
    builtIn: true,
  });

  exportFormatRegistry.registerPreset({
    presetId: "web-png-screen",
    label: "Web PNG (screen resolution)",
    formatId: "png",
    settings: { formatId: "png", resolution: 96, quality: 90, background: "#ffffff" },
    domains: [],
    builtIn: true,
  });

  exportFormatRegistry.registerPreset({
    presetId: "high-res-png",
    label: "High-Resolution PNG",
    formatId: "png",
    settings: { formatId: "png", resolution: 300, compression: 6, background: "#ffffff" },
    domains: [],
    builtIn: true,
  });

  exportFormatRegistry.registerPreset({
    presetId: "presentation-pptx",
    label: "Standard Presentation (PPTX)",
    formatId: "pptx",
    settings: { formatId: "pptx", includeMetadata: true },
    domains: [],
    builtIn: true,
  });

  exportFormatRegistry.registerPreset({
    presetId: "full-project-zip",
    label: "Full Project Bundle (ZIP)",
    formatId: "zip",
    settings: { formatId: "zip", includeMetadata: true },
    domains: [],
    builtIn: true,
  });
}
