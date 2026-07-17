/**
 * Universal Design Blueprint Library — Service Layer (Team 7)
 *
 * Provides CRUD over the in-memory blueprint registry (built-ins) and an
 * in-process custom blueprint store (no DB required — Team 7 owns no shared
 * tables until the migration draft is applied by Team 24).
 *
 * Public surface:
 *   listBlueprints(filter)
 *   getBlueprintById(id)
 *   getBlueprintBySlug(slug)
 *   getBlueprintsByDomain(domain)
 *   createCustomBlueprint(input)
 *   updateCustomBlueprint(id, input)
 *   deprecateCustomBlueprint(id)
 *   validateBlueprintPayload(payload)
 *   checkBlueprintCompatibility(request)
 *   normalizeBlueprintPayload(payload)
 */

import { randomUUID } from "crypto";
import type {
  Blueprint,
  BlueprintDomain,
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
import { BLUEPRINT_SCHEMA_VERSION } from "./types.js";

// ── In-process custom blueprint store ────────────────────────────────────────
// Replaces DB until Team 24 mounts the migration draft.
// P1-B: Maintain a secondary slug index so getBlueprintBySlug is O(1) on custom blueprints,
// not O(N).

const customBlueprintStore = new Map<string, Blueprint>();
const customSlugIndex      = new Map<string, string>();  // slug → id

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

function matchesTags(bp: Blueprint, industryTag?: string, styleTag?: string): boolean {
  if (industryTag && !bp.industryTags.includes(industryTag)) return false;
  if (styleTag && !bp.styleTags.includes(styleTag)) return false;
  return true;
}

// ── List ──────────────────────────────────────────────────────────────────────

export function listBlueprints(filter: ListBlueprintsFilter = {}): Blueprint[] {
  const all: Blueprint[] = [
    ...BUILTIN_BLUEPRINTS,
    ...customBlueprintStore.values(),
  ];

  let result = all.filter((bp) => {
    if (filter.domain && bp.domain !== filter.domain) return false;
    if (filter.status && bp.status !== filter.status) return false;
    if (!matchesTags(bp, filter.industryTag, filter.styleTag)) return false;
    return true;
  });

  const offset = filter.offset ?? 0;
  const limit  = filter.limit  ?? 100;
  result = result.slice(offset, offset + limit);
  return result;
}

// ── Get by ID ─────────────────────────────────────────────────────────────────

export function getBlueprintById(id: string): Blueprint | null {
  return BUILTIN_BLUEPRINT_MAP.get(id) ?? customBlueprintStore.get(id) ?? null;
}

// ── Get by slug ───────────────────────────────────────────────────────────────

export function getBlueprintBySlug(slug: string): Blueprint | null {
  // P1-B fix: use the slug index for O(1) lookup instead of O(N) scan
  const customId = customSlugIndex.get(slug);
  const custom   = customId ? customBlueprintStore.get(customId) : undefined;
  return BUILTIN_BLUEPRINT_BY_SLUG.get(slug) ?? custom ?? null;
}

// ── Get by domain ─────────────────────────────────────────────────────────────

export function getBlueprintsByDomain(domain: BlueprintDomain): Blueprint[] {
  const builtins = BUILTIN_BLUEPRINT_BY_DOMAIN.get(domain) ?? [];
  const customs  = [...customBlueprintStore.values()].filter((bp) => bp.domain === domain);
  return [...builtins, ...customs];
}

// ── Create custom blueprint ───────────────────────────────────────────────────

export interface CreateBlueprintResult {
  blueprint: Blueprint | null;
  validation: ValidationResult;
}

export function createCustomBlueprint(input: CreateBlueprintInput): CreateBlueprintResult {
  const now = new Date().toISOString();
  const id  = `bp-custom-${randomUUID()}`;
  // Guard: name may be absent/non-string on a malformed payload; let the validator surface the error.
  const safeName = typeof input.name === "string" ? input.name : "";
  const slug = makeUniqueSlug(slugify(safeName));

  const draft: Blueprint = {
    ...input,
    id,
    slug,
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  };

  // Validate before normalizing — the normalizer expects structurally sound
  // arrays; calling it on a malformed payload crashes instead of returning
  // a clean validation error.
  const prelimValidation = validateBlueprint(draft);
  if (!prelimValidation.valid) {
    return { blueprint: null, validation: prelimValidation };
  }

  // Now safe to normalize (payload has passed structural checks).
  const { blueprint: normalized } = normalizeBlueprint(draft, now);
  const validation = validateBlueprint(normalized);

  customBlueprintStore.set(id, normalized);
  customSlugIndex.set(normalized.slug, id);  // P1-B: keep slug index in sync
  return { blueprint: normalized, validation };
}

// ── Update custom blueprint ───────────────────────────────────────────────────

export interface UpdateBlueprintResult {
  blueprint: Blueprint | null;
  validation: ValidationResult;
  notFound?: boolean;
}

export function updateCustomBlueprint(id: string, input: UpdateBlueprintInput): UpdateBlueprintResult {
  // Built-ins are immutable
  if (BUILTIN_BLUEPRINT_MAP.has(id)) {
    return {
      blueprint: null,
      validation: { valid: false, issues: [{ severity: "error", code: "BUILTIN_IMMUTABLE", path: "id", message: "Built-in blueprints cannot be updated" }] },
    };
  }
  const existing = customBlueprintStore.get(id);
  if (!existing) {
    return { blueprint: null, validation: { valid: false, issues: [] }, notFound: true };
  }

  const now = new Date().toISOString();
  const merged: Blueprint = { ...existing, ...input, id, updatedAt: now };

  const { blueprint: normalized } = normalizeBlueprint(merged, now);
  const validation = validateBlueprint(normalized);

  if (!validation.valid) {
    return { blueprint: null, validation };
  }

  // P1-B: if slug changed during update, re-index (old slug → new slug)
  if (existing.slug !== normalized.slug) {
    customSlugIndex.delete(existing.slug);
  }
  customBlueprintStore.set(id, normalized);
  customSlugIndex.set(normalized.slug, id);
  return { blueprint: normalized, validation };
}

// ── Deprecate custom blueprint ────────────────────────────────────────────────

export function deprecateCustomBlueprint(id: string): { success: boolean; notFound?: boolean; builtin?: boolean } {
  if (BUILTIN_BLUEPRINT_MAP.has(id)) return { success: false, builtin: true };
  const bp = customBlueprintStore.get(id);
  if (!bp) return { success: false, notFound: true };
  customBlueprintStore.set(id, { ...bp, status: "deprecated", updatedAt: new Date().toISOString() });
  return { success: true };
}

// ── Validate ──────────────────────────────────────────────────────────────────

export function validateBlueprintPayload(payload: unknown): ValidationResult {
  return validateBlueprint(payload);
}

// ── Compatibility check ───────────────────────────────────────────────────────

export function checkBlueprintCompatibility(
  request: CompatibilityRequest
): CompatibilityResult & { blueprintNotFound?: boolean } {
  const blueprint = getBlueprintById(request.blueprintId);
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

export function normalizeBlueprintPayload(payload: unknown): NormalizationResult & { valid: boolean; validationIssues: ValidationResult["issues"] } {
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
  return {
    blueprint,
    changes,
    valid: validation.valid,
    validationIssues: validation.issues,
  };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function getBlueprintStats() {
  // P1-A fix: do NOT use listBlueprints() for counts — it applies a default
  // limit of 100 and would undercount once custom blueprints grow beyond that.
  // Count directly from the source stores instead.
  const allCustom   = [...customBlueprintStore.values()];
  const allBuiltins = BUILTIN_BLUEPRINTS;
  const all         = [...allBuiltins, ...allCustom];

  // byDomain: builtins from the index + custom grouped by domain
  const byDomain: Record<string, number> = {};
  for (const [d, bps] of BUILTIN_BLUEPRINT_BY_DOMAIN.entries()) {
    byDomain[d] = bps.length;
  }
  for (const bp of allCustom) {
    byDomain[bp.domain] = (byDomain[bp.domain] ?? 0) + 1;
  }

  return {
    total:   all.length,
    builtin: allBuiltins.length,
    custom:  customBlueprintStore.size,
    byDomain,
    byStatus: {
      active:     all.filter((b) => b.status === "active").length,
      draft:      all.filter((b) => b.status === "draft").length,
      deprecated: all.filter((b) => b.status === "deprecated").length,
    },
  };
}
