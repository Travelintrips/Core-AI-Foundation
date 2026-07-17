/**
 * product-design — Concepts Router
 *
 * CRUD for ProductConcept backed by an in-memory store.
 * In production, Team 24 replaces the in-memory store by calling
 * setConceptStore() with a DB-backed implementation.
 *
 * Endpoints:
 *   GET    /concepts              List all concepts (filter by projectId)
 *   POST   /concepts              Create a concept
 *   GET    /concepts/:id          Get a concept by id
 *   PUT    /concepts/:id          Update a concept
 *   DELETE /concepts/:id          Archive a concept
 *   POST   /concepts/validate     Validate a concept payload without saving
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import type { ProductConcept } from "../types/concept";
import { CONCEPT_DISCLAIMER, TERMINAL_CONCEPT_STATUSES } from "../types/concept";
import { validateDimensions }     from "../services/dimensionsValidator";
import { validateAllPlacements }  from "../services/componentPlacer";
import { validateCMFSpec }        from "../services/cmfValidator";
import { guardAgainstUnsupportedClaims } from "../services/disclaimerService";

export const conceptsRouter = Router();

// ── In-memory store (replaced by Team 24 via setConceptStore) ─────────────────

type ConceptStore = Map<string, ProductConcept>;
let _store: ConceptStore = new Map();

export function setConceptStore(store: ConceptStore): void {
  _store = store;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateConceptPayload(body: unknown): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof body !== "object" || body === null) {
    return { errors: ["Request body must be an object."], warnings: [] };
  }

  const b = body as Record<string, unknown>;

  if (!b.name || typeof b.name !== "string") errors.push("name is required.");
  if (!b.projectId || typeof b.projectId !== "string") errors.push("projectId is required.");
  if (!b.formDirection || typeof b.formDirection !== "object") {
    errors.push("formDirection is required.");
  }
  if (!b.materialDirection || typeof b.materialDirection !== "object") {
    errors.push("materialDirection is required.");
  }
  if (!b.cmf || typeof b.cmf !== "object") {
    errors.push("cmf is required.");
  }

  // Guard against unsupported claims in free-text fields
  const fd = (b.formDirection as Record<string, unknown>) ?? {};
  const md = (b.materialDirection as Record<string, unknown>) ?? {};
  const cmfObj = (b.cmf as Record<string, unknown>) ?? {};

  const claimErrors = [];
  try {
    guardAgainstUnsupportedClaims(
      {
        shapeNotes:          fd.shapeNotes as string | undefined,
        ergonomicNotes:      fd.ergonomicNotes as string | undefined,
        sustainabilityNotes: md.sustainabilityNotes as string | undefined,
        compatibilityNotes:  md.compatibilityNotes as string | undefined,
        processNotes:        cmfObj.processNotes as string | undefined,
      },
      "conceptsRouter/validate",
    );
  } catch (err: unknown) {
    claimErrors.push((err as Error).message);
  }
  errors.push(...claimErrors);

  // Dimensions validation
  if (fd.dimensions && typeof fd.dimensions === "object") {
    const dims = fd.dimensions as Record<string, unknown>;
    const category = (fd.category as string) ?? "custom";
    const dimResult = validateDimensions(
      {
        height:        Number(dims.height),
        width:         Number(dims.width),
        depth:         dims.depth != null ? Number(dims.depth) : undefined,
        wallThickness: dims.wallThickness != null ? Number(dims.wallThickness) : undefined,
        fillVolumeMl:  dims.fillVolumeMl  != null ? Number(dims.fillVolumeMl)  : undefined,
      },
      category as import("../types/concept").FormCategory,
    );
    errors.push(...dimResult.errors);
    warnings.push(...dimResult.warnings);
  }

  // CMF validation
  if (b.cmf && typeof b.cmf === "object") {
    const cmfResult = validateCMFSpec(b.cmf as import("../types/concept").CMFSpec);
    errors.push(...cmfResult.errors);
    warnings.push(...cmfResult.warnings);
  }

  // Placement validation
  if (
    Array.isArray(b.featurePlacements) &&
    Array.isArray(b.labelAreas) &&
    fd.dimensions
  ) {
    const dims = fd.dimensions as Record<string, unknown>;
    const placResult = validateAllPlacements(
      b.featurePlacements as import("../types/concept").FeaturePlacement[],
      b.labelAreas as import("../types/concept").LabelArea[],
      {
        height: Number(dims.height),
        width:  Number(dims.width),
      },
    );
    errors.push(...placResult.errors);
    warnings.push(...placResult.overlapWarnings);
  }

  return { errors, warnings };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /concepts/validate  (must be before /:id)
conceptsRouter.post("/validate", (req, res) => {
  const { errors, warnings } = validateConceptPayload(req.body);
  res.json({ valid: errors.length === 0, errors, warnings });
});

// GET /concepts
conceptsRouter.get("/", (req, res) => {
  let concepts = Array.from(_store.values());
  if (req.query.projectId) {
    concepts = concepts.filter((c) => c.projectId === req.query.projectId);
  }
  if (req.query.status) {
    concepts = concepts.filter((c) => c.status === req.query.status);
  }
  res.json({ concepts, total: concepts.length });
});

// POST /concepts
conceptsRouter.post("/", (req, res) => {
  const { errors, warnings } = validateConceptPayload(req.body);
  if (errors.length > 0) {
    res.status(400).json({ error: "Validation failed.", errors, warnings });
    return;
  }

  const now = new Date();
  const concept: ProductConcept = {
    ...(req.body as Omit<ProductConcept, "id" | "status" | "disclaimer" | "createdAt" | "updatedAt" | "version">),
    id:          randomUUID(),
    status:      "draft",
    disclaimer:  CONCEPT_DISCLAIMER,
    featurePlacements: req.body.featurePlacements ?? [],
    labelAreas:        req.body.labelAreas        ?? [],
    createdAt:   now,
    updatedAt:   now,
    version:     1,
  };

  _store.set(concept.id, concept);
  res.status(201).json({ concept, warnings });
});

// GET /concepts/:id
conceptsRouter.get("/:id", (req, res) => {
  const concept = _store.get(req.params["id"]!);
  if (!concept) {
    res.status(404).json({ error: "Concept not found." });
    return;
  }
  res.json({ concept });
});

// PUT /concepts/:id
conceptsRouter.put("/:id", (req, res) => {
  const concept = _store.get(req.params["id"]!);
  if (!concept) {
    res.status(404).json({ error: "Concept not found." });
    return;
  }
  if (TERMINAL_CONCEPT_STATUSES.includes(concept.status)) {
    res.status(409).json({
      error: `Concept is in terminal status "${concept.status}" and cannot be updated.`,
    });
    return;
  }

  const { errors, warnings } = validateConceptPayload({ ...concept, ...req.body });
  if (errors.length > 0) {
    res.status(400).json({ error: "Validation failed.", errors, warnings });
    return;
  }

  const updated: ProductConcept = {
    ...concept,
    ...req.body,
    id:         concept.id,
    disclaimer: CONCEPT_DISCLAIMER,
    updatedAt:  new Date(),
    version:    concept.version + 1,
  };

  _store.set(updated.id, updated);
  res.json({ concept: updated, warnings });
});

// DELETE /concepts/:id  (soft-archive)
conceptsRouter.delete("/:id", (req, res) => {
  const concept = _store.get(req.params["id"]!);
  if (!concept) {
    res.status(404).json({ error: "Concept not found." });
    return;
  }
  if (concept.status === "archived") {
    res.status(409).json({ error: "Concept is already archived." });
    return;
  }

  const archived: ProductConcept = {
    ...concept,
    status:    "archived",
    updatedAt: new Date(),
    version:   concept.version + 1,
  };
  _store.set(archived.id, archived);
  res.json({ concept: archived });
});
