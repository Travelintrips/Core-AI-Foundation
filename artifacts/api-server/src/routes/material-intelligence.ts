/**
 * Phase 2 — additive AI Smart Search & Matching routes.
 *
 * These routes intentionally sit beside, rather than inside, the Phase 1
 * Material Library router. The intelligence domain never changes the Phase 1
 * CRUD/search contract.
 */

import { Router } from "express";
import {
  getMaterialAnalytics,
  intelligentSearch,
  materialSuggestions,
  similarMaterials,
} from "../domains/material-intelligence/index.js";
import type { MaterialSearchMode } from "../domains/material-intelligence/types.js";

const router = Router();
const MODES: MaterialSearchMode[] = ["exact", "keyword", "fuzzy", "semantic-ready", "hybrid"];

function stringQuery(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function numberQuery(value: unknown, fallback: number, max: number): number {
  const parsed = Number(stringQuery(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.floor(parsed))) : fallback;
}

function modeQuery(value: unknown): MaterialSearchMode | undefined {
  const mode = stringQuery(value);
  return mode && MODES.includes(mode as MaterialSearchMode)
    ? mode as MaterialSearchMode
    : undefined;
}

router.get("/material-library/search", async (req, res): Promise<void> => {
  const mode = stringQuery(req.query["mode"]);
  if (mode && !MODES.includes(mode as MaterialSearchMode)) {
    res.status(400).json({ error: `mode must be one of: ${MODES.join(", ")}` });
    return;
  }
  try {
    const result = await intelligentSearch({
      query: stringQuery(req.query["q"]) ?? stringQuery(req.query["search"]),
      category: stringQuery(req.query["category"]),
      brand: stringQuery(req.query["brand"]),
      priceTier: stringQuery(req.query["priceTier"]),
      style: stringQuery(req.query["style"]),
      component: stringQuery(req.query["component"]),
      color: stringQuery(req.query["color"]),
      finish: stringQuery(req.query["finish"]),
      material: stringQuery(req.query["material"]),
      mode: modeQuery(req.query["mode"]),
      limit: numberQuery(req.query["limit"], 20, 100),
    });
    res.json(result);
  } catch (error) {
    req.log.error({ err: error }, "Material intelligence search failed");
    res.status(500).json({ error: "Material intelligence search failed" });
  }
});

router.get("/material-library/suggestions", async (req, res): Promise<void> => {
  try {
    res.json(await materialSuggestions(
      stringQuery(req.query["q"]) ?? stringQuery(req.query["search"]) ?? "",
      numberQuery(req.query["limit"], 10, 50),
    ));
  } catch (error) {
    req.log.error({ err: error }, "Material suggestions failed");
    res.status(500).json({ error: "Material suggestions failed" });
  }
});

router.get("/material-library/:id/similar", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id must be a positive integer" });
    return;
  }
  try {
    const result = await similarMaterials(id, numberQuery(req.query["limit"], 12, 50));
    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.endsWith("not found")) {
      res.status(404).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Similar materials lookup failed");
    res.status(500).json({ error: "Similar materials lookup failed" });
  }
});

router.get("/material-library/intelligence/analytics", (_req, res): void => {
  res.json(getMaterialAnalytics());
});

export default router;