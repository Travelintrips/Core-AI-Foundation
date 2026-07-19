/**
 * serviceNormalizationService.ts — Team 04
 *
 * Business rules for service normalization and solution collections.
 * All DB access delegates to serviceNormalizationRepository.
 * Throws typed domain errors — routes must NOT catch raw DB errors.
 *
 * Rules enforced here (not in DB):
 *   - canonical code uniqueness
 *   - canonical slug uniqueness
 *   - alias normalization + dedup
 *   - mapping conflict (one service → one concept only)
 *   - conflicting primary mapping (one primary per concept)
 *   - collection slug uniqueness
 *   - collection membership dedup
 */

import * as repo from "../repositories/serviceNormalizationRepository.js";
import { db, aiServicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type {
  ServiceCanonicalConcept,
  ServiceNormalizationMapping,
  ServiceAlias,
  SolutionCollection,
  SolutionCollectionService,
} from "@workspace/db";

// ── Domain errors ─────────────────────────────────────────────────────────────

export class NormalizationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NormalizationError";
  }
}

// ── Pure utility functions ────────────────────────────────────────────────────

/** Normalize an alias string: trim + lowercase. */
export function normalizeAliasString(alias: string): string {
  return alias.trim().toLowerCase();
}

/** Validate canonical code format: lowercase letters, digits, underscores. */
export function isValidCode(code: string): boolean {
  return /^[a-z][a-z0-9_]{1,63}$/.test(code);
}

/** Validate slug format: lowercase letters, digits, hyphens. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z][a-z0-9-]{1,63}$/.test(slug);
}

/** Allowed relationship types for normalization mappings. */
export const RELATIONSHIP_TYPES = new Set([
  "primary",
  "alias_variant",
  "format_variant",
  "tier_variant",
  "legacy",
  "related",
]);

/** Allowed alias types. */
export const ALIAS_TYPES = new Set([
  "name",
  "legacy_code",
  "language_variant",
  "typo",
]);

/** Allowed status values for canonical concepts and collections. */
export const ALLOWED_STATUSES = new Set(["active", "draft", "archived"]);

/** Allowed collection visibility values. */
export const ALLOWED_VISIBILITIES = new Set(["public", "internal"]);

/** Allowed collection member roles. */
export const MEMBER_ROLES = new Set(["anchor", "complementary", "optional"]);

/** Maximum services per collection bulk operation. */
export const BULK_SERVICE_LIMIT = 50;

// ── Canonical Concept CRUD ────────────────────────────────────────────────────

export async function createCanonicalConcept(input: {
  code: string;
  slug: string;
  name: string;
  shortDescription?: string | null;
  status?: string;
  displayOrder?: number;
}): Promise<ServiceCanonicalConcept> {
  if (!isValidCode(input.code)) {
    throw new NormalizationError(
      "INVALID_CODE",
      `Code "${input.code}" must be lowercase letters/digits/underscores, 2–64 chars, start with a letter.`,
    );
  }
  if (!isValidSlug(input.slug)) {
    throw new NormalizationError(
      "INVALID_SLUG",
      `Slug "${input.slug}" must be lowercase letters/digits/hyphens, 2–64 chars, start with a letter.`,
    );
  }
  if (input.status && !ALLOWED_STATUSES.has(input.status)) {
    throw new NormalizationError("INVALID_STATUS", `Status must be one of: ${[...ALLOWED_STATUSES].join(", ")}`);
  }
  if (!input.name || input.name.trim().length < 2 || input.name.length > 200) {
    throw new NormalizationError("INVALID_NAME", "Name must be 2–200 characters.");
  }

  const existingCode = await repo.getCanonicalConceptByCode(input.code);
  if (existingCode) {
    throw new NormalizationError("DUPLICATE_CODE", `Canonical concept with code "${input.code}" already exists.`);
  }

  const existingSlug = await repo.getCanonicalConceptBySlug(input.slug);
  if (existingSlug) {
    throw new NormalizationError("DUPLICATE_SLUG", `Canonical concept with slug "${input.slug}" already exists.`);
  }

  return repo.createCanonicalConcept({
    code: input.code,
    slug: input.slug,
    name: input.name.trim(),
    shortDescription: input.shortDescription ?? null,
    status: (input.status as ServiceCanonicalConcept["status"] | undefined) ?? "active",
    displayOrder: input.displayOrder ?? 0,
  });
}

