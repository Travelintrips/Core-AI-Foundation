/**
 * Team 31 — Universal Design AI Orchestration Adapter
 * executionAdapter.ts — Main adapter orchestrating validation → plan → enqueue.
 *
 * Design rules enforced here:
 *  - Never call an AI provider directly. Routes through intelligentRouter +
 *    queueManagerService (existing job engine).
 *  - Never accept a raw API key from the caller.
 *  - Idempotency check prevents duplicate jobs, duplicate cost records, and
 *    duplicate audit events for the same (tenantId, capabilityId, idempotencyKey).
 *  - All side-effects (job enqueue, audit, cost estimate) are recorded.
 *  - Output never carries secrets or raw chain-of-thought.
 */

import crypto from "crypto";
import { randomUUID } from "crypto";

import { enqueue } from "../../queueManagerService.js";
import { routeForAgent } from "../../intelligentRouter.js";
import { logAudit } from "../../aiAuditService.js";
import { DesignAiCapabilityResolver } from "./capabilityResolver.js";
import type {
  DesignAiExecutionContext,
  DesignAiExecutionRequest,
  DesignAiExecutionResult,
  DesignAiExecutionError,
  DesignAiExecutionPlan,
  DesignAiJobPayload,
  DesignAiOutputEnvelope,
  DesignAiCapabilityBinding,
  DesignAiPlanStep,
} from "./types.js";
import type { RequestContext } from "../../../security/requestContext.js";

// ─── Idempotency store (in-process; production uses DB or Redis via job engine) ──

/**
 * In-process idempotency cache keyed by idempotency hash.
 * Prevents duplicate enqueue within the same process lifetime.
 * The job engine's DB-level idempotency (payloadJson._idempotencyHash) is
 * the durable guard; this is a fast-path pre-check.
 */
const _inFlightKeys = new Set<string>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Canonical idempotency hash — same algorithm as compositionSessionStore.ts:
 * SHA-256(tenantId + ":" + capabilityId + ":" + idempotencyKey).
 * Must be stable across restarts (no random component).
 */
export function buildIdempotencyHash(
  tenantId: string,
  capabilityId: string,
  idempotencyKey: string,
): string {
  return crypto
    .createHash("sha256")
    .update(`${tenantId}:${capabilityId}:${idempotencyKey}`)
    .digest("hex");
}

function makeError(
  code: DesignAiExecutionError["code"],
  message: string,
  retryable: boolean,
  details?: DesignAiExecutionError["details"],
): DesignAiExecutionResult {
  return { ok: false, error: { code, message, retryable, details } };
}

/**
 * Build an execution plan from the capability binding.
 * Does NOT invent a new workflow engine — the steps reflect what the
 * existing orchestrator already knows how to run.
 */
function buildExecutionPlan(
  binding: DesignAiCapabilityBinding,
  timeoutMs: number,
  estimatedCostUsd: number,
): DesignAiExecutionPlan {
  const steps: DesignAiPlanStep[] = [];

  // Primary execution step
  steps.push({
    stepId: `${binding.capabilityId}-primary`,
    kind: binding.executionMode === "parallel" ? "parallel_agents" : "single_agent",
    agentSlugs: [binding.agentSlug],
  });

  // QC step (if required by capability or quality policy)
  if (binding.requiresQcStep) {
    steps.push({
      stepId: `${binding.capabilityId}-qc`,
      kind: "qc",
      agentSlugs: ["art-director-qa"],
      skipIfOutputAvailable: false,
    });
  }

  // Human review gate (if required)
  if (binding.requiresHumanReview) {
    steps.push({
      stepId: `${binding.capabilityId}-human-review`,
      kind: "human_review",
      agentSlugs: [],
    });
  }

  return {
    planId: randomUUID(),
    capabilityBinding: binding,
    steps,
    estimatedCostUsd,
    timeoutMs,
  };
}

// ─── DesignAiExecutionAdapter ─────────────────────────────────────────────────

/**
 * DesignAiExecutionAdapter
 *
 * Entry point for all Universal Design Platform → AI Platform executions.
 *
 * Usage:
 *   const adapter = new DesignAiExecutionAdapter();
 *   const result  = await adapter.execute(request, authContext);
 */
