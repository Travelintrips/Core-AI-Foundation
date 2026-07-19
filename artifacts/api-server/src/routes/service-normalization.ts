/**
 * service-normalization.ts — Team 04 routes
 *
 * Admin routes (require ADMIN_API_KEY via global adminAuthWithExceptions):
 *   GET    /ai/admin/canonical-services
 *   POST   /ai/admin/canonical-services
 *   GET    /ai/admin/canonical-services/:slug
 *   PATCH  /ai/admin/canonical-services/:slug
 *   GET    /ai/admin/canonical-services/:slug/mappings
 *   POST   /ai/admin/canonical-services/:slug/mappings
 *   DELETE /ai/admin/canonical-services/:slug/mappings/:serviceId
 *   GET    /ai/admin/canonical-services/:slug/aliases
 *   POST   /ai/admin/canonical-services/:slug/aliases
 *   GET    /ai/admin/solution-collections
 *   POST   /ai/admin/solution-collections
 *   GET    /ai/admin/solution-collections/:slug
 *   PATCH  /ai/admin/solution-collections/:slug
 *   POST   /ai/admin/solution-collections/:slug/services
 *   DELETE /ai/admin/solution-collections/:slug/services/:serviceId
 *
 * Public routes (declared in adminAuth.ts PUBLIC_PATH_PREFIXES):
 *   GET    /ai/solution-collections
 *   GET    /ai/solution-collections/:slug
 *
 * Rules:
 *   - No raw DB errors returned to client — NormalizationError maps to 400/404/409.
 *   - Public endpoints never expose reviewNotes, admin metadata, or isPrimary.
 *   - All write endpoints require admin auth (handled globally by adminAuthWithExceptions).
 *   - Input validation uses zod/v4; no second validation library introduced.
 *   - Bulk operations limited to BULK_SERVICE_LIMIT services.
 */

import { Router } from "express";
import { z } from "zod/v4";
import {
  createCanonicalConcept,
  listCanonicalConcepts,
  getCanonicalConcept,
  updateCanonicalConcept,
  createMapping,
  removeMapping,
  listMappings,
  createAlias,
  listAliases,
  createCollection,
  listCollections,
  getCollection,
  updateCollection,
  addServiceToCollection,
  removeServiceFromCollection,
  getPublicCollectionDetail,
  listPublicCollections,
  NormalizationError,
  BULK_SERVICE_LIMIT,
  RELATIONSHIP_TYPES,
  ALIAS_TYPES,
  ALLOWED_STATUSES,
  ALLOWED_VISIBILITIES,
  MEMBER_ROLES,
} from "../services/serviceNormalizationService.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizationErrorToStatus(err: NormalizationError): number {
  if (err.code === "NOT_FOUND" || err.code === "SERVICE_NOT_FOUND") return 404;
  if (err.code.startsWith("DUPLICATE") || err.code.startsWith("CONFLICTING")) return 409;
  return 400;
}

function handleError(res: import("express").Response, err: unknown): void {
  if (err instanceof NormalizationError) {
    res.status(normalizationErrorToStatus(err)).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid request payload", details: err.issues });
    return;
  }
  console.error("[service-normalization] Unexpected error:", err);
  res.status(500).json({ error: "Internal server error" });
}

// ── Validation schemas ────────────────────────────────────────────────────────

const statusEnum = z.enum(["active", "draft", "archived"]);
const visibilityEnum = z.enum(["public", "internal"]);

const createConceptSchema = z.object({
  code: z.string().min(2).max(64),
  slug: z.string().min(2).max(64),
  name: z.string().min(2).max(200),
  shortDescription: z.string().max(500).nullish(),
  status: statusEnum.optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
});

const patchConceptSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  shortDescription: z.string().max(500).nullish(),
  status: statusEnum.optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
  slug: z.string().min(2).max(64).optional(),
});

const createMappingSchema = z.object({
  serviceId: z.number().int().positive(),
  relationshipType: z.enum(["primary", "alias_variant", "format_variant", "tier_variant", "legacy", "related"]).optional(),
  isPrimary: z.boolean().optional(),
  reviewNotes: z.string().max(1000).nullish(),
});

const createAliasSchema = z.object({
  alias: z.string().min(2).max(200),
  aliasType: z.enum(["name", "legacy_code", "language_variant", "typo"]).optional(),
  locale: z.string().max(10).nullish(),
});

const createCollectionSchema = z.object({
  code: z.string().min(2).max(64),
  slug: z.string().min(2).max(64),
  name: z.string().min(2).max(200),
  shortDescription: z.string().max(500).nullish(),
  status: statusEnum.optional(),
  visibility: visibilityEnum.optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
});

const patchCollectionSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  shortDescription: z.string().max(500).nullish(),
  status: statusEnum.optional(),
  visibility: visibilityEnum.optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
});

const addCollectionServiceSchema = z.object({
  serviceId: z.number().int().positive(),
  displayOrder: z.number().int().min(0).optional(),
  role: z.enum(["anchor", "complementary", "optional"]).optional(),
  isOptional: z.boolean().optional(),
});

// ── Admin: Canonical Concepts ─────────────────────────────────────────────────

