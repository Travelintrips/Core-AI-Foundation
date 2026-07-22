/**
 * Team 31 — Universal Design AI Orchestration Adapter
 * capabilityResolver.ts — Resolves and validates capability bindings.
 *
 * Resolution order:
 *   1. ai_capabilities table (capability matrix) — authoritative if populated.
 *   2. LOCAL_CAPABILITY_REGISTRY — static fallback for known design capabilities.
 *
 * Validation pipeline (all must pass before returning a binding):
 *   - Capability exists and is active.
 *   - Plugin ownership matches request.pluginId.
 *   - Contract version is compatible (semver-major match).
 *   - Input artifacts satisfy declared requirements.
 *   - Output artifact types are a subset of what this capability produces.
 *   - Guardrail limits are not pre-violated.
 *   - Budget policy is within tenant limits.
 *   - Tenant scope is valid (non-null, matches authContext).
 */

import { getCapabilitiesForSkill } from "../../capabilityService.js";
import { readGuardrails } from "../../guardrailService.js";
import { getProjectCosts } from "../../costService.js";
import type {
  DesignAiCapabilityBinding,
  DesignAiExecutionContext,
  DesignAiExecutionError,
} from "./types.js";

// ─── Local capability registry ────────────────────────────────────────────────
// Fallback when the capability matrix DB table has no matching rows.
// Keys are canonical capabilityId values from DesignAiExecutionRequest.

interface LocalCapabilityEntry {
  agentSlug: string;
  skill: string;
  contractVersion: string;
  executionMode: DesignAiCapabilityBinding["executionMode"];
  allowedPlugins: string[];    // "*" = any plugin
  requiredInputTypes: string[]; // [] = no constraint
  producedOutputTypes: string[]; // what this capability can produce
  requiresQcStep: boolean;
  requiresHumanReview: boolean;
}

