import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import {
  aiCodingIntegrationReviewsTable,
  aiCodingTasksTable,
  db,
  type AiCodingIntegrationReview,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import {
  buildCodingIntegrationManifest,
  CodingIntegrationGateError,
  type CodingIntegrationManifest,
} from "./localCodingMultiWorkerIntegrationGateService.js";
import { getLatestCodingTaskGraph } from "./localCodingTaskGraphService.js";
import { verifyChangedFilesStatically } from "./localCodingVerificationService.js";
import { prepareRepositoryWorkspace } from "./repositoryAnalyzerService.js";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const SHA64_RE = /^[0-9a-f]{64}$/i;

export type CodingIntegrationApprovalErrorCode =
  | "NOT_FOUND"
  | "NOT_READY"
  | "STALE_MANIFEST"
  | "STALE_HEAD"
  | "INVALID_PATCH"
  | "VERIFICATION_FAILED";

export class CodingIntegrationApprovalError extends Error {
  constructor(
    message: string,
    readonly code: CodingIntegrationApprovalErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CodingIntegrationApprovalError";
  }
}

export interface CodingIntegrationVerificationResult {
  reviewId: string;
  taskId: string;
  graphId: string;
  manifestHash: string;
  status: "VERIFIED";
  baseSha: string | null;
  changedFiles: string[];
  appliedWorkstreams: string[];
  combinedPatchSha256: string | null;
  staticIssues: [];
  scriptsExecuted: false;
  commitCreated: false;
  pushed: false;
  merged: false;
  nextAction: "RUN_INTEGRATION_SANDBOX";
  verifiedAt: string;
}

function sameFiles(left: string[], right: string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function git(
  root: string,
  args: string[],
  options: { maxBuffer?: number } = {},
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      LANG: "C",
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return stdout.trim();
}

async function currentManifest(
  taskId: string,
  graphId: string,
): Promise<CodingIntegrationManifest> {
  const snapshot = await getLatestCodingTaskGraph(taskId);
  if (!snapshot || snapshot.graph.id !== graphId) {
    throw new CodingIntegrationApprovalError(
      "Coding task graph was not found for this task.",
      "NOT_FOUND",
      { graphId },
    );
  }

  try {
    return buildCodingIntegrationManifest(taskId, snapshot);
  } catch (error) {
    if (error instanceof CodingIntegrationGateError) {
      throw new CodingIntegrationApprovalError(
        error.message,
        error.code === "NOT_FOUND" ? "NOT_FOUND" : "NOT_READY",
        error.details,
      );
    }
    throw error;
  }
}

function assertManifestHash(
  manifest: CodingIntegrationManifest,
  expectedManifestHash: string,
): string {
  const expected = expectedManifestHash.trim().toLowerCase();
  if (!SHA64_RE.test(expected)) {
    throw new CodingIntegrationApprovalError(
      "Expected integration manifest hash must be SHA-256.",
      "STALE_MANIFEST",
    );
  }
  if (manifest.manifestHash !== expected) {
    throw new CodingIntegrationApprovalError(
      "Integration manifest changed after review; refresh and approve the new manifest.",
      "STALE_MANIFEST",
      {
        expectedManifestHash: expected,
        currentManifestHash: manifest.manifestHash,
      },
    );
  }
  return expected;
}

export async function approveCodingIntegrationManifest(
  taskId: string,
  graphId: string,
  expectedManifestHash: string,
  approvedBy?: string,
): Promise<AiCodingIntegrationReview> {
  const manifest = await currentManifest(taskId, graphId);
  const manifestHash = assertManifestHash(manifest, expectedManifestHash);
  const lockKey = `coding-integration-review:${graphId}`;

  const review = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`,
    );

    const [existing] = await tx
      .select()
      .from(aiCodingIntegrationReviewsTable)
      .where(
        and(
          eq(aiCodingIntegrationReviewsTable.graphId, graphId),
          eq(aiCodingIntegrationReviewsTable.manifestHash, manifestHash),
        ),
      )
      .for("update");

    if (existing?.status === "VERIFIED") return existing;

    if (existing) {
      const [updated] = await tx
        .update(aiCodingIntegrationReviewsTable)
        .set({
          status: "APPROVED",
          approvedBy: approvedBy?.trim().slice(0, 200) || null,
          approvedAt: new Date(),
          verifiedAt: null,
          verificationJson: null,
          errorMessage: null,
        })
        .where(eq(aiCodingIntegrationReviewsTable.id, existing.id))
        .returning();
      if (!updated) {
        throw new CodingIntegrationApprovalError(
          "Integration approval could not be persisted.",
          "NOT_READY",
        );
      }
      return updated;
    }

    const [inserted] = await tx
      .insert(aiCodingIntegrationReviewsTable)
      .values({
        taskId,
        graphId,
        manifestHash,
        status: "APPROVED",
        approvedBy: approvedBy?.trim().slice(0, 200) || null,
        approvedAt: new Date(),
      })
      .returning();

    if (!inserted) {
      throw new CodingIntegrationApprovalError(
        "Integration approval could not be persisted.",
        "NOT_READY",
      );
    }
    return inserted;
  });

  await logAudit(
    "coding-multi-worker",
    "integration_manifest_approved",
    graphId,
    "coding_task_graph",
    "success",
    {
      taskId,
      manifestHash,
      reviewId: review.id,
      commitCreated: false,
      pushed: false,
      merged: false,
    },
  ).catch(() => undefined);

  return review;
}

async function findApprovedReview(
  taskId: string,
  graphId: string,
  manifestHash: string,
): Promise<AiCodingIntegrationReview> {
  const [review] = await db
    .select()
    .from(aiCodingIntegrationReviewsTable)
    .where(
      and(
        eq(aiCodingIntegrationReviewsTable.taskId, taskId),
        eq(aiCodingIntegrationReviewsTable.graphId, graphId),
        eq(aiCodingIntegrationReviewsTable.manifestHash, manifestHash),
      ),
    );

  if (!review) {
    throw new CodingIntegrationApprovalError(
      "Integration manifest has not been explicitly approved.",
      "NOT_READY",
    );
  }
  if (!["APPROVED", "VERIFIED"].includes(review.status)) {
    throw new CodingIntegrationApprovalError(
      "Integration manifest approval is not active.",
      "NOT_READY",
      { status: review.status },
    );
  }
  return review;
}

async function markVerificationFailed(
  reviewId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(aiCodingIntegrationReviewsTable)
    .set({
      status: "FAILED",
      errorMessage: message.slice(0, 2000),
      verificationJson: {
        status: "FAILED",
        error: message.slice(0, 2000),
        commitCreated: false,
        pushed: false,
        merged: false,
      },
    })
    .where(eq(aiCodingIntegrationReviewsTable.id, reviewId))
    .catch(() => undefined);
}

export async function verifyApprovedCodingIntegration(
  taskId: string,
  graphId: string,
  expectedManifestHash: string,
): Promise<CodingIntegrationVerificationResult> {
  const manifest = await currentManifest(taskId, graphId);
  const manifestHash = assertManifestHash(manifest, expectedManifestHash);
  const review = await findApprovedReview(taskId, graphId, manifestHash);

  if (
    review.status === "VERIFIED" &&
    review.verificationJson &&
    typeof review.verificationJson === "object" &&
    !Array.isArray(review.verificationJson)
  ) {
    return review.verificationJson as unknown as CodingIntegrationVerificationResult;
  }

  const [task] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, taskId));
  if (!task) {
    throw new CodingIntegrationApprovalError(
      "Coding task was not found.",
      "NOT_FOUND",
    );
  }

  let workspacePath: string | null = null;
  const patchFiles: string[] = [];

  try {
    const workspace = await prepareRepositoryWorkspace(
      task.repository,
      task.branch,
    );
    if (!workspace.cleanup) {
      throw new CodingIntegrationApprovalError(
        "Integration verification requires a disposable remote clone.",
        "INVALID_PATCH",
      );
    }
    workspacePath = workspace.path;

    const actualHead = (await git(workspacePath, ["rev-parse", "HEAD"])).toLowerCase();
    if (manifest.baseSha && actualHead !== manifest.baseSha) {
      throw new CodingIntegrationApprovalError(
        "Repository HEAD changed after integration manifest approval.",
        "STALE_HEAD",
        { expected: manifest.baseSha, actual: actualHead },
      );
    }

    const appliedWorkstreams: string[] = [];
    for (const item of manifest.workstreams) {
      if (!item.patch) continue;

      const patchFile = join(
        tmpdir(),
        `coding-integration-${randomUUID()}.patch`,
      );
      patchFiles.push(patchFile);
      await writeFile(patchFile, item.patch, "utf8");

      await git(workspacePath, [
        "apply",
        "--check",
        "--whitespace=error-all",
        patchFile,
      ]).catch((error) => {
        throw new CodingIntegrationApprovalError(
          `Integration patch for ${item.key} does not apply cleanly.`,
          "INVALID_PATCH",
          {
            workstreamKey: item.key,
            error: error instanceof Error ? error.message.slice(0, 1000) : String(error),
          },
        );
      });

      await git(workspacePath, [
        "apply",
        "--whitespace=nowarn",
        patchFile,
      ]);
      appliedWorkstreams.push(item.key);
    }

    const actualChanged = (await git(
      workspacePath,
      ["diff", "--name-only", "--"],
    ))
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean)
      .sort();

    if (!sameFiles(actualChanged, manifest.changedFiles)) {
      throw new CodingIntegrationApprovalError(
        "Applied integration files do not match the approved manifest.",
        "INVALID_PATCH",
        {
          expected: manifest.changedFiles,
          actual: actualChanged,
        },
      );
    }

    const staticIssues = await verifyChangedFilesStatically(
      workspacePath,
      manifest.changedFiles,
    );
    if (staticIssues.length > 0) {
      throw new CodingIntegrationApprovalError(
        "Integrated candidate failed static verification.",
        "VERIFICATION_FAILED",
        { staticIssues },
      );
    }

    const combinedPatch = await git(
      workspacePath,
      ["diff", "--no-ext-diff", "--unified=3", "--"],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    const combinedPatchSha256 = combinedPatch
      ? createHash("sha256").update(combinedPatch, "utf8").digest("hex")
      : null;
    const verifiedAt = new Date().toISOString();

    const result: CodingIntegrationVerificationResult = {
      reviewId: review.id,
      taskId,
      graphId,
      manifestHash,
      status: "VERIFIED",
      baseSha: manifest.baseSha,
      changedFiles: manifest.changedFiles,
      appliedWorkstreams,
      combinedPatchSha256,
      staticIssues: [],
      scriptsExecuted: false,
      commitCreated: false,
      pushed: false,
      merged: false,
      nextAction: "RUN_INTEGRATION_SANDBOX",
      verifiedAt,
    };

    await db
      .update(aiCodingIntegrationReviewsTable)
      .set({
        status: "VERIFIED",
        verifiedAt: new Date(verifiedAt),
        verificationJson: result,
        errorMessage: null,
      })
      .where(eq(aiCodingIntegrationReviewsTable.id, review.id));

    await logAudit(
      "coding-multi-worker",
      "integration_manifest_verified",
      graphId,
      "coding_task_graph",
      "success",
      {
        taskId,
        manifestHash,
        reviewId: review.id,
        changedFiles: manifest.changedFiles,
        appliedWorkstreams,
        combinedPatchSha256,
        scriptsExecuted: false,
        commitCreated: false,
        pushed: false,
        merged: false,
        nextAction: "RUN_INTEGRATION_SANDBOX",
      },
    ).catch(() => undefined);

    return result;
  } catch (error) {
    await markVerificationFailed(review.id, error);
    throw error;
  } finally {
    for (const patchFile of patchFiles) {
      await rm(patchFile, { force: true }).catch(() => undefined);
    }
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}
