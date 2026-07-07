/**
 * export-routes.ts — Export endpoints for Creative AI projects and analytics.
 *
 * GET /creative-ai/projects/:id/export/markdown  — Export project result as Markdown
 * GET /ai/analytics/export/csv                   — Export cost records as CSV
 */

import { Router } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, creativeProjectsTable, creativeProjectStepsTable, aiCostRecordsTable } from "@workspace/db";
import { logAudit } from "../services/aiAuditService.js";

const router = Router();

// ── Markdown generation ───────────────────────────────────────────────────────

function renderSection(title: string, data: unknown, depth = 2): string {
  const prefix = "#".repeat(depth);
  let out = `\n${prefix} ${title}\n\n`;

  if (data == null) return out + "_No data_\n";
  if (typeof data === "string") return out + data + "\n";
  if (typeof data === "number" || typeof data === "boolean") return out + String(data) + "\n";
  if (Array.isArray(data)) {
    return out + data.map((item) => `- ${typeof item === "object" ? JSON.stringify(item) : String(item)}`).join("\n") + "\n";
  }
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      if (Array.isArray(value)) {
        out += `**${label}:**\n${value.map((v) => `- ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("\n")}\n\n`;
      } else if (typeof value === "object" && value !== null) {
        out += `**${label}:**\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n\n`;
      } else {
        out += `**${label}:** ${String(value ?? "—")}\n\n`;
      }
    }
    return out;
  }
  return out + String(data) + "\n";
}

function projectToMarkdown(
  project: typeof creativeProjectsTable.$inferSelect,
  steps: Array<typeof creativeProjectStepsTable.$inferSelect>,
): string {
  const result = project.result as Record<string, unknown> | null;
  let md = `# Creative Brief: ${project.brandName}\n\n`;
  md += `> **Status:** ${project.status}  \n`;
  md += `> **Business Type:** ${project.businessType}  \n`;
  md += `> **Target Market:** ${project.targetMarket}  \n`;
  md += `> **Product / Service:** ${project.productOrService}  \n`;
  if (project.stylePreference) md += `> **Style Preference:** ${project.stylePreference}  \n`;
  md += `> **Goal:** ${project.goal}  \n`;
  if (project.notes) md += `> **Notes:** ${project.notes}  \n`;
  md += `> **Created:** ${new Date(project.createdAt).toISOString()}  \n\n`;
  md += `---\n`;

  if (result) {
    if (result.brandStrategy)    md += renderSection("Brand Strategy",    result.brandStrategy);
    if (result.creativeDirection) md += renderSection("Creative Direction", result.creativeDirection);
    if (result.copy)              md += renderSection("Copy Production",    result.copy);
    if (result.qcReview)          md += renderSection("Quality Control Review", result.qcReview);
  } else {
    md += "\n_No results yet — workflow may still be running._\n";
  }

  // Execution metadata table
  if (steps.length > 0) {
    md += `\n## Execution Summary\n\n`;
    md += `| Step | Status | Model | Provider | Tokens | Latency |\n`;
    md += `|------|--------|-------|----------|--------|----------|\n`;
    for (const s of steps) {
      const latency = s.latencyMs != null ? `${(s.latencyMs / 1000).toFixed(1)}s` : "—";
      md += `| ${s.stepName} | ${s.status} | ${s.model ?? "—"} | ${s.provider ?? "—"} | ${s.tokenUsage} | ${latency} |\n`;
    }
    md += "\n";
  }

  md += `\n---\n_Exported from AI Platform Enterprise_\n`;
  return md;
}

// ── Export: Markdown ──────────────────────────────────────────────────────────

router.get("/creative-ai/projects/:id/export/markdown", async (req, res): Promise<void> => {
  const { id } = req.params;

  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, id));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const steps = await db
    .select()
    .from(creativeProjectStepsTable)
    .where(eq(creativeProjectStepsTable.projectId, project.id))
    .orderBy(creativeProjectStepsTable.createdAt);

  const markdown = projectToMarkdown(project, steps);
  const filename = `${project.brandName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-creative-brief.md`;

  await logAudit("creative-ai", "export_markdown", project.projectId, "creative_project", "success", {});

  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(markdown);
});

// ── Export: Analytics CSV ─────────────────────────────────────────────────────

router.get("/ai/analytics/export/csv", async (req, res): Promise<void> => {
  const days = Math.min(parseInt(String(req.query.days ?? "30"), 10), 365);
  const provider = typeof req.query.provider === "string" ? req.query.provider : null;
  const agent = typeof req.query.agent === "string" ? req.query.agent : null;

  let query = db
    .select()
    .from(aiCostRecordsTable)
    .where(sql`created_at >= now() - interval '${sql.raw(String(days))} days'`)
    .orderBy(desc(aiCostRecordsTable.createdAt))
    .$dynamic();

  if (provider) {
    query = query.where(sql`provider = ${provider}`) as typeof query;
  }
  if (agent) {
    query = query.where(sql`agent_slug = ${agent}`) as typeof query;
  }

  const rows = await query;

  const headers = [
    "id", "project_id", "client_id", "agent_slug", "provider", "model",
    "input_tokens", "output_tokens", "total_tokens",
    "estimated_cost_usd", "latency_ms", "retry_count", "fallback_count",
    "status", "created_at",
  ];

  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };

  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.id, r.projectId, r.clientId, r.agentSlug, r.provider, r.model,
        r.inputTokens, r.outputTokens, r.totalTokens,
        r.estimatedCostUsd, r.latencyMs, r.retryCount, r.fallbackCount,
        r.status, r.createdAt?.toISOString(),
      ]
        .map(escape)
        .join(","),
    ),
  ].join("\r\n");

  await logAudit("analytics", "export_csv", "system", "ai_cost_records", "success", { rows: rows.length, days });

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="analytics-cost-report-${days}d.csv"`);
  res.send(csv);
});

export default router;
