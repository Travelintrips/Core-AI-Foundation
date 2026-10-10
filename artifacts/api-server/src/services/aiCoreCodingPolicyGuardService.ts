import {
  classifyAiCoreChatDispatch,
  hasExplicitSourceChange,
} from "./aiCoreChatIntentService.js";

/**
 * AI Core Chat is not an authorized coding executor. Enforce this before LLM,
 * external agent, control-plane, or worker dispatch — regardless of worker availability.
 * Read-only review/build/test checks and explicit GitHub operational controls
 * are not re-labelled as source-changing coding.
 */
export function isAiCoreCodingCommandBlocked(message: string): boolean {
  const withoutAt = message.trim().replace(/^@\s*/, "");
  const directPcCommand = /^#\s*/.test(withoutAt);
  const normalized = withoutAt.replace(/^#\s*/, "");
  if (!normalized) return false;
  // OpenClaw PC file commands can edit/delete ordinary user documents.
  // A file name alone (e.g. Downloads/data.csv) is not source-code coding.
  if (
    directPcCommand &&
    !/\b(?:kode|code|coding|source|repository|repo|typescript|javascript|python|backend|frontend|endpoint|function|fungsi|module|modul|api|bug|refactor)\b|\.(?:tsx?|jsx?|py|go|rs|java|cs|cpp|c|h|php)\b|(?:src|services|artifacts|lib|routes)\//i.test(normalized)
  ) {
    return false;
  }
  const decision = classifyAiCoreChatDispatch(normalized);
  return (
    hasExplicitSourceChange(normalized) ||
    decision.kind === "GITHUB_DIRECT_REQUIRED" ||
    (decision.kind === "CONTROL_PLANE" &&
      decision.workload.workload === "CODING")
  );
}

export function aiCoreCodingDeniedResponse(): Record<string, unknown> {
  return {
    kind: "routing_guard",
    route: "POLICY_DENIED",
    executionLane: "POLICY_BLOCKED",
    provider: null,
    model: null,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    estimatedCostUsd: 0,
    blocked: true,
    reason: "coding_not_permitted",
    reply:
      "Saya tidak diperbolehkan menjalankan perintah coding melalui AI Core. " +
      "Perubahan kode harus dilakukan melalui ChatGPT menggunakan GitHub sesuai izin yang berlaku.",
  };
}
