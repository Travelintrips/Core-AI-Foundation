import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { desc, eq } from "drizzle-orm";
import {
  aiCodeChangesTable,
  aiCodingRunsTable,
  aiCodingTasksTable,
  db,
  type AiCodingRun,
  type AiCodingTask,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { logAudit } from "./aiAuditService.js";
import { executeAI, type ExecutionOutput } from "./aiExecutionService.js";
import { getFallbackModels, routeToModel } from "./aiModelRouter.js";

const execFileAsync = promisify(execFile);
const MAX_CONTEXT_FILES = 8;
const MAX_CONTEXT_BYTES = 140_000;
const MAX_EDIT_FILES = 10;
const MAX_EDIT_BYTES = 120_000;
const CLONE_TIMEOUT_MS = 120_000;

type ChangeType = "ADDED" | "MODIFIED" | "DELETED";

interface PlannedEdit {
  path: string;
  changeType: ChangeType;
  content?: string;
  rationale?: string;
}

interface CodingAgentProposal {
  summary: string;
  changes: PlannedEdit[];
  verificationCommands: string[];
  risks: string[];
}

interface CodingAgentMetadata {
  provider: string;
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}

interface ApprovedContext {
  task: AiCodingTask;
  orchestratorRun: AiCodingRun;
  implementationPlan: Record<string, unknown>;
  orchestration: Record<string, unknown>;
}

const CODING_SYSTEM_PROMPT = [
  "You are the Coding Agent in a controlled software-engineering orchestrator.",
  "You may propose file changes only; never claim to have committed, pushed, deployed, or opened a PR.",
  "Return strict JSON only with keys summary, changes, verificationCommands, risks.",
  "changes must be an array of objects with path, changeType (ADDED|MODIFIED|DELETED), content, rationale.",
  "For MODIFIED or ADDED files, content must contain the complete final UTF-8 file contents.",
  "Use only repository-relative paths. Never use absolute paths or .. traversal.",
  "Keep the change set minimal and directly tied to the approved implementation plan.",
].join(" ");

function parseJsonObject(content: string): Record<string, unknown> {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Coding Agent did not return a JSON object");
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Coding Agent response must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function safeRepoPath(input: string): string {
  const normalizedPath = normalize(input).replaceAll("\\", "/");
  if (
    !normalizedPath ||
    isAbsolute(normalizedPath) ||
    normalizedPath === ".." ||
    normalizedPath.startsWith("../") ||
    normalizedPath.includes("/../")
  ) {
    throw new Error(`Unsafe Coding Agent path: ${input}`);
  }
  return normalizedPath.replace(/^\.\//, "");
}

function normalizeRemoteRepository(repository: string): string {
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return `https://github.com/${repository}.git`;
  }
  const parsed = new URL(repository);
  if (parsed.protocol !== "https:" || !["github.com", "gitlab.com"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("Coding Agent only accepts HTTPS GitHub or GitLab repositories");
  }
  return parsed.toString();
}

async function cloneRepository(repository: string, branch: string): Promise<string> {
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-")) {
    throw new Error("Repository branch contains unsupported characters");
  }
  const workspace = join(tmpdir(), `coding-agent-${crypto.randomUUID()}`);
  await mkdir(workspace, { recursive: true });
  try {
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", "--no-tags", "--single-branch", "--branch", branch, normalizeRemoteRepository(repository), workspace],
      { timeout: CLONE_TIMEOUT_MS, maxBuffer: 128 * 1024 },
    );
    return workspace;
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

async function readPlanContext(workspace: string, files: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let total = 0;
  for (const raw of files.slice(0, MAX_CONTEXT_FILES)) {
    const path = safeRepoPath(raw);
    const full = resolve(workspace, path);
    if (!full.startsWith(resolve(workspace) + sep)) continue;
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) continue;
    const remaining = MAX_CONTEXT_BYTES - total;
    if (remaining <= 0) break;
    const content = await readFile(full, "utf8").catch(() => "");
    const clipped = content.slice(0, remaining);
    total += Buffer.byteLength(clipped, "utf8");
    out[path] = clipped;
  }
  return out;
}

function normalizeProposal(raw: Record<string, unknown>): CodingAgentProposal {
  const rawChanges = Array.isArray(raw.changes) ? raw.changes : [];
  if (rawChanges.length === 0) throw new Error("Coding Agent returned no proposed changes");
  if (rawChanges.length > MAX_EDIT_FILES) throw new Error("Coding Agent proposed too many files");

  const changes: PlannedEdit[] = rawChanges.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Coding Agent change entry is invalid");
    }
    const obj = item as Record<string, unknown>;
    const path = safeRepoPath(typeof obj.path === "string" ? obj.path : "");
    const changeType = obj.changeType;
    if (!["ADDED", "MODIFIED", "DELETED"].includes(String(changeType))) {
      throw new Error(`Unsupported change type for ${path}`);
    }
    const content = typeof obj.content === "string" ? obj.content : undefined;
    if (changeType !== "DELETED" && content === undefined) {
      throw new Error(`Coding Agent omitted complete file content for ${path}`);
    }
    if (content && Buffer.byteLength(content, "utf8") > MAX_EDIT_BYTES) {
      throw new Error(`Coding Agent edit exceeds size limit for ${path}`);
    }
    return {
      path,
      changeType: changeType as ChangeType,
      content,
      rationale: typeof obj.rationale === "string" ? obj.rationale : undefined,
    };
  });

  return {
    summary: typeof raw.summary === "string" ? raw.summary : "Coding Agent prepared a proposed change set.",
    changes,
    verificationCommands: stringList(raw.verificationCommands),
    risks: stringList(raw.risks),
  };
}

