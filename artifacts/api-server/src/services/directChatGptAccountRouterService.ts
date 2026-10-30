import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  dispatchExternalAgentWork,
  ExternalAgentDispatchError,
} from "./externalAgentDispatchService.js";
import { getExternalAgentRegistrySnapshot } from "./externalAgentRegistryService.js";
import {
  queueDevBrowserWake,
  resolveVerifiedDevWakeTarget,
  type DevWakeTarget,
} from "./devChatGptWakeService.js";

export const DIRECT_CHATGPT_ACCOUNT_BINDINGS = {
  travelincars: {
    key: "travelincars",
    workerId: "openclaw-pc-worker-dev",
    browserProfile: "travelincars-dev",
    conversationId: "6ad74b05-0580-83ec-956a-80aaf4587985",
  },
  personal: {
    key: "personal",
    workerId: "openclaw-pc-worker-2",
    browserProfile: "admcst001-dev",
    conversationId: "6ad87510-6dd8-83ec-a064-14e4a3438d46",
  },
} as const;

type DirectChatGptAccountKey = keyof typeof DIRECT_CHATGPT_ACCOUNT_BINDINGS;
export type DirectChatGptTarget = DirectChatGptAccountKey | "auto" | "both";

export type DirectChatGptAccountRequest = {
  target: DirectChatGptTarget;
  instruction: string;
};

export type DirectChatContextMessage = {
  role: "user" | "assistant";
  text: string;
};

function stripRoutingPrefix(message: string): string {
  return message
    .replace(/^\s*(?:pakai|gunakan|gunakanlah|kirim(?:kan)?|delegasikan|route|rutekan|kerjakan|jalankan|bagi)\s+/i, "")
    .replace(/^\s*(?:ke|dengan|melalui|via)\s+/i, "")
    .replace(/^\s*(?:dua|kedua|2)\s+akun(?:\s+chatgpt)?\s*[:,-]?\s*/i, "")
    .replace(/^\s*(?:akun\s+)?(?:personal|admcst001)(?:-dev)?(?:\s+chatgpt)?\s*[:,-]?\s*/i, "")
    .replace(/^\s*(?:akun\s+)?(?:travelincars?|percobaan)(?:-dev)?(?:\s+chatgpt)?\s*[:,-]?\s*/i, "")
    .replace(/^\s*(?:chatgpt|akun\s+otomatis|salah\s+satu\s+akun)(?:\s+dev)?\s*[:,-]?\s*/i, "")
    .replace(/^\s*(?:untuk|agar|supaya)\s+/i, "")
    .trim();
}

export function parseDirectChatGptAccountTarget(message: string): DirectChatGptTarget | null {
  const text = message.trim().replace(/^@\s*/, "");
  if (!text) return null;
  if (/\b(?:dua|kedua|2)\s+akun(?:\s+chatgpt)?\b/i.test(text)) return "both";
  if (/\b(?:akun\s+)?(?:personal|admcst001)(?:-dev)?\b/i.test(text)) return "personal";
  if (/\b(?:akun\s+)?(?:travelincars?|percobaan)(?:-dev)?\b/i.test(text)) return "travelincars";
  if (/\b(?:chatgpt|akun\s+otomatis|salah\s+satu\s+akun)\b/i.test(text)) return "auto";
  return null;
}

export function isDirectChatGptAccountReset(message: string): boolean {
  return /^@?\s*(?:lepas|reset|hapus|putus)(?:kan)?\s+(?:binding\s+)?akun(?:\s+chatgpt)?\s*[.!]?\s*$/i.test(message.trim());
}

export function resolveDirectChatGptAccountTargetFromContext(
  context: DirectChatContextMessage[] | undefined,
): DirectChatGptTarget | null {
  if (!context?.length) return null;
  for (let index = context.length - 1; index >= 0; index -= 1) {
    const item = context[index];
    if (!item || item.role !== "user") continue;
    if (isDirectChatGptAccountReset(item.text)) return null;
    const target = parseDirectChatGptAccountTarget(item.text);
    if (target) return target;
  }
  return null;
}

