/**
 * service-normalization.ts — Team 04 routes
 *
 * Admin routes (require ADMIN_API_KEY via adminAuthWithExceptions):
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
 *   - Public endpoints never expose review_notes, admin metadata, or duplicate classifications.
 *   - All write endpoints require admin auth (handled globally by adminAuthWithExceptions).
 *   - Input validation uses zod; no second validation library introduced.
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
  // Unexpected errors — do not leak internals
  console.error("[service-normalization] Unexpected error:", err);
  res.status(500).json({ error: "Internal server error" });
}

// ── Validation schemas ────────────────────────────────────────────────────────

const createConceptSchema = z.object({
  code: z.string().min(2).max(64),
  slug: z.string().min(2).max(64),
  name: z.string().min(2).max(200),
  shortDescription: z.string().max(500).nullish(),
  status: z.enum(["active", "draft", "archived"]).optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
});

const patchConceptSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  shortDescription: z.string().max(500).nullish(),
  status: z.enum(["active", "draft", "archived"]).optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
  slug: z.string().min(2).max(64).optional(),
});

const createMappingSchema = z.object({
  serviceId: z.number().int().positive(),
  relationshipType: z.enum([...RELATIONSHIP_TYPES] as [string, ...string[]]),
  isPrimary: z.boolean().optional(),
  reviewNotes: z.string().max(1000).nullish(),
});

const createAliasSchema = z.object({
  alias: z.string().min(1).max(200),
  aliasType: z.enum([...ALIAS_TYPES] as [string, ...string[]]).optional(),
  locale: z.string().max(10).optional(),
});

const createCollectionSchema = z.object({
  code: z.string().min(2).max(64),
  slug: z.string().min(2).max(64),
  name: z.string().min(2).max(200),
  shortDescription: z.string().max(500).nullish(),
  status: z.enum(["active", "draft", "archived"]).optional(),
  visibility: z.enum(["public", "internal"]).optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
});

const patchCollectionSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  shortDescription: z.string().max(500).nullish(),
  status: z.enum(["active", "draft", "archived"]).optional(),
  visibility: z.enum(["public", "internal"]).optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
  slug: z.string().min(2).max(64).optional(),
});

const addCollectionServiceSchema = z.object({
  serviceId: z.number().int().positive(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
  role: z.enum([...MEMBER_ROLES] as [string, ...string[]]).optional(),
  isOptional: z.boolean().optional(),
});

// ── Admin: Canonical Concepts ─────────────────────────────────────────────────

router.get("/ai/admin/canonical-services", async (_req, res) => {
  try {
    const concepts = await listCanonicalConcepts();
    res.json({ data: concepts });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/ai/admin/canonical-services", async (req, res) => {
  try {
    const body = createConceptSchema.parse(req.body);
    const concept = await createCanonicalConcept(body);
    res.status(201).json({ data: concept });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/ai/admin/canonical-services/:slug", async (req, res) => {
  try {
    const concept = await getCanonicalConcept(req.params.slug as string);
    const mappings = await listMappings(req.params.slug as string);
    const aliases = await listAliases(req.params.slug as string);
    res.json({ data: { ...concept, mappings, aliases } });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch("/ai/admin/canonical-services/:slug", async (req, res) => {
  try {
    const body = patchConceptSchema.parse(req.body);
    const updated = await updateCanonicalConcept(req.params.slug as string, body);
    res.json({ data: updated });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Admin: Mappings ───────────────────────────────────────────────────────────

router.get("/ai/admin/canonical-services/:slug/mappings", async (req, res) => {
  try {
    const mappings = await listMappings(req.params.slug as string);
    res.json({ data: mappings });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/ai/admin/canonical-services/:slug/mappings", async (req, res) => {
  try {
    const body = createMappingSchema.parse(req.body);
    const mapping = await createMapping({ conceptSlug: req.params.slug as string, ...body });
    res.status(201).json({ data: mapping });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete("/ai/admin/canonical-services/:slug/mappings/:serviceId", async (req, res) => {
  try {
    const serviceId = parseInt(req.params.serviceId as string, 10);
    if (isNaN(serviceId) || serviceId <= 0) {
      res.status(400).json({ error: "serviceId must be a positive integer", code: "INVALID_PARAM" });
      return;
    }
    await removeMapping(req.params.slug as string, serviceId);
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// ── Admin: Aliases ────────────────────────────────────────────────────────────

router.get("/ai/admin/canonical-services/:slug/aliases", async (req, res) => {
  try {
    const aliases = await listAliases(req.params.slug as string);
    res.json({ data: aliases });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/ai/admin/canonical-services/:slug/aliases", async (req, res) => {
  try {
    const body = createAliasSchema.parse(req.body);
    const alias = await createAlias({ conceptSlug: req.params.slug as string, ...body });
    res.status(201).json({ data: alias });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Admin: Solution Collections ───────────────────────────────────────────────

router.get("/ai/admin/solution-collections", async (_req, res) => {
  try {
    const collections = await listCollections();
    res.json({ data: collections });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/ai/admin/solution-collections", async (req, res) => {
  try {
    const body = createCollectionSchema.parse(req.body);
    const collection = await createCollection(body);
    res.status(201).json({ data: collection });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/ai/admin/solution-collections/:slug", async (req, res) => {
  try {
    const collection = await getCollection(req.params.slug as string);
    res.json({ data: collection });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch("/ai/admin/solution-collections/:slug", async (req, res) => {
  try {
    const body = patchCollectionSchema.parse(req.body);
    const updated = await updateCollection(req.params.slug as string, body);
    res.json({ data: updated });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/ai/admin/solution-collections/:slug/services", async (req, res) => {
  try {
    const body = addCollectionServiceSchema.parse(req.body);
    const membership = await addServiceToCollection({
      collectionSlug: req.params.slug as string,
      ...body,
    });
    res.status(201).json({ data: membership });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete("/ai/admin/solution-collections/:slug/services/:serviceId", async (req, res) => {
  try {
    const serviceId = parseInt(req.params.serviceId as string, 10);
    if (isNaN(serviceId) || serviceId <= 0) {
      res.status(400).json({ error: "serviceId must be a positive integer", code: "INVALID_PARAM" });
      return;
    }
    await removeServiceFromCollection(req.params.slug as string, serviceId);
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// ── Public: Solution Collections ─────────────────────────────────────────────
// These paths are added to PUBLIC_PATH_PREFIXES in adminAuth.ts so they bypass
// the admin key requirement. They are read-only and sanitize all internal fields.

router.get("/ai/solution-collections", async (_req, res) => {
  try {
    const collections = await listPublicCollections();
    // Sanitize: expose only customer-safe fields
    const safe = collections.map((c) => ({
      slug: c.slug,
      name: c.name,
      shortDescription: c.shortDescription,
      displayOrder: c.displayOrder,
    }));
    res.json({ data: safe });
  } catch (err) {
    handleError(res, err);
  }
});

router.get("/ai/solution-collections/:slug", async (req, res) => {
  try {
    const { collection, services } = await getPublicCollectionDetail(req.params.slug as string);
    // Sanitize: public response never exposes review_notes, admin metadata,
    // or internal classification details.
    const safeServices = services.map((s) => ({
      serviceCode: s.serviceCode,
      serviceName: s.serviceName,
      shortDescription: s.shortDescription,
      serviceType: s.serviceType,
      serviceFlow: s.serviceFlow,
      startingPrice: s.startingPrice,
      currency: s.currency,
      estimatedDelivery: s.estimatedDelivery,
      deliverables: s.deliverables,
      categoryName: s.categoryName,
      displayOrder: s.membership.displayOrder,
      role: s.membership.role,
      isOptional: s.membership.isOptional,
    }));
    res.json({
      data: {
        slug: collection.slug,
        name: collection.name,
        shortDescription: collection.shortDescription,
        displayOrder: collection.displayOrder,
        services: safeServices,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
