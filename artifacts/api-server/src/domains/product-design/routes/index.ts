/**
 * product-design — Domain Router
 *
 * Mounts all sub-routers under the product-design namespace.
 * Team 24 registers this router at:
 *   /api/ai/product-design
 *
 * Integration hooks:
 *   setConceptStore(store)                   — DB-backed concept store
 *   setConceptResolver(fn)                   — resolve concept by id for mockups/briefs
 *   setManufacturerConceptResolver(fn)       — same resolver for manufacturer routes
 *   setPortRegistry(registry)                — inject real blueprint + composition ports
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import { Router } from "express";
import { conceptsRouter }     from "./concepts";
import { mockupsRouter }      from "./mockups";
import { variantsRouter }     from "./variants";
import { manufacturerRouter } from "./manufacturer";

export const productDesignRouter = Router();

productDesignRouter.use("/concepts",     conceptsRouter);
productDesignRouter.use("/mockups",      mockupsRouter);
productDesignRouter.use("/variants",     variantsRouter);
productDesignRouter.use("/manufacturer", manufacturerRouter);

// Health check (no auth required — Team 24 adds exception)
productDesignRouter.get("/health", async (_req, res) => {
  res.json({ domain: "product-design", status: "ok", team: "20" });
});

// Re-export integration hooks so Team 24 can import from one location
export { setConceptStore }                 from "./concepts";
export { setPortRegistry, setConceptResolver } from "./mockups";
export { setManufacturerConceptResolver }  from "./manufacturer";
