/**
 * DesignKnowledgeAdapter — Team 23
 *
 * Public facade for the knowledge system. Consumers call query() and
 * receive a DesignKnowledgeResult without knowing which providers are
 * registered or how they work internally.
 *
 * Usage:
 *   import { designKnowledgeAdapter } from "./adapter.js";
 *   const result = await designKnowledgeAdapter.query({ query: "minimalist logo for F&B" });
 */

import type { DesignKnowledgeQuery, DesignKnowledgeResult, KnowledgeAdapter } from "./types.js";
import { KnowledgeProviderRegistry, getDefaultRegistry } from "./registry.js";

export class DesignKnowledgeAdapter {
  private registry: KnowledgeProviderRegistry;

  constructor(registry?: KnowledgeProviderRegistry) {
    this.registry = registry ?? getDefaultRegistry();
  }

  /**
   * Execute a knowledge query across all registered providers.
   * Results are deduplicated, filtered, and attributed to their source.
   */
  async query(q: DesignKnowledgeQuery): Promise<DesignKnowledgeResult> {
    if (!q.query || typeof q.query !== "string" || q.query.trim().length === 0) {
      throw new Error("DesignKnowledgeQuery.query must be a non-empty string.");
    }
    return this.registry.query(q);
  }

  /** Register an additional provider at runtime. */
  registerProvider(adapter: KnowledgeAdapter, priority?: number): void {
    this.registry.register(adapter, priority);
  }

  /** List all registered providers and their priorities. */
  listProviders(): Array<{ id: string; name: string; priority: number }> {
    return this.registry.listProviders();
  }
}

/** Singleton adapter backed by the default provider registry. */
export const designKnowledgeAdapter = new DesignKnowledgeAdapter();
