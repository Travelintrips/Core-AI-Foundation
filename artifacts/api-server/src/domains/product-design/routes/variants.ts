/**
 * product-design — Variants Router
 *
 * CRUD for ConceptVariant with automatic consistency checking.
 *
 * Endpoints:
 *   GET  /variants?baseConceptId=    List variants for a concept
 *   POST /variants                   Create a variant (consistency checked)
 *   GET  /variants/:id               Get a specific variant
 *   POST /variants/:id/check         Re-run consistency check
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import type { ConceptVariant } from "../types/variant";
import { CONCEPT_DISCLAIMER } from "../types/concept";
import { checkVariantConsistency } from "../services/variantConsistencyChecker";

export const variantsRouter = Router();

// ── In-memory store ────────────────────────────────────────────────────────────

const _variants = new Map<string, ConceptVariant>();

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /variants?baseConceptId=
variantsRouter.get("/", (req, res) => {
  let variants = Array.from(_variants.values());
  if (req.query.baseConceptId) {
    variants = variants.filter((v) => v.baseConceptId === req.query.baseConceptId);
  }
  res.json({ variants, total: variants.length });
});

// POST /variants
variantsRouter.post("/", (req, res) => {
  const { baseConceptId, name, deltas } = req.body as Partial<ConceptVariant>;

  if (!baseConceptId) {
    res.status(400).json({ error: "baseConceptId is required." });
    return;
  }
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required." });
    return;
  }
  if (!Array.isArray(deltas) || deltas.length === 0) {
    res.status(400).json({ error: "deltas must be a non-empty array." });
    return;
  }

  const variant: ConceptVariant = {
    id:            randomUUID(),
    baseConceptId,
    name,
    deltas,
    disclaimer:    CONCEPT_DISCLAIMER,
    createdAt:     new Date(),
  };

  // Auto-run consistency check
  const consistencyCheck = checkVariantConsistency(variant);
  variant.consistencyCheck = consistencyCheck;

  if (!consistencyCheck.consistent) {
    res.status(422).json({
      error:   "Variant failed consistency check.",
      issues:  consistencyCheck.issues,
      notes:   consistencyCheck.notes,
      variant,
    });
    return;
  }

  _variants.set(variant.id, variant);
  res.status(201).json({ variant, notes: consistencyCheck.notes });
});

// GET /variants/:id
variantsRouter.get("/:id", (req, res) => {
  const variant = _variants.get(req.params["id"]!);
  if (!variant) {
    res.status(404).json({ error: "Variant not found." });
    return;
  }
  res.json({ variant });
});

// POST /variants/:id/check  — re-run consistency check without mutating
variantsRouter.post("/:id/check", (req, res) => {
  const variant = _variants.get(req.params["id"]!);
  if (!variant) {
    res.status(404).json({ error: "Variant not found." });
    return;
  }
  const result = checkVariantConsistency(variant);
  res.json({ variantId: variant.id, consistencyCheck: result });
});
