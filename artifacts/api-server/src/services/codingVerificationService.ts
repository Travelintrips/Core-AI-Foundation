import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import {
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
const MAX_REVIEW_DIFF = 120_000;
const MAX_CHECK_DETAIL = 4_000;
const IMPORT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"] as const;

type ChangeType = "ADDED" | "MODIFIED" | "DELETED";

export interface VerificationProposalChange {
  path: string;
  changeType: ChangeType;
  content?: string;
  rationale?: string;
}

export interface VerificationProposal {
  summary: string;
  changes: VerificationProposalChange[];
  verificationCommands: string[];
  risks: string[];
}

interface VerificationContext {
  task: AiCodingTask;
  orchestratorRun: AiCodingRun;
  codingRun: AiCodingRun;
  workspace: string;
  proposal: VerificationProposal;
  diff: string;
}

interface TestCheck {
  name: string;
  status: "PASSED" | "FAILED";
  detail: string;
}

interface TestReport {
  outcome: "PASSED" | "FAILED";
  checks: TestCheck[];
  commandsRun: string[];
  proposedCommands: string[];
}

interface ReviewResult {
  decision: "APPROVE_FOR_COMMIT" | "REVISE_CHANGES";
  summary: string;
  issues: string[];
  recommendations: string[];
  provider: string;
  modelUsed: string;
  totalTokens: number;
  latencyMs: number;
  parsedAsJson: boolean;
}

const REVIEW_SYSTEM_PROMPT = [
  "You are the Review Agent in a controlled coding orchestrator.",
  "Review the proposed diff against the user instruction, implementation plan, and deterministic test report.",
  "Do not edit files. Do not claim to commit, push, deploy, or open a PR.",
  "Return strict JSON only with keys decision, summary, issues, recommendations.",
  "decision must be APPROVE_FOR_COMMIT or REVISE_CHANGES.",
  "If deterministic tests failed, decision must be REVISE_CHANGES.",
].join(" ");

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function truncate(value: string, max = MAX_CHECK_DETAIL): string {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

function execText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const stdout = record.stdout;
    const stderr = record.stderr;
    const parts: string[] = [];
    if (typeof stdout === "string") parts.push(stdout);
    else if (Buffer.isBuffer(stdout)) parts.push(stdout.toString("utf8"));
    if (typeof stderr === "string") parts.push(stderr);
    else if (Buffer.isBuffer(stderr)) parts.push(stderr.toString("utf8"));
    return parts.join("\n");
  }
  return "";
}

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const output = execText(record);
    if (output.trim()) return truncate(output.trim());
  }
  return truncate(error instanceof Error ? error.message : String(error));
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const cleaned = content
    .trim()
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function exists(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return Boolean(info);
}

async function resolveRelativeImport(sourceFile: string, specifier: string): Promise<boolean> {
  const base = resolve(dirname(sourceFile), specifier);
  const candidates = [
    base,
    ...IMPORT_EXTENSIONS.map((suffix) => base + suffix),
    ...IMPORT_EXTENSIONS.map((suffix) => resolve(base, "index" + suffix)),
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return true;
  }
  return false;
}

