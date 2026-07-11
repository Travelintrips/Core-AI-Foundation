/**
 * automation.ts — Sprint P2.6 Commercial Automation Layer
 *
 * Admin routes for managing automation rules, viewing execution logs,
 * and triggering rule seeding.
 *
 * All routes require admin auth (via the /api prefix in app.ts).
 */

import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import {
  db,
  aiAutomationRulesTable,
  aiAutomationExecutionsTable,
  aiCustomerSegmentsTable,
} from "@workspace/db";
import { logAudit } from "../services/aiAuditService.js";
import {
  getAutomationStats,
  seedDefaultAutomationRules,
  evaluateRulesForEvent,
} from "../services/commercialAutomationService.js";
import {
  getSegmentDistribution,
  recalculateAllSegments,
  calculateCustomerSegment,
  getCustomerSegment,
} from "../services/customerSegmentService.js";

const router = Router();

// ── GET /api/ai/automation/stats ──────────────────────────────────────────────

router.get("/ai/automation/stats", async (_req, res): Promise<void> => {
  const stats = await getAutomationStats();
  res.json(stats);
});

// ── GET /api/ai/automation/rules ──────────────────────────────────────────────

router.get("/ai/automation/rules", async (_req, res): Promise<void> => {
  const rules = await db
    .select()
    .from(aiAutomationRulesTable)
    .orderBy(desc(aiAutomationRulesTable.priority));
  res.json(rules);
});

// ── POST /api/ai/automation/rules ─────────────────────────────────────────────

router.post("/ai/automation/rules", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { ruleCode, ruleName, triggerEvent, conditionsJson, actionType, actionConfigJson, priority, isEnabled, description } = body;

  if (!ruleCode || !ruleName || !triggerEvent || !actionType) {
    res.status(400).json({ error: "ruleCode, ruleName, triggerEvent, actionType required" });
    return;
  }

  const [existing] = await db
    .select({ id: aiAutomationRulesTable.id })
    .from(aiAutomationRulesTable)
    .where(eq(aiAutomationRulesTable.ruleCode, String(ruleCode)))
    .limit(1);

  if (existing) {
    res.status(409).json({ error: "ruleCode already exists" });
    return;
  }

  const [rule] = await db
    .insert(aiAutomationRulesTable)
    .values({
      ruleCode: String(ruleCode),
      ruleName: String(ruleName),
      description: description ? String(description) : null,
      triggerEvent: String(triggerEvent),
      conditionsJson: (conditionsJson as Record<string, unknown>) ?? {},
      actionType: String(actionType),
      actionConfigJson: (actionConfigJson as Record<string, unknown>) ?? null,
      priority: typeof priority === "number" ? priority : 50,
      isEnabled: isEnabled !== false,
    })
    .returning();

  await logAudit("automation", "rule_created", String(rule.id), "ai_automation_rule", "success", { ruleCode });
  res.status(201).json(rule);
});

// ── PATCH /api/ai/automation/rules/:id ───────────────────────────────────────

router.patch("/ai/automation/rules/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const update: Partial<typeof aiAutomationRulesTable.$inferInsert> = {};

  if (typeof body.ruleName === "string") update.ruleName = body.ruleName;
  if (typeof body.description === "string") update.description = body.description;
  if (typeof body.conditionsJson === "object" && body.conditionsJson !== null) update.conditionsJson = body.conditionsJson as Record<string, unknown>;
  if (typeof body.actionConfigJson === "object") update.actionConfigJson = body.actionConfigJson as Record<string, unknown>;
  if (typeof body.priority === "number") update.priority = body.priority;
  if (typeof body.isEnabled === "boolean") update.isEnabled = body.isEnabled;

  if (Object.keys(update).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
  update.updatedAt = new Date();

  const [rule] = await db
    .update(aiAutomationRulesTable)
    .set(update)
    .where(eq(aiAutomationRulesTable.id, id))
    .returning();

  if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }

  await logAudit("automation", "rule_updated", String(id), "ai_automation_rule", "success", update);
  res.json(rule);
});

// ── POST /api/ai/automation/rules/:id/toggle ──────────────────────────────────

router.post("/ai/automation/rules/:id/toggle", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [current] = await db
    .select({ isEnabled: aiAutomationRulesTable.isEnabled })
    .from(aiAutomationRulesTable)
    .where(eq(aiAutomationRulesTable.id, id))
    .limit(1);
  if (!current) { res.status(404).json({ error: "Rule not found" }); return; }

  const [rule] = await db
    .update(aiAutomationRulesTable)
    .set({ isEnabled: !current.isEnabled, updatedAt: new Date() })
    .where(eq(aiAutomationRulesTable.id, id))
    .returning();

  res.json({ id: rule.id, isEnabled: rule.isEnabled });
});

// ── GET /api/ai/automation/executions ────────────────────────────────────────

