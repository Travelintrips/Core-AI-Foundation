/**
 * Design AI Orchestrator — Final multi-agent pipeline entry point
 *
 * Connects Team 1 (Discovery) → Team 2 stub (Design) → Team 3 stub (Components)
 * → Team 4 stub (Engineering) → Team 5 (Art Director QA + Deterministic Gate).
 *
 * Feature flag: DESIGN_AI_MULTI_AGENT_ENABLED must be true to reach this code.
 * Legacy pipeline: generateTemplateFromPrompt() in templateAiService.ts.
 *
 * Security:
 *  - tenantId and actorId must come from authenticated RequestContext, not raw body
 *  - Internal errors are sanitized before returning to the caller
 *
 * Stub note: Teams 2, 3, 4 pipeline functions are stubs in orchestrator/adapters/.
 * Replace them when those teams deliver without touching this file.
 */

import crypto from "crypto";
import { runDiscoveryPipeline, DiscoveryPipelineError } from "../agents/discovery/index.js";
import { runArtDirectorQaAgent } from "../agents/qa/artDirectorQaAgent.js";
import { adaptDiscoveryOutput } from "./adapters/discoveryAdapter.js";
import { runDesignAdapter } from "./adapters/designAdapter.js";
import { runComponentAdapter } from "./adapters/componentAdapter.js";
import { runEngineeringAdapter, type EngineeringAdapterOptions } from "./adapters/engineeringAdapter.js";
import { runQaGate } from "./qaGate.js";
import { routeRevision } from "./revisionRouter.js";
import { runRevisionLoop, MAX_REVISION_CYCLES } from "./revisionLoop.js";
import {
  initPipelineStages,
  markStageRunning,
  markStageComplete,
} from "./pipelineState.js";
import {
  buildAgentMetric,
  aggregateMetrics,
  emptyMetrics,
} from "./pipelineMetrics.js";
import type {
  GenerateDesignTemplateInput,
  DesignGenerationResult,
  PipelineStageState,
  PipelineError,
} from "../types/orchestrator.types.js";
import type { PipelineAgentMetric } from "../types/orchestrator.types.js";
import type { DiscoveryTeamOutput } from "../types/discovery.types.js";
import type { DesignTeamOutput, ComponentTeamOutput, EngineeringPipelineOutput } from "../types/orchestrator.types.js";
import type { ArtDirectorQaReport } from "../types/qa.types.js";
import { DEFAULT_MODEL_CONFIG, type AgentModelConfig } from "../types/discovery.types.js";
import { makeModelConfig } from "../types/orchestrator.types.js";
import { logger } from "../../../lib/logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const ORCHESTRATOR_VERSION = "1.0.0";

// ── Implementation ────────────────────────────────────────────────────────────

