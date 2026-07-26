interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  catalogVersion: string;
}

export class MaterialCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(ttlMs = 30_000) {
    this.ttlMs = ttlMs;
  }

  get(key: string, catalogVersion: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= now || entry.catalogVersion !== catalogVersion) {
      if (entry) this.entries.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value;
  }

  set(key: string, value: T, catalogVersion: string, now = Date.now()): void {
    this.entries.set(key, { value, catalogVersion, expiresAt: now + this.ttlMs });
  }

  invalidate(catalogVersion?: string): void {
    if (!catalogVersion) {
      this.entries.clear();
      return;
    }
    for (const [key, entry] of this.entries) {
      if (entry.catalogVersion !== catalogVersion) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get hitRatio(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  get size(): number {
    return this.entries.size;
  }
}