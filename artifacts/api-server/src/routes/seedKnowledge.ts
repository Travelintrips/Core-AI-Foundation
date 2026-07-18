/**
 * Seed Knowledge Route — Enterprise Template Knowledge Library V5.0
 * POST /api/seed/knowledge
 *
 * Seeds styles, industries, sections, and 1200+ template knowledge entries.
 * Idempotent — uses ON CONFLICT DO UPDATE.
 * Admin-only endpoint.
 */

import { Router } from "express";
import { db, aiTemplatesTable, aiTemplateKnowledgeTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { upsertStyle, upsertIndustry, upsertSection } from "../services/knowledgeLibraryService.js";
import { STYLE_KNOWLEDGE } from "../data/styleKnowledgeSeed.js";
import { INDUSTRY_KNOWLEDGE } from "../data/industryKnowledgeSeed.js";
import { SECTION_LIBRARY } from "../data/sectionLibrarySeed.js";
import { generateTemplateKnowledge, getTemplateCount } from "../data/templateKnowledgeGenerator.js";
import { generateTemplateKnowledgePayloads } from "../data/templateKnowledgePayloadGenerator.js";
import { generateLegacyPayloads, findUnresolvedValues } from "../data/legacyTemplateBackfillGenerator.js";
import { normalizeStyle, normalizeIndustry } from "../utils/canonicalNormalizer.js";
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

  // ── 5. Template Knowledge Payloads (rich ai_template_knowledge) ─────────────

  const runPayloads = !parts || parts.includes("payloads");
  if (runPayloads) {
    try {
      const payloads = generateTemplateKnowledgePayloads();
      let inserted = 0;
      let skipped = 0;
      const BATCH_SIZE = 50;
      for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
        const batch = payloads.slice(i, i + BATCH_SIZE);
        const result = await db
          .insert(aiTemplateKnowledgeTable)
          .values(batch)
          .onConflictDoNothing()
          .returning({ code: aiTemplateKnowledgeTable.templateCode });
        inserted += result.length;
        skipped += batch.length - result.length;
      }
      report.payloads = {
        status: "ok",
        count: inserted,
        // @ts-expect-error extra field
        skipped,
        total: payloads.length,
      };
    } catch (err) {
      report.payloads = { status: "error", error: String(err) };
    }
  }

  // ── 6. Normalize legacy style/industry in ai_templates ──────────────────────
  // Idempotent: only updates rows where style/industry is not already canonical.
  // Supports ?dry=true for a dry-run report without executing any UPDATE.

  const runNormalize = !parts || parts.includes("normalize");
  if (runNormalize) {
    const isDryRun = String((req.query as Record<string, string>).dry).toLowerCase() === "true";
    try {
      // Fetch all templates whose style or industry resolves to a different canonical value
      const allTemplates = await db
        .select({
          id:           aiTemplatesTable.id,
          templateCode: aiTemplatesTable.templateCode,
          style:        aiTemplatesTable.style,
          industry:     aiTemplatesTable.industry,
        })
        .from(aiTemplatesTable);

      const toUpdate: Array<{ id: number; templateCode: string; oldStyle?: string; newStyle?: string; oldIndustry?: string; newIndustry?: string }> = [];

      for (const t of allTemplates) {
        let changed = false;
        const entry: (typeof toUpdate)[number] = { id: t.id, templateCode: t.templateCode };

        if (t.style) {
          const canonical = normalizeStyle(t.style);
          if (canonical && canonical !== t.style) {
            entry.oldStyle = t.style;
            entry.newStyle = canonical;
            changed = true;
          }
        }
        if (t.industry) {
          const canonical = normalizeIndustry(t.industry);
          if (canonical && canonical !== t.industry) {
            entry.oldIndustry = t.industry;
            entry.newIndustry = canonical;
            changed = true;
          }
        }
        if (changed) toUpdate.push(entry);
      }

      if (isDryRun) {
        report.normalize = {
          status: "dry_run",
          // @ts-expect-error extra field
          dryRun: true,
          count: toUpdate.length,
          changes: toUpdate,
        };
      } else if (toUpdate.length === 0) {
        report.normalize = { status: "ok", count: 0 };
      } else {
        // Apply in a transaction, row-by-row (safe for small counts ≤300)
        await db.transaction(async (tx) => {
          for (const row of toUpdate) {
            if (row.newStyle && row.newIndustry) {
              await tx.update(aiTemplatesTable)
                .set({ style: row.newStyle, industry: row.newIndustry })
                .where(eq(aiTemplatesTable.id, row.id));
            } else if (row.newStyle) {
              await tx.update(aiTemplatesTable)
                .set({ style: row.newStyle })
                .where(eq(aiTemplatesTable.id, row.id));
            } else if (row.newIndustry) {
              await tx.update(aiTemplatesTable)
                .set({ industry: row.newIndustry })
                .where(eq(aiTemplatesTable.id, row.id));
            }
          }
        });
        report.normalize = {
          status: "ok",
          count: toUpdate.length,
          // @ts-expect-error extra field
          changes: toUpdate,
        };
      }
    } catch (err) {
      report.normalize = { status: "error", error: String(err) };
    }
  }

  // ── 7. Backfill rich payloads for legacy templates (Phase 4) ─────────────
  // Finds all ai_templates rows without a matching ai_template_knowledge entry
  // and generates + inserts the rich payload. ON CONFLICT DO NOTHING ensures
  // existing valid payloads are never overwritten. Idempotent.

  const runBackfill = !parts || parts.includes("backfill");
  if (runBackfill) {
    try {
      // Find templates without a knowledge payload
      const legacyTemplates = await db
        .select()
        .from(aiTemplatesTable)
        .where(
          sql`${aiTemplatesTable.templateCode} NOT IN (
            SELECT template_code FROM ${aiTemplateKnowledgeTable}
          )`,
        );

      if (legacyTemplates.length === 0) {
        report.backfill = { status: "ok", count: 0 };
      } else {
        // Report unresolved values before inserting
        const unresolved = findUnresolvedValues(legacyTemplates);

        const payloads = generateLegacyPayloads(legacyTemplates);
        let inserted = 0;
        let skipped  = 0;
        const BATCH_SIZE = 50;

        for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
          const batch = payloads.slice(i, i + BATCH_SIZE);
          const result = await db
            .insert(aiTemplateKnowledgeTable)
            .values(batch)
            .onConflictDoNothing()
            .returning({ code: aiTemplateKnowledgeTable.templateCode });
          inserted += result.length;
          skipped  += batch.length - result.length;
        }

        report.backfill = {
          status: "ok",
          count:  inserted,
          // @ts-expect-error extra field
          skipped,
          total:  legacyTemplates.length,
          unresolved: {
            styles:     unresolved.styles.length,
            industries: unresolved.industries.length,
            styleList:  unresolved.styles.map((s) => `${s.templateCode}:${s.rawStyle}`),
            industryList: unresolved.industries.map((s) => `${s.templateCode}:${s.rawIndustry}`),
          },
        };
      }
    } catch (err) {
      report.backfill = { status: "error", error: String(err) };
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
