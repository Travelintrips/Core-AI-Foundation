export interface AiCoreTrustedExecutionHandoff {
  source: "chatgpt" | "operator" | "automation";
  action: string;
  scope: string | null;
  verifiedSha: string | null;
  analysisComplete: boolean;
  sourceVerified: boolean;
}

const BLOCK = /\[AI_CORE_HANDOFF\]([\s\S]*?)\[\/AI_CORE_HANDOFF\]/i;

export function parseAiCoreTrustedExecutionHandoff(
  message: string,
): AiCoreTrustedExecutionHandoff | null {
  const match = message.match(BLOCK);
  if (!match) return null;
  const values = new Map<string, string>();
  for (const rawLine of match[1]!.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    values.set(
      line.slice(0, separator).trim().toLowerCase(),
      line.slice(separator + 1).trim(),
    );
  }
  const sourceRaw = (values.get("source") ?? "").toLowerCase();
  if (!["chatgpt", "operator", "automation"].includes(sourceRaw)) return null;
  const action = values.get("action")?.trim() ?? "";
  if (!action) return null;
  const sha = values.get("verified_sha")?.trim().toLowerCase() ?? "";
  return {
    source: sourceRaw as AiCoreTrustedExecutionHandoff["source"],
    action,
    scope: values.get("scope")?.trim() || null,
    verifiedSha: /^[0-9a-f]{40}$/.test(sha) ? sha : null,
    analysisComplete: /^(?:1|true|yes)$/i.test(values.get("analysis_complete") ?? ""),
    sourceVerified: /^(?:1|true|yes)$/i.test(values.get("source_verified") ?? ""),
  };
}

export function stripAiCoreTrustedExecutionHandoff(message: string): string {
  return message.replace(BLOCK, " ").replace(/\s+/g, " ").trim();
}
