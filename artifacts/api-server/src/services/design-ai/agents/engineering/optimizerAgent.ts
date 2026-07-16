/**
 * Agent 14 — Optimizer AI
 *
 * Applies safe, deterministic structural improvements to a DesignTemplate:
 *   1. Spacing optimizer  — clamps out-of-bounds elements within canvas
 *   2. Layer optimizer    — normalizes z-index sequence (no gaps/duplicates)
 *   3. Alignment optimizer — snaps near-edge/center elements to alignment guides
 *
 * Hard constraints (optimizer MUST NOT violate):
 *   - Never change campaign message or core content
 *   - Never delete required elements
 *   - Never change brand colors or all colors at once
 *   - Never change variable keys without a migration mapping
 *   - Never replace entire layout
 *   - Never invent asset URLs
 *
 * All changes are logged with before/after/reason for full auditability.
 * Unresolvable issues (blocking errors from validator) are forwarded as-is.
 */

import { logger } from "../../../../lib/logger.js";
import type { DesignTemplate } from "../../../../types/designTemplate.js";
import type {
  AgentOutput,
  AgentExecutionMetadata,
  OptimizationResult,
  OptimizationChange,
  ValidationIssue,
  ValidationReport,
} from "../../types/engineering.types.js";
import { optimizeSpacing }   from "../../optimizers/spacingOptimizer.js";
import { optimizeLayers }    from "../../optimizers/layerOptimizer.js";
import { optimizeAlignment } from "../../optimizers/alignmentOptimizer.js";

const AGENT_ID      = "optimizer-ai";
const AGENT_NAME    = "Optimizer AI";
const AGENT_VERSION = "1.0.0";

// Issues that the optimizer can auto-fix (by code)
const AUTO_FIXABLE_CODES = new Set([
  "NEGATIVE_WIDTH",
  "NEGATIVE_HEIGHT",
  "ELEMENT_OUT_OF_BOUNDS",
  "CANVAS_OVERFLOW",
  "DUPLICATE_Z_INDEX",
  "INVALID_Z_INDEX",
]);

// ── Main agent entry point ────────────────────────────────────────────────────

export async function runOptimizerAgent(
  template: DesignTemplate,
  validationReport: ValidationReport,
): Promise<AgentOutput<OptimizationResult>> {
  const startedAt = new Date().toISOString();
  const startMs   = Date.now();
  const agentWarnings: string[] = [];
  const agentErrors:   string[] = [];

  try {
    let current = template;
    const allChanges: OptimizationChange[] = [];

    // ── Pass 1: Spacing (clamp bounds) ────────────────────────────────────────
    const spacingResult = optimizeSpacing(current);
    current = { ...current, elements: spacingResult.elements };
    allChanges.push(...spacingResult.changes);

    // ── Pass 2: Layer ordering ────────────────────────────────────────────────
    const layerResult = optimizeLayers(current.elements);
    current = { ...current, elements: layerResult.elements };
    allChanges.push(...layerResult.changes);

    // ── Pass 3: Alignment snapping ────────────────────────────────────────────
    const alignResult = optimizeAlignment(current);
    current = { ...current, elements: alignResult.elements };
    allChanges.push(...alignResult.changes);

    // Update template metadata to reflect optimization pass
    current = {
      ...current,
      metadata: { ...current.metadata, updatedAt: new Date().toISOString() },
    };

    // ── Collect unresolved issues ─────────────────────────────────────────────
    // Issues that are NOT auto-fixable remain in the unresolved list
    const allIssues: ValidationIssue[] = [
      ...validationReport.errors,
      ...validationReport.warnings,
    ];
    const unresolvedIssues: ValidationIssue[] = allIssues.filter(
      (issue) => !AUTO_FIXABLE_CODES.has(issue.code),
    );

    if (allChanges.length > 0) {
      agentWarnings.push(`Applied ${allChanges.length} optimization(s). Review changes before saving.`);
    }

    const result: OptimizationResult = {
      template: current,
      changes: allChanges,
      unresolvedIssues,
    };

    logger.info(
      { templateId: template.id, changeCount: allChanges.length, unresolvedCount: unresolvedIssues.length },
      `[${AGENT_ID}] Optimization complete`,
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

    return { status: "success", data: result, warnings: agentWarnings, errors: agentErrors, metadata };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, `[${AGENT_ID}] Unexpected optimizer error`);

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
