/**
 * Team 32 — DesignRendererRegistry
 *
 * Manages a pool of DesignRendererAdapter instances and resolves the best
 * adapter for a given render request.
 *
 * Registry invariants:
 *  - Renderer IDs are globally unique — registration throws on duplicate.
 *  - Unavailable adapters are never returned by resolve().
 *  - Resolution is capability-based and deterministic (priority ASC, then rendererId).
 *  - No arbitrary module loading — adapters are registered explicitly.
 *  - Maximum registry size is capped (DESIGN_RENDER_ADAPTER_LIMITS.MAX_REGISTRY_SIZE).
 */

import { randomUUID } from "crypto";
import type {
  DesignRendererAdapter,
  DesignRenderRequest,
  DesignRenderCapability,
  DesignRenderFormat,
} from "./types.js";
import {
  DesignRenderError,
  DESIGN_RENDER_ADAPTER_LIMITS,
  SUPPORTED_FORMATS,
} from "./types.js";

// ── Resolution result ─────────────────────────────────────────────────────────

export interface RegistryResolveResult {
  adapter: DesignRendererAdapter;
  /** Alternate adapters that also matched, in priority order. */
  alternatives: DesignRendererAdapter[];
}

// ── Registry ──────────────────────────────────────────────────────────────────

export class DesignRendererRegistry {
  private readonly adapters = new Map<string, DesignRendererAdapter>();

  /**
   * Register an adapter.
   *
   * @throws DesignRenderError(RENDERER_CONFLICT) if the rendererId is already registered.
   * @throws DesignRenderError(RESOURCE_LIMIT_EXCEEDED) if the registry is full.
   */
  register(adapter: DesignRendererAdapter): void {
    if (this.adapters.size >= DESIGN_RENDER_ADAPTER_LIMITS.MAX_REGISTRY_SIZE) {
      throw new DesignRenderError({
        code: "RESOURCE_LIMIT_EXCEEDED",
        message: `Registry is full (max ${DESIGN_RENDER_ADAPTER_LIMITS.MAX_REGISTRY_SIZE} adapters)`,
        retryable: false,
      });
    }

    if (this.adapters.has(adapter.rendererId)) {
      throw new DesignRenderError({
        code: "RENDERER_CONFLICT",
        message: `Renderer "${adapter.rendererId}" is already registered`,
        retryable: false,
      });
    }

    // Validate the capability contract before accepting registration
    validateCapability(adapter.capability);

    this.adapters.set(adapter.rendererId, adapter);
  }

  /**
   * Resolve the highest-priority available adapter for a request.
   *
   * Resolution algorithm (deterministic):
   *  1. Filter: adapter.available === true
   *  2. Filter: adapter.capability.supportedArtifactKinds includes request.artifactKind
   *  3. Filter: adapter.capability.supportedFormats includes request.profile.format
   *  4. Filter: adapter.capability.supportedTargets includes request.profile.purpose
   *  5. Filter: adapter.canHandle(request) === true
   *  6. Sort: priority ASC, then rendererId lexicographically (tie-break)
   *
   * Returns null (never throws) when no match exists — callers emit UNAVAILABLE.
   */
  resolve(request: DesignRenderRequest): RegistryResolveResult | null {
    const candidates = Array.from(this.adapters.values())
      .filter((a) => {
        const cap = a.capability;
        return (
          cap.available &&
          cap.supportedArtifactKinds.includes(request.artifactKind) &&
          cap.supportedFormats.includes(request.profile.format) &&
          cap.supportedTargets.includes(request.profile.purpose) &&
          a.canHandle(request)
        );
      })
      .sort((a, b) => {
        const pDiff = a.capability.priority - b.capability.priority;
        if (pDiff !== 0) return pDiff;
        return a.rendererId.localeCompare(b.rendererId);
      });

    if (candidates.length === 0) return null;

    const [first, ...rest] = candidates as [DesignRendererAdapter, ...DesignRendererAdapter[]];
    return { adapter: first, alternatives: rest };
  }