async function applyProposal(workspace: string, proposal: CodingAgentProposal): Promise<void> {
  const root = resolve(workspace);
  for (const change of proposal.changes) {
    const full = resolve(root, change.path);
    if (!full.startsWith(root + sep)) throw new Error(`Unsafe output path: ${change.path}`);
    if (change.changeType === "DELETED") {
      await rm(full, { force: true });
      continue;
    }
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, change.content ?? "", "utf8");
  }
}

function execStdoutText(result: unknown): string {
  if (typeof result === "string") return result;
  if (Buffer.isBuffer(result)) return result.toString("utf8");
  if (result && typeof result === "object" && "stdout" in result) {
    const stdout = (result as { stdout?: unknown }).stdout;
    if (typeof stdout === "string") return stdout;
    if (Buffer.isBuffer(stdout)) return stdout.toString("utf8");
  }
  return "";
}

export async function buildProposedDiff(workspace: string): Promise<string> {
  // Intent-to-add exposes untracked ADDED files to git diff without staging,
  // committing, or changing repository history.
  await execFileAsync(
    "git",
    ["add", "-N", "--", "."],
    { cwd: workspace, timeout: 30_000, maxBuffer: 128 * 1024 },
  );

  const result = await execFileAsync(
    "git",
    ["diff", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "--", "."],
    { cwd: workspace, timeout: 30_000, maxBuffer: 512 * 1024 },
  );

  return execStdoutText(result).slice(0, 400_000);
}

async function latestApprovedContext(taskId: string): Promise<ApprovedContext> {
  const [task] = await db.select().from(aiCodingTasksTable).where(eq(aiCodingTasksTable.id, taskId));
  if (!task) throw new Error("Coding task not found");
  if (task.status !== "READY_REVIEW") throw new Error("Coding task is not awaiting plan approval");

  const runs = await db
    .select()
    .from(aiCodingRunsTable)
    .where(eq(aiCodingRunsTable.taskId, taskId))
    .orderBy(desc(aiCodingRunsTable.startedAt));
  const orchestratorRun = runs.find((run) => run.agentName === "Coding Orchestrator" && run.status === "COMPLETED" && run.logs);
  if (!orchestratorRun?.logs) throw new Error("Completed Coding Orchestrator plan not found");

  const payload = JSON.parse(orchestratorRun.logs) as Record<string, unknown>;
  const implementationPlan =
    payload.implementationPlan && typeof payload.implementationPlan === "object"
      ? payload.implementationPlan as Record<string, unknown>
      : null;
  const orchestration =
    payload.orchestration && typeof payload.orchestration === "object"
      ? payload.orchestration as Record<string, unknown>
      : null;

  if (!implementationPlan || !orchestration) throw new Error("Approved plan payload is incomplete");
  if (orchestration.nextAction !== "APPROVE_PLAN") throw new Error("Coding task is not at APPROVE_PLAN gate");
  if (implementationPlan.approvalRequired !== true) throw new Error("Implementation plan does not require approval");

  return { task, orchestratorRun, implementationPlan, orchestration };
}

export async function approvePlanAndStartCoding(taskId: string): Promise<AiCodingRun> {
  const context = await latestApprovedContext(taskId);

  const [run] = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(aiCodingRunsTable)
      .values({
        taskId,
        agentName: "Coding Agent",
        status: "RUNNING",
        startedAt: new Date(),
      })
      .returning();

    await tx
      .update(aiCodingTasksTable)
      .set({ status: "CODING" })
      .where(eq(aiCodingTasksTable.id, taskId));

    return [created];
  });

  await logAudit(
    "coding-orchestrator",
    "plan_approved",
    taskId,
    "coding_task",
    "success",
    { codingRunId: run.id, orchestratorRunId: context.orchestratorRun.id },
  );

  void executeCodingAgent(context, run);
  return run;
}

