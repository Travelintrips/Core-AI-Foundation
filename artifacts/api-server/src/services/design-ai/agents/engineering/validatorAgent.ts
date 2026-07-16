/**
 * Agent 13 — Validator AI
 *
 * Runs all four deterministic validators against a DesignTemplate and
 * assembles a structured ValidationReport.
 *
 * Validation is intentionally deterministic — no AI calls are made here.
 * The "AI" label means it lives in the agent pipeline; the checks themselves
 * are code-based so results are reproducible and fast.
 *
 * Checks performed (in order):
 *   1. templateValidator  — IDs, types, sizes, colors, fonts, z-index
 *   2. bindingValidator   — variable binding consistency
 *   3. boundsValidator    — canvas overflow & out-of-bounds
 *   4. overlapValidator   — dangerous overlaps & CTA coverage
 */

import { logger } from "../../../../lib/logger.js";
import type { DesignTemplate } from "../../../../types/designTemplate.js";
import type {
  AgentOutput,
  AgentExecutionMetadata,
  ValidationReport,
  ValidationIssue,
} from "../../types/engineering.types.js";
import { runTemplateValidator } from "../../validators/templateValidator.js";
import { runBindingValidator }  from "../../validators/bindingValidator.js";
import { runBoundsValidator }   from "../../validators/boundsValidator.js";
import { runOverlapValidator }  from "../../validators/overlapValidator.js";

const AGENT_ID      = "validator-ai";
const AGENT_NAME    = "Validator AI";
const AGENT_VERSION = "1.0.0";

// ── Score calculation ─────────────────────────────────────────────────────────

function computeScore(errors: ValidationIssue[], warnings: ValidationIssue[]): number {
  // Start at 100; deduct 10 per error, 3 per warning, floor at 0
  const deduction = errors.length * 10 + warnings.length * 3;
  return Math.max(0, 100 - deduction);
}

// ── Main agent entry point ────────────────────────────────────────────────────

export async function runValidatorAgent(
  template: DesignTemplate,
): Promise<AgentOutput<ValidationReport>> {
  const startedAt = new Date().toISOString();
  const startMs   = Date.now();
  const agentWarnings: string[] = [];
  const agentErrors:   string[] = [];

  try {
    // ── Run all validators (deterministic) ───────────────────────────────────
    const allIssues: ValidationIssue[] = [
      ...runTemplateValidator(template),
      ...runBindingValidator(template),
      ...runBoundsValidator(template),
      ...runOverlapValidator(template),
    ];

    const errors   = allIssues.filter((i) => i.severity === "error");
    const warnings = allIssues.filter((i) => i.severity === "warning");
    const info     = allIssues.filter((i) => i.severity === "info");
    const score    = computeScore(errors, warnings);
    const passed   = errors.length === 0;

    const report: ValidationReport = { passed, score, errors, warnings, info };

    logger.info(
      { templateId: template.id, passed, score, errorCount: errors.length, warningCount: warnings.length },
      `[${AGENT_ID}] Validation complete`,
    );

    const metadata: AgentExecutionMetadata = {
      agentId:      AGENT_ID,
      agentName:    AGENT_NAME,
      agentVersion: AGENT_VERSION,
      startedAt,
      completedAt: new Date().toISOString(),
      latencyMs:   Date.now() - startMs,
      retryCount:  0,
    };

    return { status: "success", data: report, warnings: agentWarnings, errors: agentErrors, metadata };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, `[${AGENT_ID}] Unexpected validation error`);

    const metadata: AgentExecutionMetadata = {
      agentId:      AGENT_ID,
      agentName:    AGENT_NAME,
      agentVersion: AGENT_VERSION,
      startedAt,
      completedAt: new Date().toISOString(),
      latencyMs:   Date.now() - startMs,
      retryCount:  0,
    };

    return { status: "failed", data: null, warnings: agentWarnings, errors: [msg], metadata };
  }
}