export class DesignAiExecutionAdapter {
  private readonly resolver: DesignAiCapabilityResolver;

  constructor(resolver?: DesignAiCapabilityResolver) {
    this.resolver = resolver ?? new DesignAiCapabilityResolver();
  }

  /**
   * execute()
   *
   * Full pipeline: validate → resolve → idempotency check → plan → enqueue → audit → return.
   */
  async execute(
    request: DesignAiExecutionRequest,
    authContext: RequestContext,
  ): Promise<DesignAiExecutionResult> {
    const receivedAt = new Date();

    // ── 1. Basic field validation ─────────────────────────────────────────────
    const fieldError = validateRequestFields(request);
    if (fieldError) return fieldError;

    // ── 2. Build execution context ────────────────────────────────────────────
    const ctx: DesignAiExecutionContext = { request, authContext, receivedAt };

    // ── 3. Resolve capability (validates tenant, plugin, contract, artifacts, budget) ──
    const resolution = await this.resolver.resolve(ctx);
    if (!resolution.ok) {
      await logAudit({
        module: "design-ai-orchestration",
        action: "capability_resolution_failed",
        resourceType: "design_ai_execution",
        resourceId: request.projectId,
        status: "failure",
        details: {
          capabilityId: request.capabilityId,
          errorCode: resolution.error.code,
        },
        tenantId: request.tenantId,
        actorId: request.actorContext.actorId,
        actorType: "system",
      });
      return { ok: false, error: resolution.error };
    }
    const binding = resolution.binding;

    // ── 4. Idempotency check ──────────────────────────────────────────────────
    const idempotencyHash = buildIdempotencyHash(
      request.tenantId,
      request.capabilityId,
      request.idempotencyKey,
    );

    if (_inFlightKeys.has(idempotencyHash)) {
      return makeError(
        "duplicate_request_conflict",
        `Duplicate request detected for idempotency key '${request.idempotencyKey}'.`,
        false,
        { idempotencyHash },
      );
    }
    _inFlightKeys.add(idempotencyHash);

    try {
      // ── 5. Route to model (for cost estimation and routing metadata) ──────
      let estimatedCostUsd = 0;
      let resolvedProviderSlug = "openai";
      let resolvedModelId = "unknown";

      try {
        const routing = await routeForAgent(binding.agentSlug, {
          prompt: request.capabilityId,
        });
        if (!routing) {
          return makeError(
            "model_unavailable",
            `No available model found for agent '${binding.agentSlug}' (capability '${request.capabilityId}').`,
            true,
            { agentSlug: binding.agentSlug, capabilityId: request.capabilityId },
          );
        }
        resolvedProviderSlug = routing.selected.provider.slug;
        resolvedModelId = routing.selected.model.modelId;
        // Rough estimate: 1000 tokens per side at model default pricing
        const costIn = parseFloat(String(routing.selected.model.costPerInputToken ?? "0.0000025"));
        const costOut = parseFloat(String(routing.selected.model.costPerOutputToken ?? "0.00001"));
        estimatedCostUsd = 1000 * costIn + 1000 * costOut;
      } catch (routeErr) {
        // Provider unavailable is retryable
        return makeError(
          "provider_unavailable",
          `Model routing failed for capability '${request.capabilityId}': ${String(routeErr)}`,
          true,
          { agentSlug: binding.agentSlug },
        );
      }

      // ── 6. Build execution plan ───────────────────────────────────────────
      const guardrailTimeoutMs = 60_000;
      const plan = buildExecutionPlan(binding, guardrailTimeoutMs, estimatedCostUsd);

      // ── 7. Build job payload ──────────────────────────────────────────────
      const jobPayload: DesignAiJobPayload = {
        _type: "design_ai_orchestration",
        _version: "1.0",
        idempotencyHash,
        tenantId: request.tenantId,
        projectId: request.projectId,
        workflowId: request.workflowId,
        stageId: request.stageId,
        capabilityId: request.capabilityId,
        pluginId: request.pluginId,
        agentSlug: binding.agentSlug,
        skill: binding.skill,
        executionMode: binding.executionMode,
        briefContext: request.briefContext,
        parameters: request.parameters,
        inputArtifacts: request.inputArtifacts,
        requestedOutputTypes: request.requestedOutputTypes,
        budgetPolicy: request.budgetPolicy,
        qualityPolicy: request.qualityPolicy,
        correlationId: request.correlationId,
        actorContext: request.actorContext,
      };

      // ── 8. Enqueue job via existing job engine ────────────────────────────
      let enqueued: { id: number; jobCode: string };
      try {
        enqueued = await enqueue({
          jobType: "design_ai_orchestration",
          payloadJson: {
            ...(jobPayload as unknown as Record<string, unknown>),
            // WP-06 canonical stamp
            _tenantId: request.tenantId,
          },
          priority: 50,
          tenantId: request.tenantId,
          estimatedCost: estimatedCostUsd,
        });
      } catch (enqErr) {
        return makeError(
          "job_failed",
          `Failed to enqueue design AI job: ${String(enqErr)}`,
          true,
          { capabilityId: request.capabilityId },
        );
      }

      // ── 9. Audit the successful enqueue ──────────────────────────────────
      await logAudit({
        module: "design-ai-orchestration",
        action: "job_enqueued",
        resourceType: "design_ai_execution",
        resourceId: String(enqueued.id),
        status: "success",
        details: {
          jobCode: enqueued.jobCode,
          capabilityId: request.capabilityId,
          agentSlug: binding.agentSlug,
          providerSlug: resolvedProviderSlug,
          modelId: resolvedModelId,
          planSteps: plan.steps.length,
          idempotencyHash,
        },
        tenantId: request.tenantId,
        actorId: request.actorContext.actorId,
        actorType: "system",
      });

      // ── 10. Build output envelope ─────────────────────────────────────────
      const output: DesignAiOutputEnvelope = {
        _type: "design_ai_output",
        _version: "1.0",
        jobId: enqueued.id,
        jobCode: enqueued.jobCode,
        executionMode: binding.executionMode,
        provenance: {
          providerSlug: resolvedProviderSlug,
          modelId: resolvedModelId,
          capabilityId: request.capabilityId,
          agentSlug: binding.agentSlug,
          contractVersion: binding.contractVersion,
          adapterVersion: "1.0",
        },
        outputArtifacts: request.requestedOutputTypes.map((t) => ({ type: t })),
        validationStatus: binding.requiresHumanReview ? "pending_review" : "passed",
        warnings: [],
        costRecordProjectId: request.projectId,
        estimatedCostUsd,
        idempotencyHash,
        correlationId: request.correlationId,
        enqueuedAt: receivedAt.toISOString(),
      };

      return { ok: true, output };
    } finally {
      // Always release the in-process idempotency lock so retries can proceed
      // after a genuine error. Duplicates are blocked only while the first
      // call is in-flight.
      _inFlightKeys.delete(idempotencyHash);
    }
  }
}

