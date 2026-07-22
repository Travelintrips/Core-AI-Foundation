/**
 * material-library/materialLibraryService.ts — Team 21
 *
 * Core service for the Universal Material Library.
 *
 * Storage: in-process Map (foundation implementation).
 * The service is designed so it can be backed by a DB repository without
 * changing any call-site signatures — swap _store with a DB adapter.
 *
 * Security rules enforced here:
 *   - tenantId is taken from RequestContext, never from caller input.
 *   - Platform materials (tenantId = null) are readable by all; writable only
 *     by platform admins.
 *   - Tenant materials are isolated: tenants cannot see each other's materials.
 *   - Preview URLs are validated safe (https-only) before storage.
 *   - readOnly materials cannot be updated or deleted.
 *   - Deprecated / unavailable materials are excluded from default search unless
 *     includeInactive is true.
 */

import { randomUUID } from "crypto";
import type { RequestContext } from "../../security/requestContext.js";
import {
  assertTenantOwned,
} from "../../security/requestContext.js";
import {
  type MaterialDefinition,
  type MaterialSearchFilter,
  type MaterialSort,
  type MaterialListResult,
  type MaterialStatus,
  assertSafePreviewUrl,
} from "./types.js";
import { materialCategoryRegistry } from "./categoryRegistry.js";
import { validateAllProperties } from "./propertySchema.js";

// ── Errors ────────────────────────────────────────────────────────────────────

export class MaterialNotFoundError extends Error {
  constructor(materialId: string) {
    super(`Material "${materialId}" not found`);
    this.name = "MaterialNotFoundError";
  }
}

export class MaterialAccessDeniedError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "MaterialAccessDeniedError";
  }
}

export class MaterialReadOnlyError extends Error {
  constructor(materialId: string) {
    super(`Material "${materialId}" is read-only and cannot be modified`);
    this.name = "MaterialReadOnlyError";
  }
}

export class MaterialValidationError extends Error {
  constructor(public readonly errors: readonly string[]) {
    super(`Material validation failed: ${errors.join("; ")}`);
    this.name = "MaterialValidationError";
  }
}

// ── Input types ───────────────────────────────────────────────────────────────

export type CreateMaterialInput = Omit<
  MaterialDefinition,
  "materialId" | "tenantId" | "createdAt" | "updatedAt" | "version" | "readOnly"
> & {
  readOnly?: boolean;
};

export type UpdateMaterialInput = Partial<
  Omit<MaterialDefinition, "materialId" | "tenantId" | "createdAt" | "updatedAt" | "version" | "readOnly">
>;

// ── In-process store (foundation) ─────────────────────────────────────────────

const _store = new Map<string, MaterialDefinition>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

/**
 * Determine the tenantId for a new material.
 * Platform admins may create platform-level materials (tenantId = null).
 * Regular actors always get their own tenantId.
 */
function resolveTenantId(ctx: RequestContext, isPlatformLevel: boolean): string | null {
  if (isPlatformLevel) {
    if (!ctx.isPlatformAdmin && !ctx.isPlatformWide) {
      throw new MaterialAccessDeniedError("Only platform admins can create platform-level materials");
    }
    return null;
  }
  const scoped = assertTenantOwned(ctx);
  return scoped.tenantId;
}

/**
 * Check if the calling context can access the given material.
 * Platform materials are visible to everyone.
 * Tenant materials are only visible to actors with matching tenantId.
 */
function assertCanRead(material: MaterialDefinition, ctx: RequestContext): void {
  if (material.tenantId === null) return; // platform material
  if (ctx.isPlatformAdmin || ctx.isPlatformWide) return;
  const tenantId = ctx.tenantId;
  if (tenantId !== material.tenantId) {
    throw new MaterialAccessDeniedError(
      `Access denied: material "${material.materialId}" belongs to a different tenant`,
    );
  }
}

function assertCanWrite(material: MaterialDefinition, ctx: RequestContext): void {
  if (material.readOnly) throw new MaterialReadOnlyError(material.materialId);
  if (material.tenantId === null) {
    // Platform material: only platform admins may write
    if (!ctx.isPlatformAdmin && !ctx.isPlatformWide) {
      throw new MaterialAccessDeniedError("Only platform admins can modify platform-level materials");
    }
    return;
  }
  assertCanRead(material, ctx);
}

