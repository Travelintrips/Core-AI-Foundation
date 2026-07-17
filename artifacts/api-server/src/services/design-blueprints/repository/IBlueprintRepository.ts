/**
 * IBlueprintRepository — Port (interface) for custom blueprint persistence.
 *
 * Built-in blueprints always live in code (services/design-blueprints/blueprints/).
 * This repository manages ONLY custom (user-created) blueprints.
 *
 * Implementations:
 *   DbBlueprintRepository  — production; reads/writes ai_platform.ai_design_blueprints
 *   InMemoryBlueprintRepository — test stub ONLY; never used in production
 */

import type { Blueprint, BlueprintDomain, BlueprintStatus } from "../types.js";

export interface CustomBlueprintFilter {
  domain?: BlueprintDomain;
  status?: BlueprintStatus;
  industryTag?: string;
  styleTag?: string;
  limit?: number;
  offset?: number;
}

export interface IBlueprintRepository {
  /** Find one custom blueprint by its public_id (the string UUID, not the DB serial). */
  findById(id: string): Promise<Blueprint | null>;

  /** Find one custom blueprint by slug. */
  findBySlug(slug: string): Promise<Blueprint | null>;

  /**
   * List custom blueprints with optional filtering and pagination.
   * Returns both the page rows and the total (unfiltered by pagination) count.
   */
  findAll(filter: CustomBlueprintFilter): Promise<{ rows: Blueprint[]; total: number }>;

  /** Persist a new custom blueprint. */
  create(blueprint: Blueprint): Promise<Blueprint>;

  /**
   * Apply a partial update to a custom blueprint.
   * Returns the updated record, or null if not found.
   */
  update(id: string, updates: Partial<Blueprint>): Promise<Blueprint | null>;

  /**
   * Change only the status field of a custom blueprint.
   * Used for publish, archive, and deprecate actions.
   * Returns the updated record, or null if not found.
   */
  setStatus(id: string, status: BlueprintStatus): Promise<Blueprint | null>;
}
