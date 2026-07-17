/**
 * InMemoryBlueprintRepository — TEST STUB ONLY.
 *
 * DO NOT use this in production. Production must use DbBlueprintRepository
 * so data persists across server restarts.
 *
 * This stub satisfies IBlueprintRepository entirely in memory, making unit
 * and integration tests fast and DB-free.
 */

import type { Blueprint, BlueprintStatus } from "../types.js";
import type { IBlueprintRepository, CustomBlueprintFilter } from "./IBlueprintRepository.js";

export class InMemoryBlueprintRepository implements IBlueprintRepository {
  /** Map of id → Blueprint. Exposed for test inspection. */
  readonly store = new Map<string, Blueprint>();
  private slugIndex = new Map<string, string>(); // slug → id

  async findById(id: string): Promise<Blueprint | null> {
    return this.store.get(id) ?? null;
  }

  async findBySlug(slug: string): Promise<Blueprint | null> {
    const id = this.slugIndex.get(slug);
    return id ? (this.store.get(id) ?? null) : null;
  }

  async findAll(filter: CustomBlueprintFilter): Promise<{ rows: Blueprint[]; total: number }> {
    let all = [...this.store.values()];

    if (filter.domain)      all = all.filter((b) => b.domain === filter.domain);
    if (filter.status)      all = all.filter((b) => b.status === filter.status);
    if (filter.industryTag) all = all.filter((b) => b.industryTags.includes(filter.industryTag!));
    if (filter.styleTag)    all = all.filter((b) => b.styleTags.includes(filter.styleTag!));

    const total = all.length;
    const offset = filter.offset ?? 0;
    const limit  = filter.limit  ?? 100;
    return { rows: all.slice(offset, offset + limit), total };
  }

  async create(blueprint: Blueprint): Promise<Blueprint> {
    this.store.set(blueprint.id, blueprint);
    this.slugIndex.set(blueprint.slug, blueprint.id);
    return blueprint;
  }

  async update(id: string, updates: Partial<Blueprint>): Promise<Blueprint | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    const updated: Blueprint = {
      ...existing,
      ...updates,
      id,
      slug: existing.slug,    // slug is immutable after creation
      updatedAt: new Date().toISOString(),
    };
    this.store.set(id, updated);
    return updated;
  }

  async setStatus(id: string, status: BlueprintStatus): Promise<Blueprint | null> {
    return this.update(id, { status });
  }

  /** Test helper: clear all custom blueprints. */
  clear(): void {
    this.store.clear();
    this.slugIndex.clear();
  }
}
