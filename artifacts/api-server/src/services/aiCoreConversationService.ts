import {
  classifyAiCoreChatDispatch,
  type AiCoreChatDispatchKind,
} from "./aiCoreChatIntentService.js";

export type ConversationSource = "text" | "voice" | "whatsapp_voice";
export type ConversationRiskLevel = "READ_ONLY" | "MUTATING" | "CRITICAL";

export interface ConversationContextMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ParsedConversationCommand {
  intent: AiCoreChatDispatchKind;
  commands: string[];
  riskLevel: ConversationRiskLevel;
  requiresApproval: boolean;
  confidence: number;
  ambiguous: boolean;
}

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|private[_ -]?key|client[_ -]?secret|service[_ -]?account[_ -]?secret)\b\s*[:=]\s*["']?[^\s,"']+/gi,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

const AMBIGUOUS_REFERENCE =
  /\b(yang\s+tadi|yang\s+lama|yang\s+itu|itu\s+saja|lanjutkan\s+yang\s+tadi|continue\s+that|the\s+previous\s+one)\b/i;

const CONTEXTUAL_FOLLOW_UP =
  /^(?:cek(?:\s+lagi)?|check(?:\s+again)?|lanjut(?:kan)?|continue|resume|perbaiki|fix|benahi|merge|rerun|ulang(?:i)?|uji(?:\s+lagi)?|test|audit(?:\s+lagi)?|selesaikan|bereskan|next|nextnya\s+apa)$/i;

const EXPLICIT_TARGET =
  /\b(?:CWS-[A-Z0-9-]+|PR\s*#?\s*\d+|pull\s*request\s*#?\s*\d+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|worker\s+(?:satu|dua|tiga|empat|lima|enam|1|2|3|4|5|6))\b/i;

function contextualFollowUp(message: string): boolean {
  const normalized = message.trim().replace(/[.!?…]+$/g, "").trim();
  return CONTEXTUAL_FOLLOW_UP.test(normalized) && !EXPLICIT_TARGET.test(normalized);
}

function distinctStrongTargets(
  context: ConversationContextMessage[],
): { prs: Set<string>; tasks: Set<string> } {
  const prs = new Set<string>();
  const tasks = new Set<string>();
  for (const item of context.slice(-6)) {
    for (const match of item.text.matchAll(/\b(?:PR|pull\s*request)\s*#?\s*(\d+)\b/gi)) {
      const value = match[1];
      if (value) prs.add(value);
    }
    for (const match of item.text.matchAll(/\bCWS-[A-Z0-9-]+\b/gi)) {
      tasks.add(match[0].toUpperCase());
    }
  }
  return { prs, tasks };
}

export function contextualizeConversationCommand(
  message: string,
  context: ConversationContextMessage[] | undefined,
): string {
  const safeMessage = redactConversationText(message).trim();
  const safeContext = sanitizeConversationContext(context);
  if (!contextualFollowUp(safeMessage) || safeContext.length === 0) return safeMessage;

  const recent = safeContext.slice(-4);
  const transcript = recent
    .map((item) => `${item.role === "user" ? "User" : "AI Core"}: ${item.text}`)
    .join("\n");

  return [
    safeMessage,
    "",
    "Recent conversation context for resolving this short follow-up command:",
    transcript,
    "",
    "Apply the command only to the single active target implied by this context. If multiple targets remain plausible, ask for clarification instead of guessing.",
  ].join("\n");
}

const WORKER_MARKER =
  /\bworker\s+(?:satu|dua|tiga|empat|lima|enam|1|2|3|4|5|6)\b/gi;

export function redactConversationText(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      const separator = match.search(/[:=]/);
      if (separator >= 0) return match.slice(0, separator + 1) + " [REDACTED]";
      if (/^Bearer\s+/i.test(match)) return "Bearer [REDACTED]";
      return "[REDACTED]";
    });
  }
  return redacted;
}

export function sanitizeConversationContext(
  context: ConversationContextMessage[] | undefined,
): ConversationContextMessage[] {
  if (!context) return [];
  return context.slice(-12).map((message) => ({
    role: message.role,
    text: redactConversationText(message.text).slice(-5_000),
  }));
}

export function buildConversationPrompt(
  message: string,
  context: ConversationContextMessage[] | undefined,
): string {
  const safeMessage = redactConversationText(message);
  const safeContext = sanitizeConversationContext(context);
  if (safeContext.length === 0) return safeMessage;

  const transcript = safeContext
    .map((item) => `${item.role === "user" ? "User" : "AI Core"}: ${item.text}`)
    .join("\n");

  return [
    "Conversation context (oldest to newest):",
    transcript,
    "",
    "Current user message:",
    safeMessage,
    "",
    "Resolve references from the conversation context. If a reference is still ambiguous, ask a concise clarification instead of guessing.",
  ].join("\n");
}

export function splitParallelWorkerCommands(message: string): string[] {
  const matches = [...message.matchAll(WORKER_MARKER)];
  if (matches.length < 2) return [message.trim()].filter(Boolean);

  const segments: string[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index]?.index ?? 0;
    const end = matches[index + 1]?.index ?? message.length;
    let segment = message.slice(start, end).trim();
    segment = segment.replace(/^(?:dan|lalu|kemudian|serta)\s+/i, "").trim();
    segment = segment.replace(/\s+(?:dan|lalu|kemudian|serta)\s*$/i, "").trim();
    if (segment) segments.push(segment);
  }
  return segments.length >= 2 ? segments : [message.trim()].filter(Boolean);
}

export function parseConversationCommand(
  message: string,
  context: ConversationContextMessage[] | undefined = [],
): ParsedConversationCommand {
  const safeMessage = redactConversationText(message).trim();
  const safeContext = sanitizeConversationContext(context);
  const routingMessage = contextualizeConversationCommand(safeMessage, safeContext);
  const dispatch = classifyAiCoreChatDispatch(routingMessage);
  const commands = splitParallelWorkerCommands(safeMessage);
  const targets = distinctStrongTargets(safeContext);
  const contextualAmbiguity =
    contextualFollowUp(safeMessage) &&
    (
      safeContext.length === 0 ||
      targets.prs.size > 1 ||
      targets.tasks.size > 1
    );
  const ambiguous =
    (AMBIGUOUS_REFERENCE.test(safeMessage) && safeContext.length === 0) ||
    contextualAmbiguity;

  const riskLevel: ConversationRiskLevel =
    dispatch.workload.requiresApproval
      ? "CRITICAL"
      : dispatch.workload.requiresAgent || dispatch.kind === "INFRA_OPERATION"
        ? "MUTATING"
        : "READ_ONLY";

  let confidence = ambiguous ? 0.45 : 0.92;
  if (commands.length > 1) confidence = Math.min(confidence, 0.9);
  if (safeMessage.length < 3) confidence = Math.min(confidence, 0.4);

  return {
    intent: dispatch.kind,
    commands,
    riskLevel,
    requiresApproval: dispatch.workload.requiresApproval,
    confidence,
    ambiguous,
  };
}
