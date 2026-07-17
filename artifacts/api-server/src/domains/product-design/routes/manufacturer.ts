/**
 * product-design — Manufacturer Brief Router
 *
 * Generates and retrieves manufacturer requirement briefs.
 *
 * Endpoints:
 *   POST /manufacturer/brief          Generate a brief for a concept
 *   GET  /manufacturer/brief/:id      Retrieve a generated brief
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import { Router } from "express";
import type { ManufacturerBrief } from "../types/manufacturer";
import { buildManufacturerBrief } from "../services/manufacturerBriefBuilder";

export const manufacturerRouter = Router();

// ── In-memory store ────────────────────────────────────────────────────────────

const _briefs = new Map<string, ManufacturerBrief>();

// ── Concept resolver (injected by Team 24) ────────────────────────────────────

type ConceptResolver = (id: string) => Promise<import("../types/concept").ProductConcept | null>;
let _resolveConceptById: ConceptResolver = async () => null;

export function setManufacturerConceptResolver(resolver: ConceptResolver): void {
  _resolveConceptById = resolver;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /manufacturer/brief
manufacturerRouter.post("/brief", async (req, res) => {
  const { conceptId, logisticsNotes } = req.body as {
    conceptId?: string;
    logisticsNotes?: string;
  };

  if (!conceptId) {
    res.status(400).json({ error: "conceptId is required." });
    return;
  }

  const concept = await _resolveConceptById(conceptId);
  if (!concept) {
    res.status(404).json({ error: `Concept "${conceptId}" not found.` });
    return;
  }

  try {
    const brief = buildManufacturerBrief(concept, { logisticsNotes });
    _briefs.set(brief.id, brief);
    res.status(201).json({ brief });
  } catch (err: unknown) {
    // Unsupported claim errors are surfaced as 422
    const message = (err as Error).message;
    if (message.includes("Unsupported manufacturing claims")) {
      res.status(422).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

// GET /manufacturer/brief/:id
manufacturerRouter.get("/brief/:id", (req, res) => {
  const brief = _briefs.get(req.params["id"]!);
  if (!brief) {
    res.status(404).json({ error: "Brief not found." });
    return;
  }
  res.json({ brief });
});