function relativeImports(content: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g,
    /\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
    /\bimport\s+["'](\.{1,2}\/[^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found];
}

async function runDeterministicTests(
  workspace: string,
  proposal: VerificationProposal,
): Promise<TestReport> {
  const checks: TestCheck[] = [];
  const commandsRun: string[] = [];

  commandsRun.push("git diff --check -- .");
  try {
    await execFileAsync(
      "git",
      ["diff", "--check", "--", "."],
      { cwd: workspace, timeout: 30_000, maxBuffer: 256 * 1024 },
    );
    checks.push({
      name: "git-diff-check",
      status: "PASSED",
      detail: "git diff --check reported no whitespace errors.",
    });
  } catch (error) {
    checks.push({
      name: "git-diff-check",
      status: "FAILED",
      detail: errorText(error),
    });
  }

  const root = resolve(workspace);
  for (const change of proposal.changes) {
    const full = resolve(root, change.path);
    if (!full.startsWith(root + sep)) {
      checks.push({
        name: `path:${change.path}`,
        status: "FAILED",
        detail: "Changed path escaped the isolated workspace.",
      });
      continue;
    }

    const info = await stat(full).catch(() => null);
    if (change.changeType === "DELETED") {
      checks.push({
        name: `delete:${change.path}`,
        status: info ? "FAILED" : "PASSED",
        detail: info ? "File still exists after proposed deletion." : "Proposed deletion is reflected in workspace.",
      });
      continue;
    }

    if (!info?.isFile()) {
      checks.push({
        name: `file:${change.path}`,
        status: "FAILED",
        detail: "Proposed file does not exist in isolated workspace.",
      });
      continue;
    }

    if (extname(change.path).toLowerCase() === ".json") {
      try {
        JSON.parse(await readFile(full, "utf8"));
        checks.push({
          name: `json:${change.path}`,
          status: "PASSED",
          detail: "JSON parses successfully.",
        });
      } catch (error) {
        checks.push({
          name: `json:${change.path}`,
          status: "FAILED",
          detail: errorText(error),
        });
      }
    }

    if (/\.(?:js|mjs|cjs)$/i.test(change.path)) {
      commandsRun.push(`node --check ${change.path}`);
      try {
        await execFileAsync(
          process.execPath,
          ["--check", full],
          { cwd: workspace, timeout: 30_000, maxBuffer: 256 * 1024 },
        );
        checks.push({
          name: `syntax:${change.path}`,
          status: "PASSED",
          detail: "Node syntax check passed.",
        });
      } catch (error) {
        checks.push({
          name: `syntax:${change.path}`,
          status: "FAILED",
          detail: errorText(error),
        });
      }
    }

    if (/\.(?:[cm]?[jt]sx?)$/i.test(change.path)) {
      const content = await readFile(full, "utf8").catch(() => "");
      const imports = relativeImports(content);
      for (const specifier of imports) {
        const resolved = await resolveRelativeImport(full, specifier);
        checks.push({
          name: `import:${change.path}:${specifier}`,
          status: resolved ? "PASSED" : "FAILED",
          detail: resolved
            ? "Relative import resolves inside the isolated repository."
            : "Relative import target could not be resolved in the isolated repository.",
        });
      }
    }
  }

  return {
    outcome: checks.some((check) => check.status === "FAILED") ? "FAILED" : "PASSED",
    checks,
    commandsRun,
    proposedCommands: proposal.verificationCommands,
  };
}

function parseOrchestratorPayload(run: AiCodingRun): Record<string, unknown> {
  if (!run.logs) return {};
  try {
    const parsed = JSON.parse(run.logs);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function updateStage(
  payload: Record<string, unknown>,
  stageId: "coding" | "testing" | "review",
  status: "RUNNING" | "COMPLETED" | "FAILED",
  detail?: string,
): Record<string, unknown> {
  const orchestration =
    payload.orchestration && typeof payload.orchestration === "object" && !Array.isArray(payload.orchestration)
      ? payload.orchestration as Record<string, unknown>
      : {};
  const stages = Array.isArray(orchestration.stages)
    ? orchestration.stages.map((stage) => {
        if (!stage || typeof stage !== "object" || Array.isArray(stage)) return stage;
        const item = stage as Record<string, unknown>;
        if (item.id !== stageId) return item;
        const now = new Date().toISOString();
        return {
          ...item,
          status,
          ...(status === "RUNNING" && !item.startedAt ? { startedAt: now } : {}),
          ...(["COMPLETED", "FAILED"].includes(status) ? { completedAt: now } : {}),
          ...(detail ? { detail } : {}),
        };
      })
    : [];

  return {
    ...payload,
    orchestration: {
      ...orchestration,
      stages,
    },
  };
}

async function persistOrchestratorPayload(
  orchestratorRunId: string,
  payload: Record<string, unknown>,
  status: string,
  nextAction?: string,
): Promise<Record<string, unknown>> {
  const orchestration =
    payload.orchestration && typeof payload.orchestration === "object" && !Array.isArray(payload.orchestration)
      ? payload.orchestration as Record<string, unknown>
      : {};
  const next = {
    ...payload,
    orchestration: {
      ...orchestration,
      status,
      ...(nextAction ? { nextAction } : {}),
    },
  };
  await db
    .update(aiCodingRunsTable)
    .set({ logs: stringify(next) })
    .where(eq(aiCodingRunsTable.id, orchestratorRunId));
  return next;
}

async function createRun(taskId: string, agentName: string): Promise<AiCodingRun> {
  const [run] = await db
    .insert(aiCodingRunsTable)
    .values({
      taskId,
      agentName,
      status: "RUNNING",
      startedAt: new Date(),
    })
    .returning();
  return run;
}

async function completeTestRun(run: AiCodingRun, report: TestReport): Promise<void> {
  await db
    .update(aiCodingRunsTable)
    .set({
      status: "COMPLETED",
      finishedAt: new Date(),
      logs: stringify({
        executionStatus: "COMPLETED",
        testOutcome: report.outcome,
        report,
        nextAction: "RUN_REVIEW",
        commitCreated: false,
        pushed: false,
      }),
      errorMessage: null,
    })
    .where(eq(aiCodingRunsTable.id, run.id));
}

async function executeReviewAgent(
  context: VerificationContext,
  report: TestReport,
): Promise<ReviewResult> {
  const orchestratorPayload = parseOrchestratorPayload(context.orchestratorRun);
  const plan =
    orchestratorPayload.implementationPlan && typeof orchestratorPayload.implementationPlan === "object"
      ? orchestratorPayload.implementationPlan
      : null;

  const prompt = [
    "Review this proposed change set.",
    `Repository: ${context.task.repository}`,
    `Branch: ${context.task.branch}`,
    `User instruction: ${context.task.instruction}`,
    "Implementation plan:",
    stringify(plan),
    "Proposal summary:",
    context.proposal.summary,
    "Proposed diff:",
    context.diff.slice(0, MAX_REVIEW_DIFF),
    "Deterministic test report:",
    stringify(report),
  ].join("\n\n");

  const routed = await routeToModel(
    `code review ${context.task.repository}: ${context.task.instruction}`,
  );
  if (!routed) throw new Error("Review Agent could not route to an active model");

  const candidates = [routed, ...(await getFallbackModels(routed.model.id))].filter((candidate) => {
    const capabilities = candidate.model.capabilities ?? [];
    return candidate.provider.slug !== "replicate" &&
      (capabilities.includes("code") || capabilities.includes("text"));
  });
  if (candidates.length === 0) throw new Error("Review Agent found no text/code model");

  let output: ExecutionOutput | null = null;
  let provider = "";
  let modelUsed = "";
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      output = await executeAI({
        prompt,
        systemPrompt: REVIEW_SYSTEM_PROMPT,
        model: candidate.model,
        provider: candidate.provider,
        temperature: 0.1,
        maxTokens: 2200,
        observability: {
          agentName: "Review Agent",
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
  if (!output) {
    throw new Error(
      `Review Agent failed across available models: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  const parsed = parseJsonObject(output.content);
  const requestedDecision =
    parsed?.decision === "APPROVE_FOR_COMMIT" ? "APPROVE_FOR_COMMIT" : "REVISE_CHANGES";
  const decision = report.outcome === "FAILED" ? "REVISE_CHANGES" : requestedDecision;
  const issues = stringList(parsed?.issues);
  const recommendations = stringList(parsed?.recommendations);

  if (report.outcome === "FAILED") {
    issues.unshift("Deterministic Test Agent verification failed; commit approval is blocked.");
  }

  return {
    decision,
    summary:
      typeof parsed?.summary === "string"
        ? parsed.summary
        : decision === "APPROVE_FOR_COMMIT"
          ? "Review Agent found the proposal ready for an explicit commit approval."
          : "Review Agent requires revisions before commit approval.",
    issues,
    recommendations,
    provider,
    modelUsed,
    totalTokens: output.tokensUsed,
    latencyMs: output.latencyMs,
    parsedAsJson: Boolean(parsed),
  };
}

export async function continueCodingVerification(context: VerificationContext): Promise<void> {
  let orchestratorPayload = parseOrchestratorPayload(context.orchestratorRun);
  let testRun: AiCodingRun | null = null;
  let reviewRun: AiCodingRun | null = null;

  try {
    orchestratorPayload = updateStage(
      orchestratorPayload,
      "coding",
      "COMPLETED",
      "Coding Agent produced an isolated proposed change set. No commit or push was created.",
    );
    orchestratorPayload = updateStage(orchestratorPayload, "testing", "RUNNING");
    orchestratorPayload = await persistOrchestratorPayload(
      context.orchestratorRun.id,
      orchestratorPayload,
      "TESTING",
    );

    testRun = await createRun(context.task.id, "Test Agent");
    const report = await runDeterministicTests(context.workspace, context.proposal);
    await completeTestRun(testRun, report);

    orchestratorPayload = updateStage(
      orchestratorPayload,
      "testing",
      report.outcome === "PASSED" ? "COMPLETED" : "FAILED",
      `Deterministic verification outcome: ${report.outcome}`,
    );
    orchestratorPayload = updateStage(orchestratorPayload, "review", "RUNNING");
    orchestratorPayload = await persistOrchestratorPayload(
      context.orchestratorRun.id,
      orchestratorPayload,
      "REVIEWING",
    );

    reviewRun = await createRun(context.task.id, "Review Agent");
    const review = await executeReviewAgent(context, report);
    const completedAt = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(aiCodingRunsTable)
        .set({
          status: "COMPLETED",
          finishedAt: completedAt,
          logs: stringify({
            executionStatus: "COMPLETED",
            decision: review.decision,
            summary: review.summary,
            issues: review.issues,
            recommendations: review.recommendations,
            model: {
              provider: review.provider,
              modelUsed: review.modelUsed,
              totalTokens: review.totalTokens,
              latencyMs: review.latencyMs,
              parsedAsJson: review.parsedAsJson,
            },
            testOutcome: report.outcome,
            nextAction: review.decision === "APPROVE_FOR_COMMIT" ? "APPROVE_COMMIT" : "REVISE_CHANGES",
            commitCreated: false,
            pushed: false,
          }),
          errorMessage: null,
        })
        .where(eq(aiCodingRunsTable.id, reviewRun.id));

      await tx
        .update(aiCodingTasksTable)
        .set({
          status: "READY_REVIEW",
          resultSummary:
            `Test Agent: ${report.outcome}. Review Agent: ${review.decision}. ${review.summary} Nothing was committed or pushed.`,
        })
        .where(eq(aiCodingTasksTable.id, context.task.id));
    });

    orchestratorPayload = updateStage(
      orchestratorPayload,
      "review",
      "COMPLETED",
      `Review decision: ${review.decision}`,
    );
    await persistOrchestratorPayload(
      context.orchestratorRun.id,
      orchestratorPayload,
      "READY_REVIEW",
      review.decision === "APPROVE_FOR_COMMIT" ? "APPROVE_COMMIT" : "REVISE_CHANGES",
    );

    await logAudit(
      "coding-orchestrator",
      "testing_review_completed",
      context.task.id,
      "coding_task",
      "success",
      {
        testRunId: testRun.id,
        reviewRunId: reviewRun.id,
        testOutcome: report.outcome,
        reviewDecision: review.decision,
        reviewModel: review.modelUsed,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date();

    if (testRun) {
      await db
        .update(aiCodingRunsTable)
        .set({
          status: testRun.status === "COMPLETED" ? "COMPLETED" : "FAILED",
          finishedAt: now,
          errorMessage: testRun.status === "COMPLETED" ? null : message.slice(0, 2000),
        })
        .where(eq(aiCodingRunsTable.id, testRun.id))
        .catch(() => undefined);
    }
    if (reviewRun) {
      await db
        .update(aiCodingRunsTable)
        .set({
          status: "FAILED",
          finishedAt: now,
          errorMessage: message.slice(0, 2000),
          logs: stringify({ executionStatus: "FAILED", error: message }),
        })
        .where(eq(aiCodingRunsTable.id, reviewRun.id))
        .catch(() => undefined);
    }

    await db
      .update(aiCodingTasksTable)
      .set({
        status: "READY_REVIEW",
        resultSummary:
          `Testing/Review pipeline could not finish: ${message.slice(0, 500)} Proposed changes remain uncommitted and unpushed.`,
      })
      .where(eq(aiCodingTasksTable.id, context.task.id))
      .catch(() => undefined);

    logger.error(
      { err: error, taskId: context.task.id },
      "[coding-verification] Test/Review pipeline failed",
    );
  }
}
