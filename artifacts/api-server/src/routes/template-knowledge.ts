/**
 * Template Knowledge Library Routes — V5.0
 * Mounted at /api/template-knowledge
 *
 * Endpoints:
 *   GET  /styles                    — all style knowledge
 *   GET  /styles/:key               — single style
 *   GET  /industries                — full industry list
 *   GET  /industries/hierarchy      — tree structure
 *   GET  /industries/:key           — single industry + sub-industries
 *   GET  /sections                  — section library
 *   GET  /sections?category=X       — sections for category
 *   GET  /search                    — multi-dimension search
 *   POST /match                     — 10-dimension weighted matching
 *   POST /generate                  — auto-generate template when score <70
 *   GET  /queue                     — approval queue (admin)
 *   POST /queue/:id/approve         — approve generated template
 *   POST /queue/:id/reject          — reject generated template
 *   GET  /stats                     — library dashboard stats
 *   POST /knowledge/event           — record learning event (usage/success/etc.)
 */

import { Router } from "express";
import {
  getAllStyles,
  getStyleByKey,
  getAllIndustries,
  getIndustryByKey,
  getSubIndustries,
  getIndustryHierarchy,
  getAllSections,
  getSectionsByType,
  getSectionsForCategory,
  searchTemplateKnowledge,
  getLibraryStats,
  getApprovalQueue,
  reviewGeneratedTemplate,
  updateLearningStats,
} from "../services/knowledgeLibraryService.js";
import { findBestTemplates } from "../services/templateKnowledgeMatchingService.js";
import { generateHybridTemplate } from "../services/templateAutoGenerationService.js";
import type { Request, Response } from "express";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function ok(res: Response, data: unknown) {
  res.json({ success: true, data });
}

function fail(res: Response, status: number, message: string) {
  res.status(status).json({ success: false, error: message });
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Stats
// ─────────────────────────────────────────────────────────────────────────────

router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await getLibraryStats();
    ok(res, stats);
  } catch (err) {
    fail(res, 500, String(err));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Style Knowledge
// ─────────────────────────────────────────────────────────────────────────────

router.get("/styles", async (_req: Request, res: Response) => {
  try {
    const styles = await getAllStyles();
    ok(res, styles);
  } catch (err) {
    fail(res, 500, String(err));
  }
});

router.get("/styles/:key", async (req: Request, res: Response) => {
  try {
    const key = String(req.params.key);
    const style = await getStyleByKey(key);
    if (!style) return void fail(res, 404, `Style not found: ${key}`);
    ok(res, style);
  } catch (err) {
    fail(res, 500, String(err));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Industry Knowledge
// ─────────────────────────────────────────────────────────────────────────────

router.get("/industries", async (_req: Request, res: Response) => {
  try {
    const industries = await getAllIndustries();
    ok(res, industries);
  } catch (err) {
    fail(res, 500, String(err));
  }
});

router.get("/industries/hierarchy", async (_req: Request, res: Response) => {
  try {
    const hierarchy = await getIndustryHierarchy();
    ok(res, hierarchy);
  } catch (err) {
    fail(res, 500, String(err));
  }
});

router.get("/industries/:key", async (req: Request, res: Response) => {
  try {
    const key = String(req.params.key);
    const [industry, children] = await Promise.all([
      getIndustryByKey(key),
      getSubIndustries(key),
    ]);
    if (!industry) return void fail(res, 404, `Industry not found: ${key}`);
    ok(res, { ...industry, children });
  } catch (err) {
    fail(res, 500, String(err));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section Library
// ─────────────────────────────────────────────────────────────────────────────

router.get("/sections", async (req: Request, res: Response) => {
  try {
    const { category, type } = req.query as { category?: string; type?: string };
    let sections;
    if (category) {
      sections = await getSectionsForCategory(category);
    } else if (type) {
      sections = await getSectionsByType(type);
    } else {
      sections = await getAllSections();
    }
    ok(res, sections);
  } catch (err) {
    fail(res, 500, String(err));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Dimension Search
// ─────────────────────────────────────────────────────────────────────────────

router.get("/search", async (req: Request, res: Response) => {
  try {
    const {
      keyword, industry, style, category,
      personalities, approvalStatus, limit, offset,
    } = req.query as Record<string, string>;

    const results = await searchTemplateKnowledge({
      keyword,
      industry,
      style,
      category,
      personalities: personalities ? personalities.split(",") : undefined,
      approvalStatus,
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    ok(res, results);
  } catch (err) {
    fail(res, 500, String(err));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 10-Dimension Weighted Matching
// ─────────────────────────────────────────────────────────────────────────────

router.post("/match", async (req: Request, res: Response) => {
  try {
    const input = req.body as {
      industry?: string;
      targetAudience?: string;
      brandPersonalities?: string[];
      preferredStyle?: string;
      preferredLayout?: string;
      businessType?: string;
      pricePositioning?: string;
      primaryColor?: string;
      preferredFont?: string;
      keywords?: string[];
      requiredOutputFormats?: string[];
      category?: string;
      packageLevel?: string;
      limit?: number;
      clientId?: string;
    };

    const result = await findBestTemplates(input);
    ok(res, result);
  } catch (err) {
    fail(res, 500, String(err));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Auto-Generation (score < 70)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/generate", async (req: Request, res: Response) => {
  try {
    const { input, triggerScore, nearest, clientId } = req.body as {
      input: Parameters<typeof findBestTemplates>[0];
      triggerScore: number;
      nearest?: Parameters<typeof generateHybridTemplate>[2];
      clientId?: string;
    };

    if (!input) return void fail(res, 400, "input is required");

    const result = await generateHybridTemplate(input, triggerScore ?? 0, nearest, clientId);
    ok(res, result);
  } catch (err) {
    fail(res, 500, String(err));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Approval Queue (admin only)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/queue", async (req: Request, res: Response) => {
  try {
    const { status } = req.query as { status?: string };
    const queue = await getApprovalQueue(status ?? "pending_review");
    ok(res, queue);
  } catch (err) {
    fail(res, 500, String(err));
  }
});

router.post("/queue/:id/approve", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? "0"), 10);
    if (!id) return void fail(res, 400, "Invalid id");
    const { reviewedBy, notes } = req.body as { reviewedBy?: string; notes?: string };
    await reviewGeneratedTemplate(id, "approved", reviewedBy ?? "admin", notes);
    ok(res, { id, status: "approved" });
  } catch (err) {
    fail(res, 500, String(err));
  }
});

router.post("/queue/:id/reject", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? "0"), 10);
    if (!id) return void fail(res, 400, "Invalid id");
    const { reviewedBy, notes } = req.body as { reviewedBy?: string; notes?: string };
    await reviewGeneratedTemplate(id, "rejected", reviewedBy ?? "admin", notes);
    ok(res, { id, status: "rejected" });
  } catch (err) {
    fail(res, 500, String(err));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Learning Events
// ─────────────────────────────────────────────────────────────────────────────

router.post("/knowledge/event", async (req: Request, res: Response) => {
  try {
    const { templateCode, event } = req.body as {
      templateCode: string;
      event: "usage" | "success" | "revision" | "favorite" | "conversion";
    };
    if (!templateCode || !event) return void fail(res, 400, "templateCode and event are required");
    const validEvents = ["usage", "success", "revision", "favorite", "conversion"];
    if (!validEvents.includes(event)) return void fail(res, 400, `Invalid event type. Valid: ${validEvents.join(", ")}`);
    await updateLearningStats(templateCode, event);
    ok(res, { templateCode, event, recorded: true });
  } catch (err) {
    fail(res, 500, String(err));
  }
});

export default router;