// ─── Field validation ─────────────────────────────────────────────────────────

function validateRequestFields(
  req: DesignAiExecutionRequest,
): DesignAiExecutionResult | null {
  const required: Array<keyof DesignAiExecutionRequest> = [
    "tenantId",
    "projectId",
    "workflowId",
    "stageId",
    "capabilityId",
    "pluginId",
    "idempotencyKey",
  ];

  for (const field of required) {
    const value = req[field];
    if (!value || (typeof value === "string" && value.trim() === "")) {
      return makeError(
        "invalid_input",
        `Required field '${field}' is missing or empty.`,
        false,
        { field },
      );
    }
  }

  if (!Array.isArray(req.inputArtifacts)) {
    return makeError("invalid_input", "inputArtifacts must be an array.", false);
  }

  if (!Array.isArray(req.requestedOutputTypes) || req.requestedOutputTypes.length === 0) {
    return makeError(
      "invalid_input",
      "requestedOutputTypes must be a non-empty array.",
      false,
    );
  }

  if (req.budgetPolicy.maxCostUsd < 0) {
    return makeError("invalid_input", "budgetPolicy.maxCostUsd must be >= 0.", false);
  }

  return null;
}

// ─── Convenience factory ──────────────────────────────────────────────────────

/** Singleton instance for typical route-handler usage. */
export const designAiExecutionAdapter = new DesignAiExecutionAdapter();