function validatePreview(material: Pick<CreateMaterialInput, "preview">): void {
  assertSafePreviewUrl(material.preview.previewUrl);
  assertSafePreviewUrl(material.preview.thumbnailUrl);
  for (const swatch of material.preview.additionalSwatches) {
    if (swatch.startsWith("https://")) continue; // signed URL — OK
    if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(swatch)) continue; // hex — OK
    assertSafePreviewUrl(swatch); // will throw
  }
}

function validateMaterialInput(input: CreateMaterialInput | UpdateMaterialInput): void {
  // Preview safety
  if ("preview" in input && input.preview) {
    validatePreview({ preview: input.preview });
  }

  // Category must exist
  if ("categoryId" in input && input.categoryId) {
    const cat = materialCategoryRegistry.get(input.categoryId);
    if (!cat) {
      throw new MaterialValidationError([`Category "${input.categoryId}" is not registered`]);
    }
    // Validate properties against category definitions
    if ("properties" in input && input.properties) {
      const defs = materialCategoryRegistry.resolvePropertyDefinitions(input.categoryId);
      const result = validateAllProperties(defs, input.properties);
      if (!result.valid) throw new MaterialValidationError(result.errors);
    }
  }
}

// ── Service API ───────────────────────────────────────────────────────────────

/** Create a new material. Tenant is derived from ctx. */
export function createMaterial(
  input: CreateMaterialInput,
  ctx: RequestContext,
  opts: { platformLevel?: boolean } = {},
): MaterialDefinition {
  validateMaterialInput(input);

  const tenantId = resolveTenantId(ctx, opts.platformLevel ?? false);
  const materialId = randomUUID();
  const ts = now();

  const material: MaterialDefinition = {
    ...input,
    materialId,
    tenantId,
    createdAt: ts,
    updatedAt: ts,
    version: 1,
    readOnly: input.readOnly ?? false,
    createdBy: ctx.actorId ?? undefined,
    extensions: input.extensions ?? {},
  };

  _store.set(materialId, material);
  return material;
}

/** Get a material by ID. Throws if not found or access denied. */
export function getMaterial(materialId: string, ctx: RequestContext): MaterialDefinition {
  const material = _store.get(materialId);
  if (!material) throw new MaterialNotFoundError(materialId);
  assertCanRead(material, ctx);
  return material;
}

/** Update a material. Returns the updated version. */
export function updateMaterial(
  materialId: string,
  updates: UpdateMaterialInput,
  ctx: RequestContext,
): MaterialDefinition {
  const existing = _store.get(materialId);
  if (!existing) throw new MaterialNotFoundError(materialId);
  assertCanWrite(existing, ctx);
  validateMaterialInput(updates);

  const updated: MaterialDefinition = {
    ...existing,
    ...updates,
    materialId: existing.materialId,
    tenantId: existing.tenantId,
    createdAt: existing.createdAt,
    updatedAt: now(),
    version: existing.version + 1,
    readOnly: existing.readOnly,
  };

  _store.set(materialId, updated);
  return updated;
}

/** Soft-delete by setting status to "inactive". Use hardDelete only for tenant cleanup. */
export function deactivateMaterial(materialId: string, ctx: RequestContext): MaterialDefinition {
  return updateMaterial(materialId, { status: "inactive" as MaterialStatus }, ctx);
}

/** Hard delete. Only for tenant cleanup / testing. */
export function deleteMaterial(materialId: string, ctx: RequestContext): void {
  const existing = _store.get(materialId);
  if (!existing) throw new MaterialNotFoundError(materialId);
  assertCanWrite(existing, ctx);
  _store.delete(materialId);
}