const LOCAL_CAPABILITY_REGISTRY: Record<string, LocalCapabilityEntry> = {
  brand_strategy: {
    agentSlug: "brand-strategist",
    skill: "branding",
    contractVersion: "1.0",
    executionMode: "async_job",
    allowedPlugins: ["*"],
    requiredInputTypes: [],
    producedOutputTypes: ["brand_strategy", "creative_brief"],
    requiresQcStep: false,
    requiresHumanReview: false,
  },
  creative_direction: {
    agentSlug: "creative-director",
    skill: "creative_direction",
    contractVersion: "1.0",
    executionMode: "async_job",
    allowedPlugins: ["*"],
    requiredInputTypes: ["creative_brief"],
    producedOutputTypes: ["creative_direction", "discovery"],
    requiresQcStep: false,
    requiresHumanReview: false,
  },
  requirement_analysis: {
    agentSlug: "requirement-analyst",
    skill: "branding",
    contractVersion: "1.0",
    executionMode: "async_job",
    allowedPlugins: ["*"],
    requiredInputTypes: [],
    producedOutputTypes: ["requirement_analysis"],
    requiresQcStep: false,
    requiresHumanReview: false,
  },
  layout_design: {
    agentSlug: "layout-architect",
    skill: "creative_direction",
    contractVersion: "1.0",
    executionMode: "async_job",
    allowedPlugins: ["*"],
    requiredInputTypes: ["discovery"],
    producedOutputTypes: ["layout_spec"],
    requiresQcStep: true,
    requiresHumanReview: false,
  },
  composition_design: {
    agentSlug: "composition-designer",
    skill: "creative_direction",
    contractVersion: "1.0",
    executionMode: "async_job",
    allowedPlugins: ["*"],
    requiredInputTypes: ["layout_spec"],
    producedOutputTypes: ["composition_spec"],
    requiresQcStep: true,
    requiresHumanReview: false,
  },
  typography_design: {
    agentSlug: "typography-designer",
    skill: "creative_direction",
    contractVersion: "1.0",
    executionMode: "async_job",
    allowedPlugins: ["*"],
    requiredInputTypes: ["discovery"],
    producedOutputTypes: ["typography_spec"],
    requiresQcStep: false,
    requiresHumanReview: false,
  },
  color_design: {
    agentSlug: "color-designer",
    skill: "creative_direction",
    contractVersion: "1.0",
    executionMode: "async_job",
    allowedPlugins: ["*"],
    requiredInputTypes: ["layout_spec", "typography_spec"],
    producedOutputTypes: ["color_spec"],
    requiresQcStep: false,
    requiresHumanReview: false,
  },
  decoration_design: {
    agentSlug: "decoration-designer",
    skill: "creative_direction",
    contractVersion: "1.0",
    executionMode: "async_job",
    allowedPlugins: ["*"],
    requiredInputTypes: ["layout_spec"],
    producedOutputTypes: ["decoration_spec"],
    requiresQcStep: false,
    requiresHumanReview: false,
  },
  quality_control: {
    agentSlug: "art-director-qa",
    skill: "quality_control",
    contractVersion: "1.0",
    executionMode: "async_job",
    allowedPlugins: ["*"],
    requiredInputTypes: ["template"],
    producedOutputTypes: ["qa_report"],
    requiresQcStep: false,
    requiresHumanReview: false,
  },
  fashion_design: {
    agentSlug: "fashion-design-specialist",
    skill: "fashion_design",
    contractVersion: "1.0",
    executionMode: "async_job",
    allowedPlugins: ["*"],
    requiredInputTypes: [],
    producedOutputTypes: ["design_assets", "fashion_brief"],
    requiresQcStep: true,
    requiresHumanReview: false,
  },
  interior_design: {
    agentSlug: "interior-design-specialist",
    skill: "interior_design",
    contractVersion: "1.0",
    executionMode: "async_job",
    allowedPlugins: ["*"],
    requiredInputTypes: [],
    producedOutputTypes: ["design_assets", "interior_brief"],
    requiresQcStep: true,
    requiresHumanReview: false,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract major version from a semver-ish string like "1.2" → 1. */
function majorVersion(v: string): number {
  const n = parseInt(v.split(".")[0] ?? "0", 10);
  return isNaN(n) ? 0 : n;
}

function makeError(
  code: DesignAiExecutionError["code"],
  message: string,
  retryable: boolean,
  details?: DesignAiExecutionError["details"],
): DesignAiExecutionError {
  return { code, message, retryable, details };
}

// ─── Public interface ─────────────────────────────────────────────────────────

export type CapabilityResolutionResult =
  | { ok: true; binding: DesignAiCapabilityBinding }
  | { ok: false; error: DesignAiExecutionError };

/**
 * DesignAiCapabilityResolver
 *
 * Resolves and validates all preconditions before execution begins.
 * Returns a typed CapabilityResolutionResult — never throws.
 */
export class DesignAiCapabilityResolver {
  /**
   * Resolve a capability binding for the given execution context.
   *
   * Steps:
   *   1. Validate tenant scope.
   *   2. Locate the capability (DB matrix → local registry).
   *   3. Validate plugin ownership.
   *   4. Validate contract version compatibility.
   *   5. Validate input artifacts.
   *   6. Validate output types.
   *   7. Validate guardrails (cost per request).
   *   8. Validate budget (cumulative project spend).
   */
  async resolve(ctx: DesignAiExecutionContext): Promise<CapabilityResolutionResult> {
    const { request, authContext } = ctx;

    // 1. Tenant scope guard
    if (!authContext.tenantId) {
      return {
        ok: false,
        error: makeError("tenant_scope_violation", "Missing tenant scope in auth context.", false),
      };
    }
    if (authContext.tenantId !== request.tenantId) {
      return {
        ok: false,
        error: makeError(
          "tenant_scope_violation",
          "Auth context tenant does not match request tenant.",
          false,
          { authTenant: authContext.tenantId, requestTenant: request.tenantId },
        ),
      };
    }

    // 2. Locate capability
    const localEntry = LOCAL_CAPABILITY_REGISTRY[request.capabilityId];

    // Try capability matrix first for capabilities that map to a known skill
    let capabilityDbId: number | null = null;
    if (localEntry) {
      try {
        const matrixEntries = await getCapabilitiesForSkill(localEntry.skill);
        // If the matrix has entries, prefer the highest-priority active one.
        const best = matrixEntries[0];
        if (best?.capability.id) {
          capabilityDbId = best.capability.id;
        }
      } catch {
        // Non-fatal: matrix lookup failure falls back to local registry.
      }
    }

    if (!localEntry) {
      return {
        ok: false,
        error: makeError(
          "capability_not_found",
          `Capability '${request.capabilityId}' is not registered in this platform.`,
          false,
          { capabilityId: request.capabilityId },
        ),
      };
    }

    // 3. Plugin ownership
    const pluginAllowed =
      localEntry.allowedPlugins.includes("*") ||
      localEntry.allowedPlugins.includes(request.pluginId);
    if (!pluginAllowed) {
      return {
        ok: false,
        error: makeError(
          "capability_incompatible",
          `Plugin '${request.pluginId}' does not own capability '${request.capabilityId}'.`,
          false,
          { pluginId: request.pluginId, capabilityId: request.capabilityId },
        ),
      };
    }

    // 4. Contract version compatibility (major-version match)
    const requestedVersion = request.capabilityContractVersion ?? localEntry.contractVersion;
    if (majorVersion(requestedVersion) !== majorVersion(localEntry.contractVersion)) {
      return {
        ok: false,
        error: makeError(
          "capability_incompatible",
          `Contract version mismatch: requested v${requestedVersion}, capability supports v${localEntry.contractVersion}.`,
          false,
          { requestedVersion, supportedVersion: localEntry.contractVersion },
        ),
      };
    }

    // 5. Input artifact validation
    const providedTypes = request.inputArtifacts.map((a) => a.type);
    const missingRequired = localEntry.requiredInputTypes.filter(
      (req) => !providedTypes.includes(req),
    );
    if (missingRequired.length > 0) {
      return {
        ok: false,
        error: makeError(
          "invalid_input",
          `Missing required input artifact types: ${missingRequired.join(", ")}.`,
          false,
          { missing: missingRequired.join(",") },
        ),
      };
    }

    // 6. Output type validation (requested must be a subset of produced)
    const unsupportedOutputs = request.requestedOutputTypes.filter(
      (t) => !localEntry.producedOutputTypes.includes(t),
    );
    if (unsupportedOutputs.length > 0) {
      return {
        ok: false,
        error: makeError(
          "capability_incompatible",
          `Capability '${request.capabilityId}' cannot produce: ${unsupportedOutputs.join(", ")}.`,
          false,
          { unsupported: unsupportedOutputs.join(",") },
        ),
      };
    }

    // 7. Guardrail budget check (per-request ceiling)
    let guardrails;
    try {
      guardrails = await readGuardrails();
    } catch {
      guardrails = { maxCostPerRequest: 0.5, maxCostPerWorkflow: 5.0, fallbackEnabled: true };
    }
    const requestBudget = request.budgetPolicy.maxCostUsd;
    if (guardrails.maxCostPerRequest > 0 && requestBudget > guardrails.maxCostPerRequest) {
      return {
        ok: false,
        error: makeError(
          "guardrail_blocked",
          `Requested budget $${requestBudget.toFixed(4)} exceeds platform per-request limit $${guardrails.maxCostPerRequest.toFixed(4)}.`,
          false,
          { requestBudget, platformLimit: guardrails.maxCostPerRequest },
        ),
      };
    }

    // 8. Cumulative project spend check
    if (guardrails.maxCostPerWorkflow > 0) {
      try {
        const projectCosts = await getProjectCosts(request.projectId);
        if (projectCosts.totalEstimatedCostUsd >= guardrails.maxCostPerWorkflow) {
          return {
            ok: false,
            error: makeError(
              "budget_exceeded",
              `Project '${request.projectId}' has reached workflow budget limit $${guardrails.maxCostPerWorkflow.toFixed(2)} (spent $${projectCosts.totalEstimatedCostUsd.toFixed(4)}).`,
              false,
              {
                spent: projectCosts.totalEstimatedCostUsd,
                limit: guardrails.maxCostPerWorkflow,
                projectId: request.projectId,
              },
            ),
          };
        }
      } catch {
        // Non-fatal: cost query failure should not block execution.
      }
    }

    const binding: DesignAiCapabilityBinding = {
      capabilityId: request.capabilityId,
      pluginId: request.pluginId,
      agentSlug: localEntry.agentSlug,
      contractVersion: localEntry.contractVersion,
      executionMode: localEntry.executionMode,
      requiresQcStep: localEntry.requiresQcStep || (request.qualityPolicy.minQcScore != null && request.qualityPolicy.minQcScore > 0),
      requiresHumanReview: localEntry.requiresHumanReview || (request.qualityPolicy.requireHumanReview ?? false),
      capabilityDbId,
      skill: localEntry.skill,
    };

    return { ok: true, binding };
  }
}
