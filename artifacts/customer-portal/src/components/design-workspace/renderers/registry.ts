/**
 * design-workspace/renderers/registry.ts
 * CanvasRendererRegistry — deterministic, priority-based, no silent fallbacks.
 *
 * Renderers are compiled modules — never loaded from arbitrary URLs or
 * unvalidated module paths. The registry rejects duplicates and invalid contracts.
 */

import type { CanvasArtifact, CanvasRendererAdapter } from '../types';

export interface RendererResolveSuccess {
  adapter: CanvasRendererAdapter;
  reason?: undefined;
}

export interface RendererResolveFailure {
  adapter: null;
  reason: string;
}

export type RendererResolveResult = RendererResolveSuccess | RendererResolveFailure;

function validateAdapter(adapter: CanvasRendererAdapter): void {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('[CanvasRendererRegistry] Invalid renderer contract: adapter must be an object');
  }
  if (!adapter.rendererId || typeof adapter.rendererId !== 'string') {
    throw new Error('[CanvasRendererRegistry] Invalid renderer contract: rendererId must be a non-empty string');
  }
  if (!Array.isArray(adapter.supportedArtifactTypes)) {
    throw new Error(
      `[CanvasRendererRegistry] "${adapter.rendererId}": supportedArtifactTypes must be an array`,
    );
  }
  if (typeof adapter.canRender !== 'function') {
    throw new Error(
      `[CanvasRendererRegistry] "${adapter.rendererId}": canRender must be a function`,
    );
  }
  if (!adapter.Component || typeof adapter.Component !== 'function') {
    throw new Error(
      `[CanvasRendererRegistry] "${adapter.rendererId}": Component must be a React component`,
    );
  }
  if (typeof adapter.getIntrinsicSize !== 'function') {
    throw new Error(
      `[CanvasRendererRegistry] "${adapter.rendererId}": getIntrinsicSize must be a function`,
    );
  }
}

export class CanvasRendererRegistry {
  /** Insertion-order preserved (Map guarantees this). */
  private readonly adapters: Map<string, CanvasRendererAdapter> = new Map();

  /**
   * Register a renderer adapter.
   * @throws if rendererId is already registered or if the contract is invalid.
   */
  register(adapter: CanvasRendererAdapter): this {
    validateAdapter(adapter);
    if (this.adapters.has(adapter.rendererId)) {
      throw new Error(
        `[CanvasRendererRegistry] Duplicate rendererId: "${adapter.rendererId}"`,
      );
    }
    this.adapters.set(adapter.rendererId, adapter);
    return this;
  }

  /**
   * Resolve the best adapter for the given artifact.
   * Returns { adapter: null, reason } when no adapter can handle it — never silently
   * falls back to the wrong renderer.
   */
  resolve(artifact: CanvasArtifact): RendererResolveResult {
    const candidates: CanvasRendererAdapter[] = [];

    for (const adapter of this.adapters.values()) {
      if (adapter.canRender(artifact)) {
        candidates.push(adapter);
      }
    }

    if (candidates.length === 0) {
      const registered = [...this.adapters.keys()];
      return {
        adapter: null,
        reason:
          `No renderer supports artifact type "${artifact.type}"` +
          (registered.length > 0
            ? ` (registered: ${registered.join(', ')})`
            : ' (no renderers registered)'),
      };
    }

    // Deterministic: higher priority wins; Map insertion order breaks ties.
    candidates.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return { adapter: candidates[0] };
  }

  /** All registered adapters in insertion order. */
  getAll(): ReadonlyArray<CanvasRendererAdapter> {
    return [...this.adapters.values()];
  }

  has(rendererId: string): boolean {
    return this.adapters.has(rendererId);
  }

  get size(): number {
    return this.adapters.size;
  }
}