async function executeCodingAgent(context: ApprovedContext, run: AiCodingRun): Promise<void> {
  let workspace: string | null = null;
  try {
    workspace = await cloneRepository(context.task.repository, context.task.branch);
    const filesToInspect = stringList(context.implementationPlan.filesToInspect);
    const sourceContext = await readPlanContext(workspace, filesToInspect);

    const prompt = [
      "Produce the proposed code changes for this approved implementation plan.",
      `Repository: ${context.task.repository}`,
      `Branch: ${context.task.branch}`,
      `User instruction: ${context.task.instruction}`,
      "Approved implementation plan:",
      JSON.stringify(context.implementationPlan, null, 2),
      "Selected repository files:",
      JSON.stringify(sourceContext, null, 2),
    ].join("\n\n");

    const routed = await routeToModel(`coding implementation ${context.task.repository}: ${context.task.instruction}`);
    if (!routed) throw new Error("Coding Agent could not route to an active model");
    const candidates = [routed, ...(await getFallbackModels(routed.model.id))].filter((candidate) => {
      const caps = candidate.model.capabilities ?? [];
      return candidate.provider.slug !== "replicate" && (caps.includes("code") || caps.includes("text"));
    });
    if (candidates.length === 0) throw new Error("Coding Agent found no code/text model");

    let output: ExecutionOutput | null = null;
    let provider = "";
    let modelUsed = "";
    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        output = await executeAI({
          prompt,
          systemPrompt: CODING_SYSTEM_PROMPT,
          model: candidate.model,
          provider: candidate.provider,
          temperature: 0.1,
          maxTokens: 6000,
          observability: {
            agentName: "Coding Agent",
            requestType: "code",
            createdBy: "coding-orchestrator",
          },
        });
        provider = candidate.provider.slug;
        modelUsed = candidate.model.modelId;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!output) throw new Error(`Coding Agent failed across available models: ${lastError instanceof Error ? lastError.message : String(lastError)}`);

    const proposal = normalizeProposal(parseJsonObject(output.content));
    await applyProposal(workspace, proposal);
    const diff = await buildProposedDiff(workspace);

    const completedAt = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(aiCodingRunsTable)
        .set({
          status: "COMPLETED",
          finishedAt: completedAt,
          logs: JSON.stringify({
            executionStatus: "COMPLETED",
            summary: proposal.summary,
            proposal,
            diff,
            model: {
              provider,
              modelUsed,
              promptTokens: output!.promptTokens,
              completionTokens: output!.completionTokens,
              totalTokens: output!.tokensUsed,
              latencyMs: output!.latencyMs,
            },
            nextAction: "RUN_TESTS",
            commitCreated: false,
            pushed: false,
          }, null, 2),
          errorMessage: null,
        })
        .where(eq(aiCodingRunsTable.id, run.id));

      for (const change of proposal.changes) {
        await tx.insert(aiCodeChangesTable).values({
          taskId: context.task.id,
          filePath: change.path,
          changeType: change.changeType,
          commitSha: null,
        });
      }

      await tx
        .update(aiCodingTasksTable)
        .set({
          status: "TESTING",
          resultSummary: `${proposal.summary} Proposed change set is ready for isolated verification; nothing was committed or pushed.`,
        })
        .where(eq(aiCodingTasksTable.id, context.task.id));
    });

    await logAudit(
      "coding-orchestrator",
      "coding_proposal_ready",
      context.task.id,
      "coding_task",
      "success",
      { codingRunId: run.id, changedFiles: proposal.changes.length, modelUsed, provider },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.transaction(async (tx) => {
      await tx
        .update(aiCodingRunsTable)
        .set({
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: message.slice(0, 2000),
          logs: JSON.stringify({ executionStatus: "FAILED", error: message }, null, 2),
        })
        .where(eq(aiCodingRunsTable.id, run.id));
      await tx
        .update(aiCodingTasksTable)
        .set({
          status: "FAILED",
          resultSummary: `Coding Agent failed: ${message.slice(0, 500)}`,
        })
        .where(eq(aiCodingTasksTable.id, context.task.id));
    });

    await logAudit(
      "coding-orchestrator",
      "coding_proposal_failed",
      context.task.id,
      "coding_task",
      "failure",
      { codingRunId: run.id, error: message.slice(0, 500) },
    );
    logger.error({ err: error, taskId: context.task.id, codingRunId: run.id }, "[coding-agent] Proposal failed");
  } finally {
    if (workspace) {
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