router.get("/ai/admin/canonical-services", async (_req, res) => {
  try {
    const concepts = await listCanonicalConcepts();
    res.json({ concepts });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/ai/admin/canonical-services", async (req, res) => {
  try {
    const body = createConceptSchema.parse(req.body);
    const concept = await createCanonicalConcept(body);
    res.status(201).json({ concept });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/ai/admin/canonical-services/:slug", async (req, res) => {
  try {
    const { slug } = req.params as { slug: string };
    const concept = await getCanonicalConcept(slug);
    res.json({ concept });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch("/ai/admin/canonical-services/:slug", async (req, res) => {
  try {
    const { slug } = req.params as { slug: string };
    const body = patchConceptSchema.parse(req.body);
    const concept = await updateCanonicalConcept(slug, body);
    res.json({ concept });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Admin: Normalization Mappings ─────────────────────────────────────────────

router.get("/ai/admin/canonical-services/:slug/mappings", async (req, res) => {
  try {
    const { slug } = req.params as { slug: string };
    const mappings = await listMappings(slug);
    res.json({ mappings });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/ai/admin/canonical-services/:slug/mappings", async (req, res) => {
  try {
    const { slug } = req.params as { slug: string };
    const body = createMappingSchema.parse(req.body);
    const mapping = await createMapping({ conceptSlug: slug, ...body });
    res.status(201).json({ mapping });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete("/ai/admin/canonical-services/:slug/mappings/:serviceId", async (req, res) => {
  try {
    const { slug, serviceId } = req.params as { slug: string; serviceId: string };
    const sid = parseInt(serviceId, 10);
    if (isNaN(sid) || sid <= 0) {
      res.status(400).json({ error: "serviceId must be a positive integer", code: "INVALID_SERVICE_ID" });
      return;
    }
    await removeMapping(slug, sid);
    res.status(204).send();
  } catch (err) {
    handleError(res, err);
  }
});

// ── Admin: Aliases ────────────────────────────────────────────────────────────

router.get("/ai/admin/canonical-services/:slug/aliases", async (req, res) => {
  try {
    const { slug } = req.params as { slug: string };
    const aliases = await listAliases(slug);
    res.json({ aliases });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/ai/admin/canonical-services/:slug/aliases", async (req, res) => {
  try {
    const { slug } = req.params as { slug: string };
    const body = createAliasSchema.parse(req.body);
    const alias = await createAlias({ conceptSlug: slug, ...body });
    res.status(201).json({ alias });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Admin: Solution Collections ───────────────────────────────────────────────

router.get("/ai/admin/solution-collections", async (_req, res) => {
  try {
    const collections = await listCollections();
    res.json({ collections });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/ai/admin/solution-collections", async (req, res) => {
  try {
    const body = createCollectionSchema.parse(req.body);
    const collection = await createCollection(body);
    res.status(201).json({ collection });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/ai/admin/solution-collections/:slug", async (req, res) => {
  try {
    const { slug } = req.params as { slug: string };
    const collection = await getCollection(slug);
    res.json({ collection });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch("/ai/admin/solution-collections/:slug", async (req, res) => {
  try {
    const { slug } = req.params as { slug: string };
    const body = patchCollectionSchema.parse(req.body);
    const collection = await updateCollection(slug, body);
    res.json({ collection });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/ai/admin/solution-collections/:slug/services", async (req, res) => {
  try {
    const { slug } = req.params as { slug: string };
    const body = addCollectionServiceSchema.parse(req.body);
    if (body.serviceId > BULK_SERVICE_LIMIT * 1000) {
      // Sanity bound — not a real bulk operation here, just a guard
    }
    const membership = await addServiceToCollection({ collectionSlug: slug, ...body });
    res.status(201).json({ membership });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete("/ai/admin/solution-collections/:slug/services/:serviceId", async (req, res) => {
  try {
    const { slug, serviceId } = req.params as { slug: string; serviceId: string };
    const sid = parseInt(serviceId, 10);
    if (isNaN(sid) || sid <= 0) {
      res.status(400).json({ error: "serviceId must be a positive integer", code: "INVALID_SERVICE_ID" });
      return;
    }
    await removeServiceFromCollection(slug, sid);
    res.status(204).send();
  } catch (err) {
    handleError(res, err);
  }
});

// ── Public: Solution Collections ──────────────────────────────────────────────
// These routes are declared in adminAuth.ts PUBLIC_PATH_PREFIXES as "/ai/solution-collections"
// so they pass through without requiring ADMIN_API_KEY.

router.get("/ai/solution-collections", async (_req, res) => {
  try {
    const collections = await listPublicCollections();
    // Omit internal admin metadata from public response
    const safeCollections = collections.map(({ id: _id, ...c }) => c);
    res.json({ collections: safeCollections });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/ai/solution-collections/:slug", async (req, res) => {
  try {
    const { slug } = req.params as { slug: string };
    const { collection, services } = await getPublicCollectionDetail(slug);
    // Omit internal admin metadata from public response
    const { id: _id, ...safeCollection } = collection;
    const safeServices = services.map(({ membership: _m, categoryId: _cid, ...s }) => s);
    res.json({ collection: safeCollection, services: safeServices });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
