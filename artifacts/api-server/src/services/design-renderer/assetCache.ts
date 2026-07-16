/**
 * Design Renderer — In-Memory Asset Cache
 *
 * Scoped to one render batch/session. Prevents the same image URL or storage path
 * from being fetched multiple times during a batch.
 *
 * Security rules:
 *  - Only cache fully validated image buffers.
 *  - Cache key must be a normalized canonical reference, never a raw user string
 *    used directly as a file path.
 *  - Evict when total bytes exceed cacheMaxBytes.
 *  - Every entry has a TTL.
 */

import { renderConfig } from "./config.js";

export type CachedAsset = {
  buffer: Buffer;
  mimeType: string;
  cachedAt: number;
};

export class AssetCache {
  private readonly _cache = new Map<string, CachedAsset>();
  private _totalBytes = 0;

  private readonly maxBytes: number;
  private readonly ttlMs: number;

  constructor(opts?: { maxBytes?: number; ttlMs?: number }) {
    this.maxBytes = opts?.maxBytes ?? renderConfig.cacheMaxBytes;
    this.ttlMs    = opts?.ttlMs    ?? renderConfig.cacheTtlMs;
  }

  /** Normalize a key to prevent path-traversal-style collisions. */
  static normalizeKey(ref: string): string {
    // Lowercase + strip leading slashes + collapse whitespace
    return ref.trim().toLowerCase().replace(/\s+/g, " ");
  }

  get(rawRef: string): CachedAsset | undefined {
    const key = AssetCache.normalizeKey(rawRef);
    const entry = this._cache.get(key);
    if (!entry) return undefined;

    const now = Date.now();
    if (now - entry.cachedAt > this.ttlMs) {
      // Expired
      this._totalBytes -= entry.buffer.length;
      this._cache.delete(key);
      return undefined;
    }

    return entry;
  }

  set(rawRef: string, buffer: Buffer, mimeType: string): void {
    const key = AssetCache.normalizeKey(rawRef);

    // If already cached, remove old size
    const existing = this._cache.get(key);
    if (existing) {
      this._totalBytes -= existing.buffer.length;
    }

    // Evict oldest entries if over capacity
    while (this._totalBytes + buffer.length > this.maxBytes && this._cache.size > 0) {
      const oldestKey = this._cache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldEntry = this._cache.get(oldestKey)!;
      this._totalBytes -= oldEntry.buffer.length;
      this._cache.delete(oldestKey);
    }

    // If the single asset is larger than our entire cache limit, skip caching
    if (buffer.length > this.maxBytes) return;

    this._cache.set(key, { buffer, mimeType, cachedAt: Date.now() });
    this._totalBytes += buffer.length;
  }

  clear(): void {
    this._cache.clear();
    this._totalBytes = 0;
  }

  get size(): number {
    return this._cache.size;
  }

  get totalBytes(): number {
    return this._totalBytes;
  }
}