export function parseDirectChatGptAccountRequest(
  message: string,
): DirectChatGptAccountRequest | null {
  const text = message.trim().replace(/^@\s*/, "");
  if (!text) return null;

  const hasAction = /\b(?:pakai|gunakan|kirim(?:kan)?|delegasikan|route|rutekan|kerjakan|jalankan|bagi)\b/i.test(text);
  const explicitPrefix = /^\s*(?:chatgpt|akun\s+(?:personal|travelincars?|percobaan|otomatis)|(?:dua|kedua|2)\s+akun)\s*:/i.test(text);
  if (!hasAction && !explicitPrefix) return null;

  const target = parseDirectChatGptAccountTarget(text);
  if (!target) return null;

  const instruction = stripRoutingPrefix(text).replace(/^\s*(?:ya|iya|yes|ok|oke)\s*[,.!?-]*\s*/i, "").trim();
  if (instruction.length < 3) return null;
  return { target, instruction };
}

function assertDevRuntime(): void {
  if (process.env["NODE_ENV"]?.trim().toLowerCase() === "production") {
    throw new ExternalAgentDispatchError(
      "CAPABILITY_DENIED",
      "DIRECT_CHATGPT_ACCOUNT_ROUTER_DEV_ONLY: direct multi-account ChatGPT routing is disabled in production.",
    );
  }
}

async function activeJobCounts(): Promise<Map<string, number>> {
  const result = await db.execute<{
    client_id: string;
    active_jobs: number | string;
  }>(sql`
    SELECT
      metadata_json ->> 'assignedClientId' AS client_id,
      COUNT(*)::int AS active_jobs
    FROM ai_platform.ai_coding_bridge_commands
    WHERE status IN ('RECEIVED', 'PROCESSING')
      AND metadata_json ->> 'assignedClientId' IS NOT NULL
    GROUP BY metadata_json ->> 'assignedClientId'
  `);
  const counts = new Map<string, number>();
  for (const row of result.rows ?? []) {
    counts.set(String(row.client_id), Number(row.active_jobs) || 0);
  }
  return counts;
}

function buildEncodedInstruction(
  binding: (typeof DIRECT_CHATGPT_ACCOUNT_BINDINGS)[DirectChatGptAccountKey],
  instruction: string,
): { encodedInstruction: string; jobId: string } {
  const jobId = `aicore-${binding.key}-${randomUUID()}`;
  const payload = {
    mode: "chatgpt_continue",
    jobId,
    conversationUrl: `https://chatgpt.com/c/${binding.conversationId}`,
    message: instruction,
  };
  return {
    jobId,
    encodedInstruction:
      "CHATGPT_CONTINUE_JSON:" + Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"),
  };
}

