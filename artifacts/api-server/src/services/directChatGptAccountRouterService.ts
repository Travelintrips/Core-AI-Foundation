import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  dispatchExternalAgentWork,
  ExternalAgentDispatchError,
} from "./externalAgentDispatchService.js";
import { getExternalAgentRegistrySnapshot } from "./externalAgentRegistryService.js";

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

function stripRoutingPrefix(message: string): string {
  return message
    .replace(/^\s*(?:pakai|gunakan|gunakanlah|kirim(?:kan)?|delegasikan|route|rutekan|kerjakan|jalankan|bagi)\s+/i, "")
    .replace(/^\s*(?:ke|dengan|melalui|via)\s+/i, "")
    .replace(/^\s*(?:dua|kedua|2)\s+akun(?:\s+chatgpt)?\s*[:,-]?\s*/i, "")
    .replace(/^\s*(?:akun\s+)?(?:personal|admcst001)(?:-dev)?(?:\s+chatgpt)?\s*[:,-]?\s*/i, "")
    .replace(/^\s*(?:akun\s+)?(?:travelincars|percobaan)(?:-dev)?(?:\s+chatgpt)?\s*[:,-]?\s*/i, "")
    .replace(/^\s*(?:chatgpt|akun\s+otomatis|salah\s+satu\s+akun)(?:\s+dev)?\s*[:,-]?\s*/i, "")
    .replace(/^\s*(?:untuk|agar|supaya)\s+/i, "")
    .trim();
}

export function parseDirectChatGptAccountRequest(
  message: string,
): DirectChatGptAccountRequest | null {
  const text = message.trim();
  if (!text) return null;

  const hasAction = /\b(?:pakai|gunakan|kirim(?:kan)?|delegasikan|route|rutekan|kerjakan|jalankan|bagi)\b/i.test(text);
  const explicitPrefix = /^\s*(?:chatgpt|akun\s+(?:personal|travelincars|percobaan|otomatis)|(?:dua|kedua|2)\s+akun)\s*:/i.test(text);
  if (!hasAction && !explicitPrefix) return null;

  let target: DirectChatGptTarget | null = null;
  if (/\b(?:dua|kedua|2)\s+akun(?:\s+chatgpt)?\b/i.test(text)) target = "both";
  else if (/\b(?:akun\s+)?(?:personal|admcst001)(?:-dev)?\b/i.test(text)) target = "personal";
  else if (/\b(?:akun\s+)?(?:travelincars|percobaan)(?:-dev)?\b/i.test(text)) target = "travelincars";
  else if (/\b(?:chatgpt|akun\s+otomatis|salah\s+satu\s+akun)\b/i.test(text)) target = "auto";
  if (!target) return null;

  const instruction = stripRoutingPrefix(text);
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
  }>(`
    SELECT
      metadata_json ->> 'assignedClientId' AS client_id,
      COUNT(*)::int AS active_jobs
    FROM ai_platform.ai_coding_bridge_commands
    WHERE status IN ('RECEIVED', 'PROCESSING')
      AND metadata_json ->> 'assignedClientId' IN ('openclaw-pc-worker-dev', 'openclaw-pc-worker-2')
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
}) {
  assertDevRuntime();

  const registry = await getExternalAgentRegistrySnapshot();
  const counts = await activeJobCounts();
  const bindings = Object.values(DIRECT_CHATGPT_ACCOUNT_BINDINGS);

  const eligible = bindings.filter((binding) => {
    const worker = registry.find((item) => item.clientId === binding.workerId);
    return worker?.eligible === true && worker.reportedHealth === "healthy";
  });

  let selected: typeof bindings;
  if (input.target === "both") {
    if (eligible.length !== bindings.length) {
      throw new ExternalAgentDispatchError(
        "AGENT_UNAVAILABLE",
        "Both bound DEV ChatGPT workers must be healthy before dual-account routing. No partial dispatch was performed.",
      );
    }
    selected = bindings;
  } else if (input.target === "auto") {
    const picked = [...eligible].sort((a, b) => {
      const load = (counts.get(a.workerId) ?? 0) - (counts.get(b.workerId) ?? 0);
      if (load !== 0) return load;
      return a.workerId.localeCompare(b.workerId);
    })[0];
    if (!picked) {
      throw new ExternalAgentDispatchError(
        "AGENT_UNAVAILABLE",
        "No healthy bound DEV ChatGPT worker is available.",
      );
    }
    selected = [picked];
  } else {
    const binding = DIRECT_CHATGPT_ACCOUNT_BINDINGS[input.target];
    if (!eligible.some((item) => item.workerId === binding.workerId)) {
      throw new ExternalAgentDispatchError(
        "AGENT_UNAVAILABLE",
        `Bound DEV ChatGPT worker ${binding.workerId} is unavailable.`,
      );
    }
    selected = [binding];
  }

  const dispatched = [];
  for (const binding of selected) {
    const encoded = buildEncodedInstruction(binding, input.instruction);
    const result = await dispatchExternalAgentWork({
      clientId: binding.workerId,
      instruction: encoded.encodedInstruction,
      source: input.source ?? "ai-core-chat",
      externalCommandId: `ai-core-chat-account-${binding.key}-${randomUUID()}`,
      metadata: {
        explicitWorkerTarget: true,
        directChatGptAccountRouter: true,
        accountAlias: binding.key,
        browserProfile: binding.browserProfile,
        conversationId: binding.conversationId,
        jobId: encoded.jobId,
        purpose: "ai-core-chat-direct-account",
        ...(input.projectName ? { projectName: input.projectName } : {}),
        ...(input.repository ? { repository: input.repository } : {}),
        ...(input.branch ? { branch: input.branch } : {}),
      },
    });
    dispatched.push({
      account: binding.key,
      workerId: result.clientId,
      browserProfile: binding.browserProfile,
      conversationId: binding.conversationId,
      commandId: result.command.id,
      externalCommandId: result.command.externalCommandId,
      status: result.command.status,
      created: result.created,
      activeJobsBeforeDispatch: counts.get(binding.workerId) ?? 0,
      jobId: encoded.jobId,
    });
  }

  return {
    target: input.target,
    instruction: input.instruction,
    dispatched,
  };
}