  /**
   * Return a specific adapter by rendererId, or undefined if not registered.
   */
  getAdapter(rendererId: string): DesignRendererAdapter | undefined {
    return this.adapters.get(rendererId);
  }

  /**
   * List all registered capability descriptors (available and unavailable).
   * Sorted by priority ASC, then rendererId.
   */
  listCapabilities(): DesignRenderCapability[] {
    return Array.from(this.adapters.values())
      .map((a) => a.capability)
      .sort((a, b) => {
        const pDiff = a.priority - b.priority;
        if (pDiff !== 0) return pDiff;
        return a.rendererId.localeCompare(b.rendererId);
      });
  }

  /** Number of registered adapters. */
  get size(): number {
    return this.adapters.size;
  }
}

// ── Validation helpers ────────────────────────────────────────────────────────

function validateCapability(cap: DesignRenderCapability): void {
  if (!cap.rendererId || cap.rendererId.trim() === "") {
    throw new DesignRenderError({
      code: "RENDERER_CONFLICT",
      message: "Capability rendererId must be a non-empty string",
      retryable: false,
    });
  }
  if (cap.supportedFormats.length === 0) {
    throw new DesignRenderError({
      code: "PROFILE_INVALID",
      message: `Adapter "${cap.rendererId}" declares no supported formats`,
      retryable: false,
    });
  }
  for (const fmt of cap.supportedFormats) {
    if (!SUPPORTED_FORMATS.has(fmt)) {
      throw new DesignRenderError({
        code: "UNSUPPORTED_FORMAT",
        message: `Adapter "${cap.rendererId}" declared unknown format "${fmt}"`,
        retryable: false,
      });
    }
  }
  if (cap.timeoutMs <= 0) {
    throw new DesignRenderError({
      code: "PROFILE_INVALID",
      message: `Adapter "${cap.rendererId}" has invalid timeoutMs ${cap.timeoutMs}`,
      retryable: false,
    });
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/** Create a new empty registry. */
export function createDesignRendererRegistry(): DesignRendererRegistry {
  return new DesignRendererRegistry();
}

// ── Request helpers ───────────────────────────────────────────────────────────

/** Attach a requestId if not already present. Mutates in-place for efficiency. */
export function ensureRequestId(request: DesignRenderRequest): string {
  if (!request.requestId) {
    request.requestId = randomUUID();
  }
  return request.requestId;
}

/** Validate profile dimensions against global limits. */
export function validateRenderProfile(
  profile: { widthPx: number; heightPx: number; format: DesignRenderFormat; quality?: number },
  requestId?: string,
): void {
  if (
    profile.widthPx <= 0 ||
    profile.widthPx > DESIGN_RENDER_ADAPTER_LIMITS.MAX_OUTPUT_WIDTH_PX
  ) {
    throw new DesignRenderError({
      code: "PROFILE_INVALID",
      message: `Output widthPx ${profile.widthPx} is out of range [1, ${DESIGN_RENDER_ADAPTER_LIMITS.MAX_OUTPUT_WIDTH_PX}]`,
      retryable: false,
      requestId,
    });
  }
  if (
    profile.heightPx <= 0 ||
    profile.heightPx > DESIGN_RENDER_ADAPTER_LIMITS.MAX_OUTPUT_HEIGHT_PX
  ) {
    throw new DesignRenderError({
      code: "PROFILE_INVALID",
      message: `Output heightPx ${profile.heightPx} is out of range [1, ${DESIGN_RENDER_ADAPTER_LIMITS.MAX_OUTPUT_HEIGHT_PX}]`,
      retryable: false,
      requestId,
    });
  }
  if (!SUPPORTED_FORMATS.has(profile.format)) {
    throw new DesignRenderError({
      code: "UNSUPPORTED_FORMAT",
      message: `Format "${profile.format}" is not a recognized DesignRenderFormat`,
      retryable: false,
      requestId,
    });
  }
  if (profile.quality !== undefined && (profile.quality < 0 || profile.quality > 100)) {
    throw new DesignRenderError({
      code: "PROFILE_INVALID",
      message: `quality must be 0-100, got ${profile.quality}`,
      retryable: false,
      requestId,
    });
  }
}
