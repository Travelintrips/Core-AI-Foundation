/**
 * product-design — Mockups Router
 *
 * Compose and retrieve product mockups for a concept.
 *
 * Endpoints:
 *   GET  /mockups?conceptId=         List mockups for a concept
 *   POST /mockups                    Compose a new mockup (blueprint + optional render)
 *   GET  /mockups/:id                Get a specific mockup
 *
 * Team 24 injects real port adapters via setPortRegistry().
 * Until then, NullBlueprintPort + NullCompositionPort are used.
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import { Router } from "express";
import type { ProductMockup, ViewAngle, MockupFormat } from "../types/mockup";
import type { ProductDesignPortRegistry } from "../types/ports";
import { NullBlueprintPort }   from "../services/ports/nullBlueprintPort";
import { NullCompositionPort } from "../services/ports/nullCompositionPort";
import { composeMockup }       from "../services/mockupComposer";

export const mockupsRouter = Router();

// ── Port registry (injected by Team 24) ───────────────────────────────────────

let _ports: ProductDesignPortRegistry = {
  blueprint:   new NullBlueprintPort(),
  composition: new NullCompositionPort(),
};

export function setPortRegistry(registry: ProductDesignPortRegistry): void {
  _ports = registry;
}

// ── In-memory store ────────────────────────────────────────────────────────────

const _mockups = new Map<string, ProductMockup>();

// ── Concept resolver (injected by Team 24) ────────────────────────────────────

type ConceptResolver = (id: string) => Promise<import("../types/concept").ProductConcept | null>;
let _resolveConceptById: ConceptResolver = async () => null;

export function setConceptResolver(resolver: ConceptResolver): void {
  _resolveConceptById = resolver;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /mockups?conceptId=
mockupsRouter.get("/", (req, res) => {
  let mockups = Array.from(_mockups.values());
  if (req.query.conceptId) {
    mockups = mockups.filter((m) => m.conceptId === req.query.conceptId);
  }
  res.json({ mockups, total: mockups.length });
});

// POST /mockups
mockupsRouter.post("/", async (req, res) => {
  const {
    conceptId,
    viewAngle = "front",
    widthPx   = 800,
    heightPx  = 1200,
    format    = "png",
    render    = false,
    backgroundColor,
  } = req.body as {
    conceptId?: string;
    viewAngle?: ViewAngle;
    widthPx?: number;
    heightPx?: number;
    format?: MockupFormat;
    render?: boolean;
    backgroundColor?: string;
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
    const mockup = await composeMockup(
      concept,
      { viewAngle, widthPx, heightPx, format, render, backgroundColor },
      _ports.blueprint,
      _ports.composition,
    );
    _mockups.set(mockup.id, mockup);
    res.status(201).json({ mockup });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /mockups/:id
mockupsRouter.get("/:id", (req, res) => {
  const mockup = _mockups.get(req.params["id"]!);
  if (!mockup) {
    res.status(404).json({ error: "Mockup not found." });
    return;
  }
  res.json({ mockup });
});
