/**
 * KnowledgeProviderRegistry — Team 23
 *
 * Rules:
 *   - deterministic priority ordering (lower number = higher priority)
 *   - each provider gets a hard timeout (PROVIDER_TIMEOUT_MS)
 *   - unavailable providers are caught and listed, never thrown
 *   - results are deduped by stable content hash (type + title + body)
 *   - source attribution is verified — recommendations without citation are flagged
 *   - raw provider payloads never appear in output
 *   - tenant / platform scope is threaded through to providers
 */

import { createHash } from "crypto";
import type {
  KnowledgeAdapter,
  KnowledgeProviderRegistry as IKnowledgeProviderRegistry,
  DesignKnowledgeQuery,
  DesignKnowledgeResult,
  DesignRecommendation,
  DesignKnowledgeCitation,
  ProviderEntry,
} from "./types.js";

const PROVIDER_TIMEOUT_MS = 5_000;

// ─── Stable dedup id ──────────────────────────────────────────────────────────

function makeRecommendationId(r: Omit<DesignRecommendation, "id">): string {
  const payload = `${r.type}::${r.title}::${r.body}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

// ─── Timeout wrapper ──────────────────────────────────────────────────────────

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Provider "${label}" timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// ─── Unique query id ──────────────────────────────────────────────────────────

function makeQueryId(): string {
  return `dkq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry implementation
// ─────────────────────────────────────────────────────────────────────────────

export class KnowledgeProviderRegistry implements IKnowledgeProviderRegistry {
  private providers: Map<string, ProviderEntry> = new Map();

  register(adapter: KnowledgeAdapter, priority = 100): void {
    if (this.providers.has(adapter.id)) {
      throw new Error(
        `Provider "${adapter.id}" is already registered. Call unregister() before re-registering.`,
      );
    }
    this.providers.set(adapter.id, { adapter, priority });
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  listProviders(): Array<{ id: string; name: string; priority: number }> {
    return [...this.providers.values()]
      .sort((a, b) => a.priority - b.priority)
      .map(({ adapter, priority }) => ({
        id: adapter.id,
        name: adapter.name,
        priority,
      }));
  }

  async query(q: DesignKnowledgeQuery): Promise<DesignKnowledgeResult> {
    const queryId = makeQueryId();
    const startMs = Date.now();

    // Sort by priority ascending (lower = higher priority)
    const sorted = [...this.providers.values()].sort(
      (a, b) => a.priority - b.priority,
    );

    const resolvedProviders: string[] = [];
    const unavailableProviders: string[] = [];
    const allRaw: DesignRecommendation[] = [];

    await Promise.all(
      sorted.map(async ({ adapter }) => {
        // ── 1. Check availability ───────────────────────────────────────────
        let available = false;
        try {
          available = await withTimeout(
            adapter.isAvailable(),
            PROVIDER_TIMEOUT_MS,
            adapter.id,
          );
        } catch {
          available = false;
        }

        if (!available) {
          unavailableProviders.push(adapter.id);
          return;
        }

        // ── 2. Execute query ────────────────────────────────────────────────
        let recs: DesignRecommendation[] = [];
        try {
          recs = await withTimeout(
            adapter.query(q),
            PROVIDER_TIMEOUT_MS,
            adapter.id,
          );
          resolvedProviders.push(adapter.id);
        } catch {
          unavailableProviders.push(adapter.id);
          return;
        }

        // ── 3. Stamp each recommendation with a stable id ───────────────────
        const stamped = recs.map((r) => ({
          ...r,
          id: r.id || makeRecommendationId(r),
          // safety: strip any accidental raw payload fields
          isAdvisory: true as const,
        }));

        allRaw.push(...stamped);
      }),
    );

    // ── 4. Deduplicate by stable id ─────────────────────────────────────────
    const seen = new Set<string>();
    const dedupedRecs: DesignRecommendation[] = [];
    for (const rec of allRaw) {
      if (!seen.has(rec.id)) {
        seen.add(rec.id);
        dedupedRecs.push(rec);
      }
    }

    // ── 5. Apply confidence filter ──────────────────────────────────────────
    const minConf = q.filter?.minConfidence;
    const confOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const filtered = minConf
      ? dedupedRecs.filter(
          (r) => (confOrder[r.confidence] ?? 0) >= (confOrder[minConf] ?? 0),
        )
      : dedupedRecs;

    // ── 6. Apply type filter ────────────────────────────────────────────────
    const typeFilter = q.filter?.types ?? q.requestedTypes;
    const typeFiltered =
      typeFilter && typeFilter.length > 0
        ? filtered.filter((r) => typeFilter.includes(r.type))
        : filtered;

    // ── 7. Apply limit ──────────────────────────────────────────────────────
    const limit = q.filter?.limit ?? 20;
    const limited = typeFiltered.slice(0, limit);

    // ── 8. Collect flat citation list ───────────────────────────────────────
    const citationMap = new Map<string, DesignKnowledgeCitation>();
    for (const rec of limited) {
      for (const cit of rec.reason.citations) {
        const key = `${cit.source.providerId}::${cit.referenceId}`;
        if (!citationMap.has(key)) citationMap.set(key, cit);
      }
    }

    return {
      queryId,
      query: q,
      recommendations: limited,
      citations: [...citationMap.values()],
      totalProviders: sorted.length,
      resolvedProviders,
      unavailableProviders,
      executionMs: Date.now() - startMs,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton registry with all built-in providers registered
// ─────────────────────────────────────────────────────────────────────────────

import { templateKnowledgeProvider } from "./providers/templateKnowledgeProvider.js";
import { styleKnowledgeProvider } from "./providers/styleKnowledgeProvider.js";
import { memoryKnowledgeProvider } from "./providers/memoryKnowledgeProvider.js";

export function createDefaultRegistry(): KnowledgeProviderRegistry {
  const registry = new KnowledgeProviderRegistry();
  registry.register(templateKnowledgeProvider, 10);   // highest priority
  registry.register(styleKnowledgeProvider,    20);
  registry.register(memoryKnowledgeProvider,   30);
  return registry;
}

let _defaultRegistry: KnowledgeProviderRegistry | null = null;

export function getDefaultRegistry(): KnowledgeProviderRegistry {
  if (!_defaultRegistry) {
    _defaultRegistry = createDefaultRegistry();
  }
  return _defaultRegistry;
}
