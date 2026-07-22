/**
 * design-quality/aiAdapter.ts — Team 33
 *
 * AI-Assisted Quality Check Adapter.
 *
 * Routes AI checks through the existing aiExecutionService (NOT direct provider
 * calls). This is a narrow local adapter pending Team 31's formal AI execution
 * adapter integration.
 *
 * CONTRACT:
 * - AI findings MUST NOT be presented as absolute facts.
 * - Every AI finding must carry: confidence, reason, evidence, limitation,
 *   modelProvenance, and humanReviewRecommended.
 * - Raw provider payloads are never surfaced.
 *
 * Adapter note: This adapter uses aiModelRouter + aiExecutionService internally.
 * Once Team 31's universal AI execution adapter is available, this file should
 * be updated to delegate to it. Document the pending integration here.
 *
 * @see ai-platform-services-arch.md for the existing aiExecutionService pattern.
 */

import type { DesignQualityCheckRequest, DesignQualityFinding } from "./types.js";

// ── AI adapter result ─────────────────────────────────────────────────────────

export interface AiQualityCheckInput {
  ruleId: string;
  ruleName: string;
  category: DesignQualityFinding["category"];
  severity: DesignQualityFinding["severity"];
  prompt: string;
  /** System context to describe the QA task to the model. */
  systemContext?: string;
  request: DesignQualityCheckRequest;
}

export interface AiQualityCheckOutput {
  /** Whether the AI found a quality issue. */
  hasIssue: boolean;
  /** null when hasIssue is false. */
  finding: DesignQualityFinding | null;
  /** Indicates the AI backend was unreachable or unavailable. */
  unavailable: boolean;
  /** Error detail when unavailable = true. */
  unavailableReason?: string;
}

// ── Lazy import of execution service (avoid circular deps) ────────────────────

async function tryExecuteAI(
  prompt: string,
  systemPrompt: string,
): Promise<{ content: string; modelId?: string; providerSlug?: string } | null> {
  try {
    // Dynamic import to avoid compile-time dependency cycles.
    // The aiModelRouter routes to an appropriate model; we do NOT hard-code any provider.
    // Pending Team 31 universal AI execution adapter — using narrow local adapter.
    const { routeToModel } = await import("../aiModelRouter.js");
    const { executeAI } = await import("../aiExecutionService.js");

    const selection = await routeToModel(prompt);
    if (!selection) return null;

    const output = await executeAI({
      prompt,
      systemPrompt,
      model: selection.model,
      provider: selection.provider,
      temperature: 0.1,   // low temperature for deterministic quality assessment
      maxTokens: 256,
    });

    return {
      content: output.content,
      modelId: (selection.model as Record<string, unknown>)["modelId"] as string | undefined,
      providerSlug: (selection.provider as Record<string, unknown>)["slug"] as string | undefined,
    };
  } catch {
    return null;
  }
}

// ── Main adapter function ─────────────────────────────────────────────────────

/**
 * Run an AI-assisted quality check.
 *
 * Returns an unavailable result if the AI backend is not reachable.
 * The caller must treat AI findings as advisory, not conclusive.
 */
export async function runAiQualityCheck(
  input: AiQualityCheckInput,
): Promise<AiQualityCheckOutput> {
  const { ruleId, ruleName, category, severity, prompt, systemContext, request } = input;

  const systemPrompt =
    systemContext ??
    `You are a design quality auditor. Your task is to check one specific quality rule for a design artifact.
Respond ONLY with valid JSON in this exact format:
{"hasIssue": boolean, "reason": "brief explanation", "confidence": 0.0-1.0, "limitation": "known limitation of this check"}
Do not include any other text.`;

  const aiResult = await tryExecuteAI(prompt, systemPrompt);

  if (!aiResult) {
    return {
      hasIssue: false,
      finding: null,
      unavailable: true,
      unavailableReason: "AI execution service unreachable or no suitable model available",
    };
  }

  // Parse the AI response
  let parsed: { hasIssue?: boolean; reason?: string; confidence?: number; limitation?: string } =
    {};
  try {
    // Extract JSON from the response (model may add surrounding text)
    const jsonMatch = aiResult.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch {
    // If parsing fails, treat as unavailable rather than fabricating a result
    return {
      hasIssue: false,
      finding: null,
      unavailable: true,
      unavailableReason: "AI response could not be parsed as structured JSON",
    };
  }

  if (!parsed.hasIssue) {
    return { hasIssue: false, finding: null, unavailable: false };
  }

  const modelProvenance = [aiResult.providerSlug, aiResult.modelId].filter(Boolean).join("/");
  const confidence = typeof parsed.confidence === "number"
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.5;

  const finding: DesignQualityFinding = {
    ruleId,
    ruleName,
    category,
    severity,
    message: parsed.reason ?? "AI-assisted check found a potential quality issue.",
    aiAssisted: true,
    confidence,
    reason: parsed.reason ?? null,
    limitation:
      parsed.limitation ??
      "AI-assisted findings are probabilistic and may not reflect definitive quality issues. Human review is recommended.",
    modelProvenance: modelProvenance || null,
    humanReviewRecommended: confidence < 0.8,
    evidence: {
      detail: `AI model assessed artifact context for rule "${ruleName}". ` +
        `Confidence: ${(confidence * 100).toFixed(0)}%. ` +
        "This finding is advisory and not a compliance certification.",
    },
  };

  return { hasIssue: true, finding, unavailable: false };
}