export async function getCanonicalConcept(slug: string): Promise<ServiceCanonicalConcept> {
  const concept = await repo.getCanonicalConceptBySlug(slug);
  if (!concept) {
    throw new NormalizationError("NOT_FOUND", `Canonical concept "${slug}" not found.`);
  }
  return concept;
}

export async function listCanonicalConcepts(opts: { status?: string } = {}): Promise<ServiceCanonicalConcept[]> {
  return repo.listCanonicalConcepts(opts);
}

export async function updateCanonicalConcept(
  slug: string,
  input: { name?: string; shortDescription?: string | null; status?: string; displayOrder?: number; slug?: string },
): Promise<ServiceCanonicalConcept> {
  const concept = await repo.getCanonicalConceptBySlug(slug);
  if (!concept) {
    throw new NormalizationError("NOT_FOUND", `Canonical concept "${slug}" not found.`);
  }
  if (input.status && !ALLOWED_STATUSES.has(input.status)) {
    throw new NormalizationError("INVALID_STATUS", `Status must be one of: ${[...ALLOWED_STATUSES].join(", ")}`);
  }
  if (input.name && (input.name.trim().length < 2 || input.name.length > 200)) {
    throw new NormalizationError("INVALID_NAME", "Name must be 2–200 characters.");
  }
  if (input.slug) {
    if (!isValidSlug(input.slug)) {
      throw new NormalizationError("INVALID_SLUG", `Slug "${input.slug}" is not valid.`);
    }
    const existing = await repo.getCanonicalConceptBySlug(input.slug);
    if (existing && existing.id !== concept.id) {
      throw new NormalizationError("DUPLICATE_SLUG", `Slug "${input.slug}" is already taken.`);
    }
  }

  const updated = await repo.updateCanonicalConcept(concept.id, {
    name: input.name?.trim(),
    shortDescription: input.shortDescription,
    status: input.status as ServiceCanonicalConcept["status"] | undefined,
    displayOrder: input.displayOrder,
    slug: input.slug,
  });

  if (!updated) {
    throw new NormalizationError("NOT_FOUND", `Canonical concept "${slug}" could not be updated.`);
  }
  return updated;
}

// ── Normalization Mappings ────────────────────────────────────────────────────

export async function createMapping(input: {
  conceptSlug: string;
  serviceId: number;
  relationshipType?: string;
  isPrimary?: boolean;
  reviewNotes?: string | null;
}): Promise<ServiceNormalizationMapping> {
  const concept = await repo.getCanonicalConceptBySlug(input.conceptSlug);
  if (!concept) {
    throw new NormalizationError("NOT_FOUND", `Canonical concept "${input.conceptSlug}" not found.`);
  }

  if (input.relationshipType && !RELATIONSHIP_TYPES.has(input.relationshipType)) {
    throw new NormalizationError(
      "INVALID_RELATIONSHIP_TYPE",
      `Relationship type must be one of: ${[...RELATIONSHIP_TYPES].join(", ")}`,
    );
  }

  // Verify service exists — do not fabricate or derive IDs
  const [svc] = await db.select({ id: aiServicesTable.id }).from(aiServicesTable)
    .where(eq(aiServicesTable.id, input.serviceId)).limit(1);
  if (!svc) {
    throw new NormalizationError("SERVICE_NOT_FOUND", `Service with id ${input.serviceId} not found.`);
  }

  // A service may only be mapped to one canonical concept
  const existingMapping = await repo.getMappingByServiceId(input.serviceId);
  if (existingMapping) {
    throw new NormalizationError(
      "CONFLICTING_MAPPING",
      `Service ${input.serviceId} is already mapped to a canonical concept.`,
    );
  }

  // At most one primary per concept
  if (input.isPrimary) {
    const existingPrimary = await repo.getPrimaryMappingForConcept(concept.id);
    if (existingPrimary) {
      throw new NormalizationError(
        "CONFLICTING_PRIMARY",
        `Canonical concept "${input.conceptSlug}" already has a primary mapping (service ${existingPrimary.serviceId}).`,
      );
    }
  }

  return repo.createMapping({
    canonicalConceptId: concept.id,
    serviceId: input.serviceId,
    relationshipType: input.relationshipType ?? "related",
    isPrimary: input.isPrimary ?? false,
    reviewNotes: input.reviewNotes ?? null,
  });
}

