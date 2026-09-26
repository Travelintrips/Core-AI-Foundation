import { eq } from "drizzle-orm";
import {
  aiCodingBridgeCommandsTable,
  aiCodingRunsTable,
  aiCodingTasksTable,
  db,
} from "@workspace/db";
import { startCodingOrchestration } from "./codingOrchestratorService.js";
import {
  getAccessibleCodingRepository,
  listAccessibleCodingRepositories,
  type CodingGitHubRepository,
} from "./localCodingGitHubDiscoveryService.js";

export class CodingWhatsappTaskRuntimeError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "REPOSITORY_REQUIRED"
      | "REPOSITORY_AMBIGUOUS"
      | "REPOSITORY_NOT_FOUND"
      | "START_FAILED",
  ) {
    super(message);
  }
}

function createTaskNumber(): string {
  return `CWS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function explicitRepository(instruction: string): string | null {
  const tagged = instruction.match(/\b(?:repo|repository)\s*[:=]\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/i)?.[1];
  if (tagged) return tagged;

  const direct = instruction.match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/)?.[1];
  return direct ?? null;
}

function explicitBranch(instruction: string): string | null {
  return instruction.match(/\bbranch\s*[:=]\s*([A-Za-z0-9._\/-]+)\b/i)?.[1] ?? null;
}

function repoMentionScore(instruction: string, repo: CodingGitHubRepository): number {
  const haystack = instruction.toLowerCase();
  if (haystack.includes(repo.fullName.toLowerCase())) return 3;
  if (haystack.includes(repo.name.toLowerCase())) return 2;
  return 0;
}

async function resolveRepository(instruction: string): Promise<CodingGitHubRepository> {
  const explicit = explicitRepository(instruction);
  if (explicit) {
    try {
      return await getAccessibleCodingRepository(explicit);
    } catch {
      throw new CodingWhatsappTaskRuntimeError(
        `Repository ${explicit} tidak ditemukan atau tidak dapat diakses AI Core.`,
        "REPOSITORY_NOT_FOUND",
      );
    }
  }

  const rows = await listAccessibleCodingRepositories();
  const ranked = rows
    .map((repo) => ({ repo, score: repoMentionScore(instruction, repo) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.repo.name.length - a.repo.name.length);

  if (ranked.length === 0) {
    throw new CodingWhatsappTaskRuntimeError(
      "Repository belum terdeteksi. Sertakan nama repository, misalnya: coding perbaiki login di CST-CUSTOMER-PORTAL",
      "REPOSITORY_REQUIRED",
    );
  }

  const bestScore = ranked[0]!.score;
  const best = ranked.filter((item) => item.score === bestScore);
  if (best.length > 1) {
    throw new CodingWhatsappTaskRuntimeError(
      `Repository ambigu: ${best.slice(0, 5).map((item) => item.repo.fullName).join(", ")}. Gunakan repo:owner/name.`,
      "REPOSITORY_AMBIGUOUS",
    );
  }

  return best[0]!.repo;
}

export async function createAndStartWhatsappCodingTask(input: {
  commandId: string;
  instruction: string;
}) {
  const repository = await resolveRepository(input.instruction);
  const branch = explicitBranch(input.instruction) ?? repository.defaultBranch;

  const { task, run } = await db.transaction(async (tx) => {
    const [createdTask] = await tx
      .insert(aiCodingTasksTable)
      .values({
        taskNumber: createTaskNumber(),
        projectName: `WhatsApp: ${repository.name}`,
        repository: repository.fullName,
        branch,
        instruction: input.instruction,
        priority: 50,
        status: "ANALYZING",
      })
      .returning();

    if (!createdTask) throw new Error("Failed to create coding task");

    const [createdRun] = await tx
      .insert(aiCodingRunsTable)
      .values({
        taskId: createdTask.id,
        agentName: "Coding Orchestrator",
        status: "RUNNING",
        startedAt: new Date(),
      })
      .returning();

    if (!createdRun) throw new Error("Failed to create coding run");

    await tx
      .update(aiCodingBridgeCommandsTable)
      .set({ taskId: createdTask.id })
      .where(eq(aiCodingBridgeCommandsTable.id, input.commandId));

    return { task: createdTask, run: createdRun };
  });

  try {
    const orchestration = await startCodingOrchestration({ task, run });
    return {
      task,
      run,
      repository,
      branch,
      sessionId: orchestration.sessionId,
    };
  } catch (error) {
    throw new CodingWhatsappTaskRuntimeError(
      `Coding Orchestrator gagal dimulai: ${error instanceof Error ? error.message : String(error)}`,
      "START_FAILED",
    );
  }
}