router.get("/ai/automation/executions", async (req, res): Promise<void> => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
  const rows = await db
    .select()
    .from(aiAutomationExecutionsTable)
    .orderBy(desc(aiAutomationExecutionsTable.executedAt))
    .limit(limit);
  res.json(rows);
});

// ── POST /api/ai/automation/seed ─────────────────────────────────────────────

router.post("/ai/automation/seed", async (_req, res): Promise<void> => {
  await seedDefaultAutomationRules();
  res.json({ ok: true, message: "Default automation rules seeded" });
});

// ── POST /api/ai/automation/test ──────────────────────────────────────────────
// Manual trigger for testing a rule against synthetic data

router.post("/ai/automation/test", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const eventType = typeof body.eventType === "string" ? body.eventType : "test.event";
  const payload = typeof body.payload === "object" && body.payload !== null
    ? (body.payload as Record<string, unknown>)
    : {};

  const results = await evaluateRulesForEvent({ eventType, payload });
  res.json({ results });
});

// ── GET /api/ai/automation/segments ──────────────────────────────────────────

router.get("/ai/automation/segments", async (_req, res): Promise<void> => {
  const distribution = await getSegmentDistribution();
  const rows = await db
    .select()
    .from(aiCustomerSegmentsTable)
    .orderBy(desc(aiCustomerSegmentsTable.updatedAt))
    .limit(100);
  res.json({ distribution, segments: rows });
});

// ── POST /api/ai/automation/segments/recalculate ─────────────────────────────

router.post("/ai/automation/segments/recalculate", async (_req, res): Promise<void> => {
  const result = await recalculateAllSegments();
  res.json({ ok: true, ...result });
});

// ── POST /api/ai/automation/segments/:customerProfileId ──────────────────────

router.post("/ai/automation/segments/:customerProfileId", async (req, res): Promise<void> => {
  const customerProfileId = parseInt(req.params.customerProfileId, 10);
  if (isNaN(customerProfileId)) { res.status(400).json({ error: "Invalid customerProfileId" }); return; }
  const seg = await calculateCustomerSegment(customerProfileId);
  res.json(seg);
});

// ── GET /api/ai/automation/insights ──────────────────────────────────────────
// Real-data AI insights for the owner dashboard

router.get("/ai/automation/insights", async (_req, res): Promise<void> => {
  try {
    const [distribution, execStats] = await Promise.all([
      getSegmentDistribution(),
      getAutomationStats(),
    ]);

    // Build qualitative insights from real data
    const insights: Array<{ title: string; body: string; type: string; datapoint?: string }> = [];

    // Segment insights
    const vipCount = distribution.vip ?? 0;
    const atRiskCount = (distribution.at_risk ?? 0) + (distribution.inactive ?? 0);
    const newCount = distribution.new ?? 0;
    const totalSegmented = Object.values(distribution).reduce((a, b) => a + b, 0);

    if (vipCount > 0) {
      insights.push({
        title: "VIP Customers",
        body: `${vipCount} pelanggan telah mencapai status VIP dengan 10+ order atau health score ≥90. Pertimbangkan program eksklusif untuk mempertahankan mereka.`,
        type: "positive",
        datapoint: `${vipCount} VIP dari ${totalSegmented} pelanggan terlacak`,
      });
    }

    if (atRiskCount > 0) {
      insights.push({
        title: "Pelanggan At-Risk",
        body: `${atRiskCount} pelanggan menunjukkan tanda tidak aktif (>60 hari). Automation reminder sudah aktif, namun pertimbangkan penawaran khusus reaktivasi.`,
        type: "warning",
        datapoint: `${atRiskCount} at-risk / inactive`,
      });
    }

    if (newCount > 0 && totalSegmented > 0) {
      const newPct = Math.round((newCount / totalSegmented) * 100);
      insights.push({
        title: "Akuisisi Pelanggan Baru",
        body: `${newPct}% pelanggan saat ini adalah pelanggan baru yang belum menyelesaikan order pertama mereka. Pastikan onboarding dan brief wizard berjalan lancar.`,
        type: "info",
        datapoint: `${newCount} pelanggan baru (${newPct}%)`,
      });
    }

    // Automation insights
    if (execStats.totalExecutions > 0) {
      const topAction = Object.entries(execStats.byAction).sort((a, b) => b[1] - a[1])[0];
      if (topAction) {
        insights.push({
          title: "Automation Paling Aktif",
          body: `Action "${topAction[0]}" dijalankan ${topAction[1]}× — paling sering dalam engine automation Anda.`,
          type: "info",
          datapoint: `${topAction[1]}× eksekusi`,
        });
      }
    }

    if (insights.length === 0) {
      insights.push({
        title: "Data Belum Cukup",
        body: "Insights akan muncul setelah platform memiliki lebih banyak data transaksi dan interaksi pelanggan. Pastikan seed rules sudah dijalankan.",
        type: "neutral",
      });
    }

    res.json({ insights, generatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