export async function listMappings(conceptSlug: string): Promise<ServiceNormalizationMapping[]> {
  const concept = await repo.getCanonicalConceptBySlug(conceptSlug);
  if (!concept) {
    throw new NormalizationError("NOT_FOUND", `Canonical concept "${conceptSlug}" not found.`);
  }
  return repo.listMappingsByConceptId(concept.id);
}

export async function removeMapping(conceptSlug: string, serviceId: number): Promise<void> {
  const concept = await repo.getCanonicalConceptBySlug(conceptSlug);
  if (!concept) {
    throw new NormalizationError("NOT_FOUND", `Canonical concept "${conceptSlug}" not found.`);
  }
  const removed = await repo.deleteMappingByServiceId(concept.id, serviceId);
  if (!removed) {
    throw new NormalizationError("NOT_FOUND", `Service ${serviceId} is not mapped to concept "${conceptSlug}".`);
  }
}

// ── Aliases ───────────────────────────────────────────────────────────────────

export async function createAlias(input: {
  conceptSlug: string;
  alias: string;
  aliasType?: string;
  locale?: string | null;
}): Promise<ServiceAlias> {
  const concept = await repo.getCanonicalConceptBySlug(input.conceptSlug);
  if (!concept) {
    throw new NormalizationError("NOT_FOUND", `Canonical concept "${input.conceptSlug}" not found.`);
  }

  if (input.aliasType && !ALIAS_TYPES.has(input.aliasType)) {
    throw new NormalizationError("INVALID_ALIAS_TYPE", `Alias type must be one of: ${[...ALIAS_TYPES].join(", ")}`);
  }

  const normalized = normalizeAliasString(input.alias);
  if (!normalized || normalized.length < 2 || normalized.length > 200) {
    throw new NormalizationError("INVALID_ALIAS", "Alias must be 2–200 characters.");
  }

  const existing = await repo.getAliasByNormalized(concept.id, normalized);
  if (existing) {
    throw new NormalizationError("DUPLICATE_ALIAS", `Alias "${input.alias}" already exists for this concept.`);
  }

  return repo.createAlias({
    canonicalConceptId: concept.id,
    alias: input.alias.trim(),
    normalizedAlias: normalized,
    aliasType: input.aliasType ?? "name",
    locale: input.locale ?? null,
    status: "active",
  });
}

export async function listAliases(conceptSlug: string): Promise<ServiceAlias[]> {
  const concept = await repo.getCanonicalConceptBySlug(conceptSlug);
  if (!concept) {
    throw new NormalizationError("NOT_FOUND", `Canonical concept "${conceptSlug}" not found.`);
  }
  return repo.listAliasesByConceptId(concept.id);
}

// ── Solution Collections ──────────────────────────────────────────────────────

export async function createCollection(input: {
  code: string;
  slug: string;
  name: string;
  shortDescription?: string | null;
  status?: string;
  visibility?: string;
  displayOrder?: number;
}): Promise<SolutionCollection> {
  if (!isValidCode(input.code)) {
    throw new NormalizationError("INVALID_CODE", `Code "${input.code}" is not valid.`);
  }
  if (!isValidSlug(input.slug)) {
    throw new NormalizationError("INVALID_SLUG", `Slug "${input.slug}" is not valid.`);
  }
  if (!input.name || input.name.trim().length < 2 || input.name.length > 200) {
    throw new NormalizationError("INVALID_NAME", "Name must be 2–200 characters.");
  }
  if (input.status && !ALLOWED_STATUSES.has(input.status)) {
    throw new NormalizationError("INVALID_STATUS", `Status must be one of: ${[...ALLOWED_STATUSES].join(", ")}`);
  }
  if (input.visibility && !ALLOWED_VISIBILITIES.has(input.visibility)) {
    throw new NormalizationError("INVALID_VISIBILITY", `Visibility must be one of: ${[...ALLOWED_VISIBILITIES].join(", ")}`);
  }

  const existing = await repo.getCollectionBySlug(input.slug);
  if (existing) {
    throw new NormalizationError("DUPLICATE_SLUG", `Collection with slug "${input.slug}" already exists.`);
  }

  return repo.createCollection({
    code: input.code,
    slug: input.slug,
    name: input.name.trim(),
    shortDescription: input.shortDescription ?? null,
    status: (input.status ?? "active") as SolutionCollection["status"],
    visibility: (input.visibility ?? "public") as SolutionCollection["visibility"],
    displayOrder: input.displayOrder ?? 0,
  });
}

