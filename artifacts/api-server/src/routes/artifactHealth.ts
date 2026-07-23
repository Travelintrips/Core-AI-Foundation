/**
 * artifactHealth.ts — Team 44: Artifact & Deliverable Health endpoint.
 *
 * GET  /api/internal/artifact-health           — run full scanner (read-only)
 * GET  /api/internal/artifact-health/:projectId — scan single project
 *
 * Admin key required. No repair actions exposed here.
 */
import { Router } from "express";
import {
  scanArtifactDeliverableHealth,
} from "../services/artifactDeliverableHealthScanner.js";
import {
  checkDeliverableReady,
  checkFilesUnlocked,
  assertProductionCompletedEligible,
} from "../services/deliveryCompletionGuard.js";

const router = Router();

// GET /internal/artifact-health
router.get("/internal/artifact-health", async (req, res): Promise<void> => {
  try {
    const checkStorage = req.query["checkStorage"] === "true";
    const result = await scanArtifactDeliverableHealth({ checkStorage });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Scanner error: ${msg}` });
  }
});

// GET /internal/artifact-health/:projectId
router.get("/internal/artifact-health/:projectId", async (req, res): Promise<void> => {
  const { projectId } = req.params as { projectId: string };
  try {
    const checkStorage = req.query["checkStorage"] === "true";
    const [scanResult, deliverableReady, filesUnlocked, productionEligible] =
      await Promise.all([
        scanArtifactDeliverableHealth({ projectId, checkStorage }),
        checkDeliverableReady(projectId),
        checkFilesUnlocked(projectId),
        assertProductionCompletedEligible(projectId),
      ]);

    res.json({
      projectId,
      scanner: scanResult,
      guards: {
        deliverableReady,
        filesUnlocked,
        productionCompletedEligible: productionEligible,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Scanner error: ${msg}` });
  }
});

export default router;
