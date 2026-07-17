/**
 * Universal Design Blueprint Library — Service Layer (Team 7)
 *
 * Architecture
 * ────────────
 * Built-in blueprints:  live entirely in code (blueprints/index.ts).
 *                       Always available; never persisted to DB.
 * Custom blueprints:    persisted via IBlueprintRepository.
 *                       Production uses DbBlueprintRepository.
 *                       Tests inject InMemoryBlueprintRepository.
 *
 * Storage rule
 * ────────────
 * The production service MUST NOT default to in-memory storage.
 * `createBlueprintService()` accepts any IBlueprintRepository;
 * the module-level singleton is wired to DbBlueprintRepository.
 *
 * Visibility rules
 * ────────────────
 *   published → visible on public (unauthenticated) listing endpoint
 *   active    → visible to admins only
 *   draft     → visible to admins only
 *   deprecated→ visible to admins only
 *
 * Public surface (exported)
 * ─────────────────────────
 *   createBlueprintService(repo)  — factory (for tests)
 *   listBlueprints, getBlueprintById, getBlueprintBySlug, getBlueprintsByDomain,
 *   listPublicBlueprints,
 *   createCustomBlueprint, updateCustomBlueprint,
 *   publishBlueprint, archiveBlueprint, deprecateCustomBlueprint,
 *   validateBlueprintPayload, checkBlueprintCompatibility, normalizeBlueprintPayload,
 *   getBlueprintStats
 */

import { randomUUID } from "crypto";
import type {
  Blueprint,
  BlueprintDomain,
  BlueprintStatus,
  CreateBlueprintInput,
  UpdateBlueprintInput,
  ListBlueprintsFilter,
  ValidationResult,
  CompatibilityRequest,
  CompatibilityResult,
  NormalizationResult,
} from "./types.js";
import {
  BUILTIN_BLUEPRINTS,
  BUILTIN_BLUEPRINT_MAP,
  BUILTIN_BLUEPRINT_BY_SLUG,
  BUILTIN_BLUEPRINT_BY_DOMAIN,
} from "./blueprints/index.js";
import { validateBlueprint } from "./blueprintValidator.js";
import { checkCompatibility } from "./compatibilityChecker.js";
import { normalizeBlueprint } from "./blueprintNormalizer.js";
import { BLUEPRINT_SCHEMA_VERSION, PUBLIC_BLUEPRINT_STATUSES } from "./types.js";
import type { IBlueprintRepository, CustomBlueprintFilter } from "./repository/IBlueprintRepository.js";
import { DbBlueprintRepository } from "./repository/DbBlueprintRepository.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function makeUniqueSlug(base: string): string {
  return `custom-${base}-${randomUUID().slice(0, 8)}`;
}

// ── Service factory ───────────────────────────────────────────────────────────

export interface CreateBlueprintResult {
  blueprint: Blueprint | null;
  validation: ValidationResult;
}

export interface UpdateBlueprintResult {
  blueprint: Blueprint | null;
  validation: ValidationResult;
  notFound?: boolean;
}

export class BlueprintService {
  constructor(private readonly repo: IBlueprintRepository) {}

  // ── List (admin: all statuses) ──────────────────────────────────────────────

  async listBlueprints(filter: ListBlueprintsFilter = {}): Promise<Blueprint[]> {
    const { rows: customs } = await this.repo.findAll(filter as CustomBlueprintFilter);

    const builtins = BUILTIN_BLUEPRINTS.filter((bp) => {
      if (filter.domain && bp.domain !== filter.domain) return false;
      if (filter.status && bp.status !== filter.status) return false;
      if (filter.industryTag && !bp.industryTags.includes(filter.industryTag)) return false;
      if (filter.styleTag && !bp.styleTags.includes(filter.styleTag)) return false;
      return true;
    });

    const all = [...builtins, ...customs];
    const offset = filter.offset ?? 0;
    const limit  = filter.limit  ?? 100;
    return all.slice(offset, offset + limit);
  }

  // ── Public list (unauthenticated: published only) ───────────────────────────

  async listPublicBlueprints(filter: Omit<ListBlueprintsFilter, "status"> = {}): Promise<Blueprint[]> {
    // Public endpoint MUST filter to published status only — never expose draft/active.
    return this.listBlueprints({ ...filter, status: "published" });
  }

  // ── Get by ID ───────────────────────────────────────────────────────────────

  async getBlueprintById(id: string): Promise<Blueprint | null> {
    return BUILTIN_BLUEPRINT_MAP.get(id) ?? (await this.repo.findById(id));
  }

  // ── Get by slug ─────────────────────────────────────────────────────────────