/** List and search materials with filtering, sorting, and pagination. */
export function listMaterials(
  filter: MaterialSearchFilter,
  sort: MaterialSort = "name_asc",
  page = 1,
  pageSize = 20,
  ctx: RequestContext,
): MaterialListResult {
  let items = Array.from(_store.values());

  // ── Tenant isolation ──────────────────────────────────────────────────────
  const callerTenantId = ctx.isPlatformAdmin || ctx.isPlatformWide ? null : ctx.tenantId;

  items = items.filter((m) => {
    // Platform materials: visible to all
    if (m.tenantId === null) return true;
    // Tenant materials: only visible to same tenant (or platform admin)
    if (ctx.isPlatformAdmin || ctx.isPlatformWide) return true;
    return m.tenantId === callerTenantId;
  });

  // ── platformOnly filter ───────────────────────────────────────────────────
  if (filter.platformOnly) {
    items = items.filter((m) => m.tenantId === null);
  }

  // ── tenantId filter ───────────────────────────────────────────────────────
  if (filter.tenantId !== undefined) {
    items = items.filter((m) => m.tenantId === filter.tenantId);
  }

  // ── Status filter ─────────────────────────────────────────────────────────
  if (!filter.includeInactive) {
    items = items.filter((m) => m.status === "active");
  } else if (filter.status) {
    items = items.filter((m) => m.status === filter.status);
  }

  // ── Category filter ───────────────────────────────────────────────────────
  if (filter.categoryIds?.length) {
    const cats = new Set(filter.categoryIds);
    items = items.filter((m) => cats.has(m.categoryId));
  }

  // ── Tag filter ────────────────────────────────────────────────────────────
  if (filter.tags?.length) {
    const tagSet = new Set(filter.tags.map((t) => t.toLowerCase()));
    items = items.filter((m) => m.tags.some((t) => tagSet.has(t.toLowerCase())));
  }

  // ── Source filter ─────────────────────────────────────────────────────────
  if (filter.source) {
    items = items.filter((m) => m.source === filter.source);
  }

  // ── Domain compatibility filter ───────────────────────────────────────────
  if (filter.domain) {
    const domain = filter.domain;
    items = items.filter(
      (m) =>
        m.compatibility.compatibleDomains.length === 0 ||
        m.compatibility.compatibleDomains.includes(domain),
    );
  }

  // ── Full-text search ──────────────────────────────────────────────────────
  if (filter.q) {
    const q = filter.q.toLowerCase();
    items = items.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  // ── Sort ──────────────────────────────────────────────────────────────────
  items = [...items].sort((a, b) => {
    switch (sort) {
      case "name_asc":    return a.name.localeCompare(b.name);
      case "name_desc":   return b.name.localeCompare(a.name);
      case "created_desc": return b.createdAt.localeCompare(a.createdAt);
      case "created_asc":  return a.createdAt.localeCompare(b.createdAt);
      case "updated_desc": return b.updatedAt.localeCompare(a.updatedAt);
      case "category_asc": return a.categoryId.localeCompare(b.categoryId) || a.name.localeCompare(b.name);
      default:            return a.name.localeCompare(b.name);
    }
  });

  // ── Pagination ────────────────────────────────────────────────────────────
  const total = items.length;
  const safePageSize = Math.min(Math.max(1, pageSize), 100);
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * safePageSize;
  const pageItems = items.slice(start, start + safePageSize);

  return {
    items: pageItems,
    total,
    page: safePage,
    pageSize: safePageSize,
    hasMore: start + safePageSize < total,
  };
}

/** Bulk upsert for seeding platform materials. Platform admin only. */
export function seedPlatformMaterials(materials: CreateMaterialInput[], ctx: RequestContext): number {
  if (!ctx.isPlatformAdmin && !ctx.isPlatformWide) {
    throw new MaterialAccessDeniedError("Only platform admins can seed platform materials");
  }
  let count = 0;
  for (const input of materials) {
    try {
      createMaterial(input, ctx, { platformLevel: true });
      count++;
    } catch {
      // Skip duplicates (readOnly seed scenario)
    }
  }
  return count;
}

/** Reset store — for tests only. Never call in production. */
export function _resetStoreForTests(): void {
  _store.clear();
}

/** Count total materials in store (for tests/admin). */
export function _getStoreSize(): number {
  return _store.size;
}