export async function getCollection(slug: string): Promise<SolutionCollection> {
  const collection = await repo.getCollectionBySlug(slug);
  if (!collection) {
    throw new NormalizationError("NOT_FOUND", `Solution collection "${slug}" not found.`);
  }
  return collection;
}

export async function listCollections(opts: { status?: string; visibility?: string } = {}): Promise<SolutionCollection[]> {
  return repo.listCollections(opts);
}

export async function updateCollection(
  slug: string,
  input: { name?: string; shortDescription?: string | null; status?: string; visibility?: string; displayOrder?: number },
): Promise<SolutionCollection> {
  const collection = await repo.getCollectionBySlug(slug);
  if (!collection) {
    throw new NormalizationError("NOT_FOUND", `Solution collection "${slug}" not found.`);
  }
  if (input.status && !ALLOWED_STATUSES.has(input.status)) {
    throw new NormalizationError("INVALID_STATUS", `Status must be one of: ${[...ALLOWED_STATUSES].join(", ")}`);
  }
  if (input.visibility && !ALLOWED_VISIBILITIES.has(input.visibility)) {
    throw new NormalizationError("INVALID_VISIBILITY", `Visibility must be one of: ${[...ALLOWED_VISIBILITIES].join(", ")}`);
  }
  const updated = await repo.updateCollection(collection.id, {
    name: input.name?.trim(),
    shortDescription: input.shortDescription,
    status: input.status as SolutionCollection["status"] | undefined,
    visibility: input.visibility as SolutionCollection["visibility"] | undefined,
    displayOrder: input.displayOrder,
  });
  if (!updated) {
    throw new NormalizationError("NOT_FOUND", `Solution collection "${slug}" could not be updated.`);
  }
  return updated;
}

export async function addServiceToCollection(input: {
  collectionSlug: string;
  serviceId: number;
  displayOrder?: number;
  role?: string;
  isOptional?: boolean;
}): Promise<SolutionCollectionService> {
  if (input.role && !MEMBER_ROLES.has(input.role)) {
    throw new NormalizationError("INVALID_ROLE", `Role must be one of: ${[...MEMBER_ROLES].join(", ")}`);
  }

  const collection = await repo.getCollectionBySlug(input.collectionSlug);
  if (!collection) {
    throw new NormalizationError("NOT_FOUND", `Solution collection "${input.collectionSlug}" not found.`);
  }

  // Verify service exists — do not fabricate IDs
  const [svc] = await db.select({ id: aiServicesTable.id }).from(aiServicesTable)
    .where(eq(aiServicesTable.id, input.serviceId)).limit(1);
  if (!svc) {
    throw new NormalizationError("SERVICE_NOT_FOUND", `Service with id ${input.serviceId} not found.`);
  }

  const existing = await repo.getCollectionMembership(collection.id, input.serviceId);
  if (existing) {
    throw new NormalizationError(
      "DUPLICATE_MEMBERSHIP",
      `Service ${input.serviceId} is already in collection "${input.collectionSlug}".`,
    );
  }

  return repo.addServiceToCollection({
    collectionId: collection.id,
    serviceId: input.serviceId,
    displayOrder: input.displayOrder ?? 0,
    role: input.role ?? "complementary",
    isOptional: input.isOptional ?? false,
  });
}

export async function removeServiceFromCollection(collectionSlug: string, serviceId: number): Promise<void> {
  const collection = await repo.getCollectionBySlug(collectionSlug);
  if (!collection) {
    throw new NormalizationError("NOT_FOUND", `Solution collection "${collectionSlug}" not found.`);
  }
  const removed = await repo.removeServiceFromCollection(collection.id, serviceId);
  if (!removed) {
    throw new NormalizationError(
      "NOT_FOUND",
      `Service ${serviceId} is not a member of collection "${collectionSlug}".`,
    );
  }
}

export async function getPublicCollectionDetail(slug: string) {
  const collection = await repo.getCollectionBySlug(slug);
  if (!collection || collection.status !== "active" || collection.visibility !== "public") {
    throw new NormalizationError("NOT_FOUND", `Solution collection "${slug}" not found.`);
  }
  const services = await repo.listEligibleServicesForCollection(collection.id);
  return { collection, services };
}

export async function listPublicCollections() {
  return repo.listCollections({ status: "active", visibility: "public" });
}