export async function generateDesignTemplate(
  input: GenerateDesignTemplateInput,
): Promise<DesignGenerationResult> {
  const pipelineRunId = crypto.randomUUID();
  const pipelineStart = Date.now();

  logger.info({ pipelineRunId, tenantId: input.tenantId }, "[orchestrator] Pipeline started");

  let stages: PipelineStageState[] = initPipelineStages();
  const agentMetrics: PipelineAgentMetric[] = [];
  const errors: PipelineError[] = [];

  // ── Build per-agent model config from overrides ───────────────────────────
  function modelFor(agentName: string): AgentModelConfig {
    const override = input.modelOverrides?.[agentName as keyof typeof input.modelOverrides];
    return override ? makeModelConfig(override) : DEFAULT_MODEL_CONFIG;
  }

  // ── STAGE 1–3: Discovery (Team 1) ─────────────────────────────────────────
  let discovery: DiscoveryTeamOutput;
  try {
    stages = markStageRunning(stages, "creative-director");
    stages = markStageRunning(stages, "requirement-analyst");
    stages = markStageRunning(stages, "brand-strategist");

    const raw = await runDiscoveryPipeline({
      userPrompt: input.prompt,
      brandProfile: undefined, // TODO: load from brandProfileId when service exists
      modelConfig: modelFor("creative-director"),
    });
    discovery = adaptDiscoveryOutput(raw);

    stages = markStageComplete(stages, "creative-director", "success");
    stages = markStageComplete(stages, "requirement-analyst", "success");
    stages = markStageComplete(stages, "brand-strategist", "success");
  } catch (err) {
    const isDiscoveryErr = err instanceof DiscoveryPipelineError;
    const msg = isDiscoveryErr
      ? (err as DiscoveryPipelineError).message
      : "Discovery pipeline failed unexpectedly";
    const stage = isDiscoveryErr ? (err as DiscoveryPipelineError).stage : "creative-director";

    stages = markStageComplete(stages, stage as any, "failed", { errorMessage: msg });
    errors.push({ stage: "discovery", code: "pipeline_contract_failed", message: sanitize(msg), retryable: false });

    logger.error({ err, pipelineRunId }, "[orchestrator] Discovery failed");
    return buildFailedResult(pipelineRunId, stages, errors, agentMetrics, pipelineStart);
  }

  // ── STAGE 4–8: Design (Team 2 stub) ──────────────────────────────────────
  let design: DesignTeamOutput;
  try {
    for (const stage of ["layout-architect","composition-designer","typography-designer","color-designer","decoration-designer"] as const) {
      stages = markStageRunning(stages, stage);
    }

    design = await runDesignAdapter(discovery);

    for (const stage of ["layout-architect","composition-designer","typography-designer","color-designer","decoration-designer"] as const) {
      stages = markStageComplete(stages, stage, "success");
    }
  } catch (err) {
    const msg = sanitize(err instanceof Error ? err.message : "Design pipeline failed");
    stages = markStageComplete(stages, "layout-architect", "failed", { errorMessage: msg });
    errors.push({ stage: "design", code: "pipeline_contract_failed", message: msg, retryable: false });
    return buildFailedResult(pipelineRunId, stages, errors, agentMetrics, pipelineStart);
  }

  // ── STAGE 9–11: Components (Team 3 stub) ─────────────────────────────────
  let components: ComponentTeamOutput;
  try {
    for (const stage of ["component-builder","variable-designer","asset-planner"] as const) {
      stages = markStageRunning(stages, stage);
    }

    components = await runComponentAdapter(discovery, design);

    for (const stage of ["component-builder","variable-designer","asset-planner"] as const) {
      stages = markStageComplete(stages, stage, "success");
    }
  } catch (err) {
    const msg = sanitize(err instanceof Error ? err.message : "Component pipeline failed");
    stages = markStageComplete(stages, "component-builder", "failed", { errorMessage: msg });
    errors.push({ stage: "components", code: "pipeline_contract_failed", message: msg, retryable: false });
    return buildFailedResult(pipelineRunId, stages, errors, agentMetrics, pipelineStart);
  }

  // ── STAGE 12–15: Engineering (Team 4 stub) ────────────────────────────────
  let engineering: EngineeringPipelineOutput;
  try {
    for (const stage of ["json-architect","validator-initial","optimizer","validator-final"] as const) {
      stages = markStageRunning(stages, stage);
    }

    const engOpts: EngineeringAdapterOptions = { tenantId: input.tenantId, actorId: input.actorId };
    engineering = await runEngineeringAdapter(discovery, design, components, engOpts);

    for (const stage of ["json-architect","validator-initial","optimizer","validator-final"] as const) {
      stages = markStageComplete(stages, stage, "success");
    }

    if (!engineering.finalValidation.passed) {
      errors.push({
        stage: "engineering",
        code: "engineering_validation_failed",
        message: `Validation errors: ${engineering.finalValidation.errors.join("; ")}`,
        retryable: false,
      });
    }
  } catch (err) {
    const msg = sanitize(err instanceof Error ? err.message : "Engineering pipeline failed");
    stages = markStageComplete(stages, "json-architect", "failed", { errorMessage: msg });
    errors.push({ stage: "engineering", code: "pipeline_contract_failed", message: msg, retryable: false });
    return buildFailedResult(pipelineRunId, stages, errors, agentMetrics, pipelineStart);
  }

  // ── STAGE 16: Art Director QA + Revision Loop ─────────────────────────────
  stages = markStageRunning(stages, "art-director-qa");

  const qaModelConfig = modelFor("art-director-qa");
  const baseQaInput = {
    userPrompt: input.prompt,
    discovery,
    design,
    components,
    engineering,
    modelConfig: qaModelConfig,
  };

  let finalQaReport: ArtDirectorQaReport | null = null;
  let revisionCount = 0;
  let revisionHistory: DesignGenerationResult["revisionHistory"] = [];

  const loopResult = await runRevisionLoop({
    qaInput: baseQaInput,
    onRevisionRequired: async (targetAgent, issueCodes, cycle) => {
      logger.info({ pipelineRunId, cycle, targetAgent, issueCodes },
        "[orchestrator] Revision required — stub reruns stubs only");

      stages = markStageComplete(stages, "art-director-qa", "needs_revision");
      stages = markStageRunning(stages, "revision-router");
      stages = markStageComplete(stages, "revision-router", "success");

      // Re-run engineering pipeline for revision cycle
      const updatedEngineering = await runEngineeringAdapter(discovery, design, components, { tenantId: input.tenantId, actorId: input.actorId });
      stages = markStageRunning(stages, "art-director-qa");

      return { ...baseQaInput, engineering: updatedEngineering };
    },
  });

  finalQaReport = loopResult.finalQaReport;
  revisionCount = loopResult.revisionCount;
  revisionHistory = loopResult.revisionHistory;

  if (loopResult.status === "failed") {
    stages = markStageComplete(stages, "art-director-qa", "failed");
    errors.push({ stage: "qa", code: "qa_rejected", message: "QA agent failed", retryable: false });
    return buildFailedResult(pipelineRunId, stages, errors, agentMetrics, pipelineStart);
  }

  if (loopResult.status === "needs_human_review") {
    stages = markStageComplete(stages, "art-director-qa", "needs_revision");
    stages = markStageComplete(stages, "publish-gate", "needs_revision");
    errors.push({ stage: "qa", code: "revision_exhausted", message: `Revision limit (${MAX_REVISION_CYCLES}) reached. Human review required.`, retryable: false });
  } else {
    stages = markStageComplete(stages, "art-director-qa", "success");
    stages = markStageComplete(stages, "publish-gate", "success");
  }

  // ── Aggregate metrics ──────────────────────────────────────────────────────
  if (finalQaReport) {
    agentMetrics.push(buildAgentMetric({
      metadata: finalQaReport.metadata,
      status: loopResult.status === "ready" ? "success" : "failed",
    }));
  }
  const metrics = aggregateMetrics(agentMetrics);

  logger.info({ pipelineRunId, status: loopResult.status, revisionCount, metrics },
    "[orchestrator] Pipeline complete");

  return {
    status: loopResult.status,
    pipelineRunId,
    revisionCount,
    template: loopResult.status === "ready" ? engineering.optimizedTemplate : undefined,
    discovery,
    design,
    components,
    engineering,
    qa: finalQaReport ?? undefined,
    revisionHistory,
    stages,
    errors,
    metrics,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildFailedResult(
  pipelineRunId: string,
  stages: PipelineStageState[],
  errors: PipelineError[],
  agentMetrics: PipelineAgentMetric[],
  pipelineStart: number,
): DesignGenerationResult {
  return {
    status: "failed",
    pipelineRunId,
    revisionCount: 0,
    revisionHistory: [],
    stages,
    errors,
    metrics: aggregateMetrics(agentMetrics),
  };
}

/** Strip internal details before returning error messages to callers. */
function sanitize(msg: string): string {
  return msg
    .replace(/sk-[A-Za-z0-9-_]{10,}/g, "[REDACTED]")
    .replace(/password=\S+/gi, "password=[REDACTED]")
    .slice(0, 500);
}
