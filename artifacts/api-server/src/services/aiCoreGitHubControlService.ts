import { logAudit } from "./aiAuditService.js";
import {
  createGitHubApiClient,
  parseGitHubRepository,
} from "./localCodingGitHubPublisherService.js";

export type AiCoreGitHubOperation =
  | "GITHUB_WORKFLOW_STATUS"
  | "GITHUB_WORKFLOW_RERUN"
  | "GITHUB_WORKFLOW_RERUN_FAILED"
  | "GITHUB_WORKFLOW_CANCEL"
  | "GITHUB_HOSTINGER_NODEJS_DEPLOY"
  | "GITHUB_PR_STATUS"
  | "GITHUB_PR_MERGE";

export interface AiCoreGitHubOperationResult {
  operation: AiCoreGitHubOperation;
  mutating: boolean;
  repository: string;
  reply: string;
  data: unknown;
}

function normalize(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

export function detectAiCoreGitHubOperation(message: string): AiCoreGitHubOperation | null {
  const text = normalize(message);
  if (!text) return null;

  const hostingerNodeDeploy =
    /\bhostinger\b/i.test(text) &&
    /\b(?:deploy|redeploy|deployment|publish|rilis)\b/i.test(text) &&
    !/\b(?:docker|compose|container)\b/i.test(text) &&
    /\b(?:node(?:\.?js|\s+js)|aicore|ai\s+core|commit|sha|production|produksi)\b/i.test(text);
  if (hostingerNodeDeploy) return "GITHUB_HOSTINGER_NODEJS_DEPLOY";

  const workflowContext = /\b(?:github\s+actions?|workflow|action\s+run|ci\s+run)\b/i.test(text);
  if (workflowContext) {
    if (/\b(?:rerun|re-run|jalankan\s+ulang|ulang(?:i)?)\b/i.test(text) &&
        /\b(?:failed|gagal)\b/i.test(text)) {
      return "GITHUB_WORKFLOW_RERUN_FAILED";
    }
    if (/\b(?:rerun|re-run|jalankan\s+ulang|ulang(?:i)?)\b/i.test(text)) {
      return "GITHUB_WORKFLOW_RERUN";
    }
    if (/\b(?:cancel|batalkan|hentikan)\b/i.test(text)) {
      return "GITHUB_WORKFLOW_CANCEL";
    }
    if (/\b(?:cek|check|status|lihat|inspect|verify|verifikasi)\b/i.test(text)) {
      return "GITHUB_WORKFLOW_STATUS";
    }
  }

  const prContext = /\b(?:pr|pull\s*request)\s*#?\d+\b/i.test(text);
  if (prContext) {
    if (/\b(?:merge|gabung(?:kan)?|satukan)\b/i.test(text)) return "GITHUB_PR_MERGE";
    if (/\b(?:cek|check|status|lihat|inspect|verify|verifikasi)\b/i.test(text)) {
      return "GITHUB_PR_STATUS";
    }
  }

  return null;
}

function explicitRepository(message: string): string | null {
  return message.match(/\b(?:repo|repository)\s*[:=]\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/i)?.[1] ?? null;
}

function runId(message: string): number | null {
  const raw =
    message.match(/\b(?:run(?:_id)?|workflow(?:\s+run)?)\s*[:=#]?\s*(\d{4,})\b/i)?.[1] ??
    message.match(/\bactions\/runs\/(\d+)\b/i)?.[1];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function requestedCommitSha(message: string): string | null {
  return message.match(
    /\b(?:exact\s+)?(?:commit|sha)\s*[:=#]?\s*([0-9a-f]{7,40})\b/i,
  )?.[1]?.toLowerCase() ?? null;
}

function prNumber(message: string): number | null {
  const raw = message.match(/\b(?:pr|pull\s*request)\s*#?\s*(\d+)\b/i)?.[1];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeRunView(payload: unknown): Record<string, unknown> {
  const row = record(payload);
  return {
    id: row["id"] ?? null,
    name: row["name"] ?? null,
    event: row["event"] ?? null,
    status: row["status"] ?? null,
    conclusion: row["conclusion"] ?? null,
    headSha: row["head_sha"] ?? null,
    headBranch: row["head_branch"] ?? null,
    htmlUrl: row["html_url"] ?? null,
    createdAt: row["created_at"] ?? null,
    updatedAt: row["updated_at"] ?? null,
  };
}

function safePrView(payload: unknown): Record<string, unknown> {
  const row = record(payload);
  return {
    number: row["number"] ?? null,
    state: row["state"] ?? null,
    merged: row["merged"] ?? false,
    mergeable: row["mergeable"] ?? null,
    mergeableState: row["mergeable_state"] ?? null,
    draft: row["draft"] ?? false,
    headSha: record(row["head"])["sha"] ?? null,
    baseSha: record(row["base"])["sha"] ?? null,
    baseRef: record(row["base"])["ref"] ?? null,
    htmlUrl: row["html_url"] ?? null,
  };
}

async function assertPrGreen(
  client: ReturnType<typeof createGitHubApiClient>,
  owner: string,
  repo: string,
  number: number,
): Promise<{ pr: Record<string, unknown>; headSha: string }> {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const pr = record(await client.request("GET", `${base}/pulls/${number}`));
  if (pr["state"] !== "open" || pr["merged"] === true) {
    throw new Error("Pull request is not open.");
  }
  if (pr["draft"] === true) throw new Error("Pull request is still a draft.");
  if (pr["mergeable"] === false || pr["mergeable_state"] === "dirty") {
    throw new Error("Pull request is not cleanly mergeable.");
  }
  const headSha = stringValue(record(pr["head"])["sha"]).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error("Pull request head SHA is invalid.");

  const checks = record(await client.request(
    "GET",
    `${base}/commits/${headSha}/check-runs?per_page=100&filter=latest`,
  ));
  const checkRuns = Array.isArray(checks["check_runs"]) ? checks["check_runs"] as unknown[] : [];
  const statuses = record(await client.request("GET", `${base}/commits/${headSha}/status`));
  const statusRows = Array.isArray(statuses["statuses"]) ? statuses["statuses"] as unknown[] : [];
  if (checkRuns.length === 0 && statusRows.length === 0) {
    throw new Error("No CI evidence is available; merge remains fail-closed.");
  }
  for (const item of checkRuns) {
    const row = record(item);
    if (row["status"] !== "completed") throw new Error("GitHub CI checks are still running.");
    const conclusion = stringValue(row["conclusion"]);
    if (!["success", "neutral", "skipped"].includes(conclusion)) {
      throw new Error(`GitHub check ${stringValue(row["name"]) || "unnamed"} did not pass.`);
    }
  }
  if (statusRows.length > 0 && stringValue(statuses["state"]) !== "success") {
    throw new Error("Combined GitHub commit status is not success.");
  }
  return { pr, headSha };
}

export async function executeAiCoreGitHubOperation(input: {
  operation: AiCoreGitHubOperation;
  message: string;
  repository?: string | null;
  requestedBy?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<AiCoreGitHubOperationResult> {
  const env = input.env ?? process.env;
  const repository =
    explicitRepository(input.message) ||
    input.repository?.trim() ||
    env["AI_CORE_DEFAULT_GITHUB_REPOSITORY"]?.trim() ||
    "Travelintrips/Core-AI-Foundation";
  const { owner, repo } = parseGitHubRepository(repository);
  const token =
    env["AI_CODING_GITHUB_TOKEN"]?.trim() ||
    env["GITHUB_TOKEN"]?.trim() ||
    env["GH_TOKEN"]?.trim() ||
    "";
  const client = createGitHubApiClient(token);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let data: unknown;
  let mutating = false;

  if (input.operation === "GITHUB_HOSTINGER_NODEJS_DEPLOY") {
    mutating = true;
    const requestedSha = requestedCommitSha(input.message);
    const current = record(await client.request("GET", `${base}/commits/main`));
    const headSha = stringValue(current["sha"]).toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(headSha)) {
      throw new Error("Current main SHA is unavailable; Hostinger deploy remains fail-closed.");
    }
    if (requestedSha && !headSha.startsWith(requestedSha)) {
      throw new Error(
        `Requested Hostinger deploy SHA ${requestedSha} is not current main ${headSha}; refusing stale deploy.`,
      );
    }

    await client.request(
      "POST",
      `${base}/actions/workflows/hostinger-nodejs-deploy.yml/dispatches`,
      { ref: "main" },
    );
    data = {
      accepted: true,
      workflow: "hostinger-nodejs-deploy.yml",
      ref: "main",
      expectedSha: headSha,
      requestedSha,
      noWorker: true,
    };
  } else if (input.operation.startsWith("GITHUB_WORKFLOW_")) {
    const id = runId(input.message);
    if (!id) throw new Error("GitHub workflow operation requires run=<workflow-run-id>.");

    if (input.operation === "GITHUB_WORKFLOW_STATUS") {
      data = safeRunView(await client.request("GET", `${base}/actions/runs/${id}`));
    } else {
      mutating = true;
      const suffix =
        input.operation === "GITHUB_WORKFLOW_RERUN_FAILED"
          ? "rerun-failed-jobs"
          : input.operation === "GITHUB_WORKFLOW_CANCEL"
            ? "cancel"
            : "rerun";
      await client.request("POST", `${base}/actions/runs/${id}/${suffix}`);
      data = {
        runId: id,
        accepted: true,
        action: suffix,
      };
    }
  } else {
    const number = prNumber(input.message);
    if (!number) throw new Error("GitHub PR operation requires PR number.");

    if (input.operation === "GITHUB_PR_STATUS") {
      data = safePrView(await client.request("GET", `${base}/pulls/${number}`));
    } else {
      mutating = true;
      const verified = await assertPrGreen(client, owner, repo, number);
      const merged = record(await client.request(
        "PUT",
        `${base}/pulls/${number}/merge`,
        { sha: verified.headSha, merge_method: "merge" },
      ));
      if (merged["merged"] !== true) {
        throw new Error(stringValue(merged["message"]) || "GitHub did not merge the pull request.");
      }
      data = {
        pullRequestNumber: number,
        merged: true,
        sourceSha: verified.headSha,
        mergeCommitSha: merged["sha"] ?? null,
      };
    }
  }

  await logAudit(
    "ai-core-chat",
    mutating ? "github_fast_action_executed" : "github_fast_action_read",
    input.operation,
    "ai_core_control_plane",
    "success",
    {
      requestedBy: input.requestedBy ?? "ai-core-chat",
      repository: `${owner}/${repo}`,
      noWorker: true,
    },
  ).catch(() => undefined);

  return {
    operation: input.operation,
    mutating,
    repository: `${owner}/${repo}`,
    reply: mutating
      ? `Operasi ${input.operation} diterima GitHub tanpa Coding Orchestrator.`
      : `Status ${input.operation} berhasil dibaca tanpa Coding Orchestrator.`,
    data,
  };
}