export async function dispatchDirectChatGptAccountWork(input: {
  target: DirectChatGptTarget;
  instruction: string;
  source?: string;
  projectName?: string;
  repository?: string;
  branch?: string;
  requestHost?: string;
  expectedOwnerChannel?: string;
}) {
  assertDevRuntime();

  // A named DELL executor is not an account alias. The automatic account
  // selector must never replace an explicitly requested worker with a
  // different PC (or a legacy travelincars binding). The DELL browser path
  // requires a separate server-authorized, challenge-bound wake dispatch.
  if (/\bopenclaw-dell-chatgpt-wake-dev\b/i.test(input.instruction)) {
    throw new ExternalAgentDispatchError(
      "CAPABILITY_DENIED",
      "EXPLICIT_DELL_WAKE_REQUIRED: use verified DEV_CHATGPT_WAKE dispatch pinned to openclaw-dell-chatgpt-wake-dev; no account fallback is permitted.",
    );
  }

  const registry = await getExternalAgentRegistrySnapshot();
  const counts = await activeJobCounts();
  const personal = DIRECT_CHATGPT_ACCOUNT_BINDINGS.personal;
  const personalWorker = registry.find((item) => item.clientId === personal.workerId);
  const personalEligible =
    personalWorker?.eligible === true && personalWorker.reportedHealth === "healthy";

  let gpt02Target: DevWakeTarget | null = null;
  try {
    gpt02Target = await resolveVerifiedDevWakeTarget(
      "GPT02",
      input.requestHost,
      input.expectedOwnerChannel,
    );
  } catch (error) {
    if (input.target === "travelincars" || input.target === "both") throw error;
  }

  const gpt02Binding = gpt02Target?.wakeBinding ?? null;
  const candidates = [
    ...(gpt02Target && gpt02Binding
      ? [{
          account: "travelincars" as const,
          kind: "wake" as const,
          workerId: gpt02Target.workerId,
          browserProfile: gpt02Binding.browserProfile,
          conversationId: gpt02Target.targetConversationId,
          wakeTarget: gpt02Target,
        }]
      : []),
    ...(personalEligible
      ? [{
          account: "personal" as const,
          kind: "direct" as const,
          workerId: personal.workerId,
          browserProfile: personal.browserProfile,
          conversationId: personal.conversationId,
        }]
      : []),
  ];

  let selected: typeof candidates;
  if (input.target === "both") {
    if (!candidates.some((item) => item.account === "travelincars") ||
        !candidates.some((item) => item.account === "personal")) {
      throw new ExternalAgentDispatchError(
        "AGENT_UNAVAILABLE",
        "Both DEV ChatGPT accounts require a healthy verified session before dual-account routing. No partial dispatch was performed.",
      );
    }
    selected = [
      candidates.find((item) => item.account === "travelincars")!,
      candidates.find((item) => item.account === "personal")!,
    ];
  } else if (input.target === "auto") {
    const picked = [...candidates].sort((a, b) => {
      const load = (counts.get(a.workerId) ?? 0) - (counts.get(b.workerId) ?? 0);
      if (load !== 0) return load;
      return a.workerId.localeCompare(b.workerId);
    })[0];
    if (!picked) {
      throw new ExternalAgentDispatchError(
        "AGENT_UNAVAILABLE",
        "No healthy verified DEV ChatGPT session is available.",
      );
    }
    selected = [picked];
  } else {
    const picked = candidates.find((item) => item.account === input.target);
    if (!picked) {
      throw new ExternalAgentDispatchError(
        "AGENT_UNAVAILABLE",
        input.target === "travelincars"
          ? "GPT02 has no healthy verified DEV session."
          : `Bound DEV ChatGPT worker ${personal.workerId} is unavailable.`,
      );
    }
    selected = [picked];
  }

  const dispatched = [];
  for (const candidate of selected) {
    if (candidate.kind === "wake") {
      const eventId = randomBytes(32).toString("hex");
      const correlationId = `gpt02:direct:${randomUUID()}`;
      const queued = await queueDevBrowserWake({
        ownerChannel: candidate.wakeTarget.ownerChannel,
        targetConversationId: candidate.wakeTarget.targetConversationId,
        eventId,
        correlationId,
        instruction: input.instruction,
        requestHost: input.requestHost,
        expectedWorkerId: candidate.wakeTarget.workerId,
        expectedBindingFingerprint: candidate.wakeTarget.wakeBinding!.bindingFingerprint,
      });
      dispatched.push({
        account: candidate.account,
        workerId: queued.clientId,
        browserProfile: candidate.browserProfile,
        conversationId: candidate.conversationId,
        commandId: queued.commandId,
        externalCommandId: null,
        status: queued.created ? "RECEIVED" : "ALREADY_QUEUED",
        created: queued.created,
        activeJobsBeforeDispatch: counts.get(candidate.workerId) ?? 0,
        jobId: correlationId,
        portableAccountBinding: true,
        bindingFingerprint: candidate.wakeTarget.wakeBinding!.bindingFingerprint,
      });
      continue;
    }

    const encoded = buildEncodedInstruction(personal, input.instruction);
    const result = await dispatchExternalAgentWork({
      clientId: candidate.workerId,
      instruction: encoded.encodedInstruction,
      source: input.source ?? "ai-core-chat",
      externalCommandId: `ai-core-chat-account-${candidate.account}-${randomUUID()}`,
      metadata: {
        explicitWorkerTarget: true,
        directChatGptAccountRouter: true,
        accountAlias: candidate.account,
        browserProfile: candidate.browserProfile,
        conversationId: candidate.conversationId,
        jobId: encoded.jobId,
        purpose: "ai-core-chat-direct-account",
        ...(input.projectName ? { projectName: input.projectName } : {}),
        ...(input.repository ? { repository: input.repository } : {}),
        ...(input.branch ? { branch: input.branch } : {}),
      },
    });
    dispatched.push({
      account: candidate.account,
      workerId: result.clientId,
      browserProfile: candidate.browserProfile,
      conversationId: candidate.conversationId,
      commandId: result.command.id,
      externalCommandId: result.command.externalCommandId,
      status: result.command.status,
      created: result.created,
      activeJobsBeforeDispatch: counts.get(candidate.workerId) ?? 0,
      jobId: encoded.jobId,
      portableAccountBinding: false,
    });
  }

  return {
    target: input.target,
    instruction: input.instruction,
    dispatched,
  };
}
