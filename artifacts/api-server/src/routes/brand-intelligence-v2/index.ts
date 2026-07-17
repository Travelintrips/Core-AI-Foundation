/**
 * Brand Intelligence 2.0 — Routes (Team 5)
 *
 * Admin routes:  require X-Admin-Api-Key (handled by global middleware in app.ts).
 * Public routes: token-auth via resolveWorkspaceSession.
 *
 * NOT self-registered here — Team 24 will mount this router via integration manifest.
 * Route prefix: /ai/brand-intelligence-v2
 * Public prefix: /public/customer/workspace/:token/brand-intelligence-v2
 *
 * No direct zod import per convention. No @workspace/api-zod import (routes only use
 * manual validation for simplicity — zod schemas are in the OpenAPI fragment).
 */
import { Router } from "express";
import {
  analyzeAndPersistV2,
  getBrandIntelligenceV2,
  getBrandIntelligenceV2Stats,
  redactForPublic,
} from "../../services/brand-intelligence-v2/index.js";
import { logAudit } from "../../services/aiAuditService.js";
import { resolveWorkspaceSession } from "../../services/customerWorkspaceService.js";

const router = Router();

// ── Admin: GET /ai/brand-intelligence-v2/stats ────────────────────────────────
router.get(
  "/ai/brand-intelligence-v2/stats",
  async (_req, res): Promise<void> => {
    const stats = await getBrandIntelligenceV2Stats();
    res.json(stats);
  },
);

// ── Admin: POST /ai/brand-intelligence-v2/analyze ─────────────────────────────
// Trigger full V2 analysis for a clientId (reads V1 Brand DNA via adapter).
router.post(
  "/ai/brand-intelligence-v2/analyze",
  async (req, res): Promise<void> => {
    const { clientId } = req.body as { clientId?: string };
    if (!clientId || typeof clientId !== "string" || !clientId.trim()) {
      res.status(400).json({ error: "clientId is required" });
      return;
    }
    const profile = await analyzeAndPersistV2(clientId.trim());
    res.json(profile);
  },
);

// ── Admin: GET /ai/brand-intelligence-v2/:clientId ────────────────────────────
router.get(
  "/ai/brand-intelligence-v2/:clientId",
  async (req, res): Promise<void> => {
    const { clientId } = req.params as { clientId: string };
    const profile = await getBrandIntelligenceV2(clientId);
    if (!profile) {
      res
        .status(404)
        .json({
          error:
            "Brand Intelligence V2 profile not found. Run POST /ai/brand-intelligence-v2/analyze first.",
        });
      return;
    }
    res.json(profile);
  },
);

// ── Admin: POST /ai/brand-intelligence-v2/:clientId/refresh ───────────────────
router.post(
  "/ai/brand-intelligence-v2/:clientId/refresh",
  async (req, res): Promise<void> => {
    const { clientId } = req.params as { clientId: string };
    const profile = await analyzeAndPersistV2(clientId);
    await logAudit({
      action: "brand_intelligence_v2_refreshed",
      entityType: "brand_intelligence_v2",
      entityId: clientId,
      details: { overallConfidence: profile.dimensionConfidence.overall },
    });
    res.json(profile);
  },
);

// ── Admin: GET /ai/brand-intelligence-v2/:clientId/confidence ─────────────────
// Returns only the dimension confidence breakdown (lightweight).
router.get(
  "/ai/brand-intelligence-v2/:clientId/confidence",
  async (req, res): Promise<void> => {
    const { clientId } = req.params as { clientId: string };
    const profile = await getBrandIntelligenceV2(clientId);
    if (!profile) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    res.json({
      clientId,
      dimensionConfidence: profile.dimensionConfidence,
      analyzedAt: profile.analyzedAt,
    });
  },
);

// ── Admin: GET /ai/brand-intelligence-v2/:clientId/recommendations ────────────
// Returns structured recommendation explanations with evidence.
router.get(
  "/ai/brand-intelligence-v2/:clientId/recommendations",
  async (req, res): Promise<void> => {
    const { clientId } = req.params as { clientId: string };
    const profile = await getBrandIntelligenceV2(clientId);
    if (!profile) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    res.json({
      items: profile.recommendationExplanations,
      total: profile.recommendationExplanations.length,
      criticalCount: profile.recommendationExplanations.filter(
        (r) => r.priority === "critical",
      ).length,
    });
  },
);

// ── Admin: GET /ai/brand-intelligence-v2/:clientId/creative-memory ────────────
// Returns the stored creative memory (full, with avoidPatterns).
router.get(
  "/ai/brand-intelligence-v2/:clientId/creative-memory",
  async (req, res): Promise<void> => {
    const { clientId } = req.params as { clientId: string };
    const profile = await getBrandIntelligenceV2(clientId);
    if (!profile) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    res.json({
      clientId,
      creativeMemory: profile.creativeMemory,
      confidence: profile.dimensionConfidence.creativeMemory,
    });
  },
);

// ── Public (token-auth): GET /public/customer/workspace/:token/brand-intelligence-v2 ──
// Auto-analyzes if no V2 profile exists. Returns redacted view.
router.get(
  "/public/customer/workspace/:token/brand-intelligence-v2",
  async (req, res): Promise<void> => {
    const { token } = req.params as { token: string };
    const result = await resolveWorkspaceSession(token);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const clientId = result.session.emailHash;

    let profile = await getBrandIntelligenceV2(clientId);
    if (!profile) {
      profile = await analyzeAndPersistV2(clientId);
    }

    res.json(redactForPublic(profile));
  },
);

// ── Public (token-auth): POST /public/customer/workspace/:token/brand-intelligence-v2/refresh ──
router.post(
  "/public/customer/workspace/:token/brand-intelligence-v2/refresh",
  async (req, res): Promise<void> => {
    const { token } = req.params as { token: string };
    const result = await resolveWorkspaceSession(token);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const clientId = result.session.emailHash;
    const profile = await analyzeAndPersistV2(clientId);
    res.json(redactForPublic(profile));
  },
);

// ── Public: GET /public/customer/workspace/:token/brand-intelligence-v2/confidence ──
router.get(
  "/public/customer/workspace/:token/brand-intelligence-v2/confidence",
  async (req, res): Promise<void> => {
    const { token } = req.params as { token: string };
    const result = await resolveWorkspaceSession(token);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const clientId = result.session.emailHash;
    const profile = await getBrandIntelligenceV2(clientId);
    if (!profile) {
      res.status(404).json({ error: "No V2 profile yet. Call /refresh first." });
      return;
    }
    // Public view: overall + per-dimension scores only (no evidence detail)
    const pub = {
      overall: profile.dimensionConfidence.overall,
      dimensions: Object.fromEntries(
        Object.entries(profile.dimensionConfidence)
          .filter(([k]) => k !== "overall")
          .map(([k, v]) => [
            k,
            { score: (v as { score: number }).score },
          ]),
      ),
      analyzedAt: profile.analyzedAt,
    };
    res.json(pub);
  },
);

export default router;
