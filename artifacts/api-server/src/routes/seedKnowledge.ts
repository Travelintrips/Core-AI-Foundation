/**
 * Seed Knowledge Route — Enterprise Template Knowledge Library V5.0
 * POST /api/seed/knowledge
 *
 * Seeds styles, industries, sections, and 1200+ template knowledge entries.
 * Idempotent — uses ON CONFLICT DO UPDATE.
 * Admin-only endpoint.
 */

import { Router } from "express";
import { db, aiTemplatesTable } from "@workspace/db";
import { upsertStyle, upsertIndustry, upsertSection } from "../services/knowledgeLibraryService.js";
import { STYLE_KNOWLEDGE } from "../data/styleKnowledgeSeed.js";
import { INDUSTRY_KNOWLEDGE } from "../data/industryKnowledgeSeed.js";
import { SECTION_LIBRARY } from "../data/sectionLibrarySeed.js";
import { generateTemplateKnowledge, getTemplateCount } from "../data/templateKnowledgeGenerator.js";
import type { Request, Response } from "express";

const router = Router();

router.post("/knowledge", async (req: Request, res: Response) => {
  const { parts } = req.query as { parts?: string };
  const runStyles = !parts || parts.includes("styles");
  const runIndustries = !parts || parts.includes("industries");
  const runSections = !parts || parts.includes("sections");
  const runTemplates = !parts || parts.includes("templates");

  const report: Record<string, { status: string; count?: number; error?: string }> = {};

  // ── 1. Styles ────────────────────────────────────────────────────────────

  if (runStyles) {
    try {
      let count = 0;
      for (const style of STYLE_KNOWLEDGE) {
        await upsertStyle(style);
        count++;
      }
      report.styles = { status: "ok", count };
    } catch (err) {
      report.styles = { status: "error", error: String(err) };
    }
  }

  // ── 2. Industries ────────────────────────────────────────────────────────

  if (runIndustries) {
    try {
      let count = 0;
      for (const industry of INDUSTRY_KNOWLEDGE) {
        await upsertIndustry(industry);
        count++;
      }
      report.industries = { status: "ok", count };
    } catch (err) {
      report.industries = { status: "error", error: String(err) };
    }
  }

  // ── 3. Sections ──────────────────────────────────────────────────────────

  if (runSections) {
    try {
      let count = 0;
      for (const section of SECTION_LIBRARY) {
        await upsertSection(section);
        count++;
      }
      report.sections = { status: "ok", count };
    } catch (err) {
      report.sections = { status: "error", error: String(err) };
    }
  }

  // ── 4. Templates (1200+) ─────────────────────────────────────────────────

  if (runTemplates) {
    try {
      const templates = generateTemplateKnowledge();
      let inserted = 0;
      let skipped = 0;

      // Insert in batches of 50 to avoid parameter limits
      const BATCH_SIZE = 50;
      for (let i = 0; i < templates.length; i += BATCH_SIZE) {
        const batch = templates.slice(i, i + BATCH_SIZE);
        const result = await db
          .insert(aiTemplatesTable)
          .values(batch)
          .onConflictDoNothing()
          .returning({ code: aiTemplatesTable.templateCode });
        inserted += result.length;
        skipped += batch.length - result.length;
      }

      report.templates = {
        status: "ok",
        count: inserted,
        // @ts-expect-error extra field
        skipped,
        total: templates.length,
      };
    } catch (err) {
      report.templates = { status: "error", error: String(err) };
    }
  }

  const hasError = Object.values(report).some((r) => r.status === "error");
  res.status(hasError ? 207 : 200).json({
    success: !hasError,
    report,
    message: hasError
      ? "Knowledge seed completed with some errors — see report"
      : "Knowledge library seeded successfully",
  });
});

export default router;