  async getBlueprintBySlug(slug: string): Promise<Blueprint | null> {
    return BUILTIN_BLUEPRINT_BY_SLUG.get(slug) ?? (await this.repo.findBySlug(slug));
  }

  // ── Get by domain ────────────────────────────────────────────────────────────

  async getBlueprintsByDomain(domain: BlueprintDomain): Promise<Blueprint[]> {
    const builtins = BUILTIN_BLUEPRINT_BY_DOMAIN.get(domain) ?? [];
    const { rows: customs } = await this.repo.findAll({ domain });
    return [...builtins, ...customs];
  }

  // ── Create custom blueprint ─────────────────────────────────────────────────

  async createCustomBlueprint(input: CreateBlueprintInput): Promise<CreateBlueprintResult> {
    const now      = new Date().toISOString();
    const id       = `bp-custom-${randomUUID()}`;
    const safeName = typeof input.name === "string" ? input.name : "";
    const slug     = input.slug ?? makeUniqueSlug(slugify(safeName));

    const draft: Blueprint = {
      ...input,
      id,
      slug,
      schemaVersion: BLUEPRINT_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    };

    // Validate before normalizing — normalizer assumes structurally sound input.
    const prelimValidation = validateBlueprint(draft);
    if (!prelimValidation.valid) {
      return { blueprint: null, validation: prelimValidation };
    }

    const { blueprint: normalized } = normalizeBlueprint(draft, now);
    const validation = validateBlueprint(normalized);
    if (!validation.valid) {
      return { blueprint: null, validation };
    }

    const saved = await this.repo.create(normalized);
    return { blueprint: saved, validation };
  }

  // ── Update custom blueprint ─────────────────────────────────────────────────

  async updateCustomBlueprint(id: string, input: UpdateBlueprintInput): Promise<UpdateBlueprintResult> {
    if (BUILTIN_BLUEPRINT_MAP.has(id)) {
      return {
        blueprint: null,
        validation: {
          valid: false,
          issues: [{
            severity: "error",
            code:     "BUILTIN_IMMUTABLE",
            path:     "id",
            message:  "Built-in blueprints cannot be updated",
          }],
        },
      };
    }

    const existing = await this.repo.findById(id);
    if (!existing) {
      return { blueprint: null, validation: { valid: false, issues: [] }, notFound: true };
    }

    const now    = new Date().toISOString();
    const merged: Blueprint = { ...existing, ...input, id, slug: existing.slug, updatedAt: now };

    const { blueprint: normalized } = normalizeBlueprint(merged, now);
    const validation = validateBlueprint(normalized);
    if (!validation.valid) {
      return { blueprint: null, validation };
    }

    const saved = await this.repo.update(id, normalized);
    return { blueprint: saved, validation };
  }

  // ── Publish (status → published) ────────────────────────────────────────────

  async publishBlueprint(id: string): Promise<{ success: boolean; blueprint?: Blueprint; notFound?: boolean; builtin?: boolean }> {
    if (BUILTIN_BLUEPRINT_MAP.has(id)) return { success: false, builtin: true };
    const updated = await this.repo.setStatus(id, "published");
    if (!updated) return { success: false, notFound: true };
    return { success: true, blueprint: updated };
  }

  // ── Archive (status → active, reverting from published/draft) ───────────────

  async archiveBlueprint(id: string): Promise<{ success: boolean; blueprint?: Blueprint; notFound?: boolean; builtin?: boolean }> {
    if (BUILTIN_BLUEPRINT_MAP.has(id)) return { success: false, builtin: true };
    const updated = await this.repo.setStatus(id, "active");
    if (!updated) return { success: false, notFound: true };
    return { success: true, blueprint: updated };
  }

  // ── Deprecate (status → deprecated) ─────────────────────────────────────────

  async deprecateCustomBlueprint(id: string): Promise<{ success: boolean; notFound?: boolean; builtin?: boolean }> {
    if (BUILTIN_BLUEPRINT_MAP.has(id)) return { success: false, builtin: true };
    const updated = await this.repo.setStatus(id, "deprecated");
    if (!updated) return { success: false, notFound: true };
    return { success: true };
  }

  // ── Validate ─────────────────────────────────────────────────────────────────

  validateBlueprintPayload(payload: unknown): ValidationResult {
    return validateBlueprint(payload);
  }

  // ── Compatibility check ───────────────────────────────────────────────────────

  async checkBlueprintCompatibility(
    request: CompatibilityRequest
  ): Promise<CompatibilityResult & { blueprintNotFound?: boolean }> {
    const blueprint = await this.getBlueprintById(request.blueprintId);
    if (!blueprint) {
      return {
        compatible: false,
        issues: [{ code: "BLUEPRINT_NOT_FOUND", message: `Blueprint "${request.blueprintId}" not found` }],
        warnings: [],
        blueprintNotFound: true,
      };
    }
    return checkCompatibility(request, blueprint);
  }

  // ── Normalize ─────────────────────────────────────────────────────────────────

  normalizeBlueprintPayload(payload: unknown): NormalizationResult & { valid: boolean; validationIssues: ValidationResult["issues"] } {
    if (!payload || typeof payload !== "object") {
      return {
        blueprint: null as any,
        changes: [],
        valid: false,
        validationIssues: [{ severity: "error", code: "NOT_AN_OBJECT", path: "", message: "Payload must be a non-null object" }],
      };
    }
    const { blueprint, changes } = normalizeBlueprint(payload as Blueprint);
    const validation = validateBlueprint(blueprint);
    return { blueprint, changes, valid: validation.valid, validationIssues: validation.issues };
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  async getBlueprintStats(): Promise<{
    total: number; builtin: number; custom: number;
    byDomain: Record<string, number>;
    byStatus: Record<BlueprintStatus, number>;
  }> {
    // Count custom blueprints directly from repository (no pagination limit).
    const { rows: allCustom, total: customTotal } = await this.repo.findAll({ limit: 10_000 });

    const byDomain: Record<string, number> = {};
    for (const [d, bps] of BUILTIN_BLUEPRINT_BY_DOMAIN.entries()) byDomain[d] = bps.length;
    for (const bp of allCustom) byDomain[bp.domain] = (byDomain[bp.domain] ?? 0) + 1;

    const builtinCount = BUILTIN_BLUEPRINTS.length;
    const all          = [...BUILTIN_BLUEPRINTS, ...allCustom];

    return {
      total:   builtinCount + customTotal,
      builtin: builtinCount,
      custom:  customTotal,
      byDomain,
      byStatus: {
        published:  all.filter((b) => b.status === "published").length,
        active:     all.filter((b) => b.status === "active").length,
        draft:      all.filter((b) => b.status === "draft").length,
        deprecated: all.filter((b) => b.status === "deprecated").length,
      },
    };
  }
}

// ── Production singleton ──────────────────────────────────────────────────────
// DbBlueprintRepository is the only legal default in production.
// Tests must inject InMemoryBlueprintRepository via createBlueprintService().

let _productionService: BlueprintService | null = null;

/** Factory — use this in tests by passing InMemoryBlueprintRepository. */
export function createBlueprintService(repo: IBlueprintRepository): BlueprintService {
  return new BlueprintService(repo);
}

function getService(): BlueprintService {
  if (!_productionService) {
    _productionService = new BlueprintService(new DbBlueprintRepository());
  }
  return _productionService;
}

// ── Named exports (routes import these) ──────────────────────────────────────

export async function listBlueprints(filter?: ListBlueprintsFilter):  Promise<Blueprint[]>      { return getService().listBlueprints(filter); }
export async function listPublicBlueprints(filter?: Omit<ListBlueprintsFilter, "status">): Promise<Blueprint[]> { return getService().listPublicBlueprints(filter); }
export async function getBlueprintById(id: string):                   Promise<Blueprint | null>  { return getService().getBlueprintById(id); }
export async function getBlueprintBySlug(slug: string):               Promise<Blueprint | null>  { return getService().getBlueprintBySlug(slug); }
export async function getBlueprintsByDomain(domain: BlueprintDomain): Promise<Blueprint[]>       { return getService().getBlueprintsByDomain(domain); }
export async function createCustomBlueprint(input: CreateBlueprintInput): Promise<CreateBlueprintResult>          { return getService().createCustomBlueprint(input); }
export async function updateCustomBlueprint(id: string, input: UpdateBlueprintInput): Promise<UpdateBlueprintResult> { return getService().updateCustomBlueprint(id, input); }
export async function publishBlueprint(id: string)                    { return getService().publishBlueprint(id); }
export async function archiveBlueprint(id: string)                    { return getService().archiveBlueprint(id); }
export async function deprecateCustomBlueprint(id: string)            { return getService().deprecateCustomBlueprint(id); }
export function validateBlueprintPayload(payload: unknown): ValidationResult                     { return getService().validateBlueprintPayload(payload); }
export async function checkBlueprintCompatibility(request: CompatibilityRequest)                 { return getService().checkBlueprintCompatibility(request); }
export function normalizeBlueprintPayload(payload: unknown)                                       { return getService().normalizeBlueprintPayload(payload); }
export async function getBlueprintStats()                                                         { return getService().getBlueprintStats(); }

// Re-export PUBLIC_BLUEPRINT_STATUSES for route use
export { PUBLIC_BLUEPRINT_STATUSES };
