import { createHash } from "node:crypto";
import {
  getLatestCodingTaskGraph,
  type CodingTaskGraphSnapshot,
} from "./localCodingTaskGraphService.js";
import { codingWorkstreamOwnsFile } from "./localCodingMultiWorkerExecutionService.js";

const SHA40_RE = /^[0-9a-f]{40}$/i;
const SHA64_RE = /^[0-9a-f]{64}$/i;

export type CodingIntegrationGateErrorCode =
  | "NOT_FOUND"
  | "NOT_READY"
  | "INVALID_RESULT"
  | "OWNERSHIP_ESCAPE"
  | "BASE_SHA_MISMATCH"
  | "PATCH_HASH_MISMATCH"
  | "PARALLEL_FILE_CONFLICT";

export class CodingIntegrationGateError extends Error {
  constructor(
    message: string,
    readonly code: CodingIntegrationGateErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CodingIntegrationGateError";
  }
}

export interface CodingIntegrationManifestWorkstream {
  workstreamId: string;
  key: string;
  title: string;
  role: string;
  branchName: string | null;
  baseSha: string | null;
  changedFiles: string[];
  patch: string;
  patchSha256: string | null;
  source: "AI_CANDIDATE" | "LOCAL_DETERMINISTIC" | "NO_CHANGES";
  dependencies: string[];
}

export interface CodingIntegrationManifest {
  version: 1;
  taskId: string;
  graphId: string;
  graphVersion: number;
  planHash: string;
  objective: string;
  baseSha: string | null;
  workstreams: CodingIntegrationManifestWorkstream[];
  changedFiles: string[];
  patchCount: number;
  manifestHash: string;
  nextAction: "REVIEW_INTEGRATION_MANIFEST";
  commitCreated: false;
  pushed: false;
  merged: false;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalHash(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function dependsTransitively(
  byKey: Map<string, { dependencies: string[] }>,
  from: string,
  target: string,
): boolean {
  const seen = new Set<string>();
  const walk = (key: string): boolean => {
    if (seen.has(key)) return false;
    seen.add(key);
    const item = byKey.get(key);
    if (!item) return false;
    if (item.dependencies.includes(target)) return true;
    return item.dependencies.some(walk);
  };
  return walk(from);
}

function topologicalKeys(
  items: Array<{ key: string; dependencies: string[] }>,
): string[] {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const visited = new Set<string>();
  const result: string[] = [];

  const visit = (key: string): void => {
    if (visited.has(key)) return;
    const item = byKey.get(key);
    if (!item) return;
    for (const dependency of [...item.dependencies].sort()) visit(dependency);
    visited.add(key);
    result.push(key);
  };

  for (const item of [...items].sort((a, b) => a.key.localeCompare(b.key))) {
    visit(item.key);
  }
  return result;
}

function extractCandidate(
  workstream: CodingTaskGraphSnapshot["workstreams"][number],
): CodingIntegrationManifestWorkstream {
  const result = record(workstream.resultJson);
  const ai = record(result?.workstreamAiExecution);
  const local = record(result?.localExecution);

  let source: CodingIntegrationManifestWorkstream["source"] = "NO_CHANGES";
  let changedFiles: string[] = [];
  let patch = "";
  let patchSha256: string | null = null;

  if (
    ai?.status === "CANDIDATE_READY" &&
    ai?.reviewStatus !== "APPROVED"
  ) {
    throw new CodingIntegrationGateError(
      `AI candidate for workstream ${workstream.key} has not passed explicit patch review.`,
      "NOT_READY",
      {
        workstreamKey: workstream.key,
        reviewStatus:
          typeof ai.reviewStatus === "string" ? ai.reviewStatus : null,
      },
    );
  }

  if (
    ai?.status === "CANDIDATE_READY" &&
    ai?.reviewStatus === "APPROVED"
  ) {
    source = "AI_CANDIDATE";
    changedFiles = strings(ai.changedFiles);
    patch = typeof ai.patch === "string" ? ai.patch : "";
    patchSha256 =
      typeof ai.patchSha256 === "string" ? ai.patchSha256.toLowerCase() : null;

    if (!patch || !patchSha256 || !SHA64_RE.test(patchSha256)) {
      throw new CodingIntegrationGateError(
        `Approved AI workstream ${workstream.key} is missing its deterministic patch/hash.`,
        "INVALID_RESULT",
        { workstreamKey: workstream.key },
      );
    }
    const computed = sha256(patch);
    if (computed !== patchSha256) {
      throw new CodingIntegrationGateError(
        `Approved AI patch hash changed for ${workstream.key}.`,
        "PATCH_HASH_MISMATCH",
        {
          workstreamKey: workstream.key,
          expected: patchSha256,
          actual: computed,
        },
      );
    }
  } else if (local?.status === "APPLIED") {
    source = "LOCAL_DETERMINISTIC";
    changedFiles = strings(local.changedFiles);
    patch = typeof local.patch === "string" ? local.patch : "";
    if (!patch && changedFiles.length > 0) {
      throw new CodingIntegrationGateError(
        `Deterministic workstream ${workstream.key} is missing its patch.`,
        "INVALID_RESULT",
        { workstreamKey: workstream.key },
      );
    }
    patchSha256 = patch ? sha256(patch) : null;
  }

  const ownershipPaths = workstream.ownershipPaths;
  const outside = changedFiles.filter(
    (file) => !codingWorkstreamOwnsFile(file, ownershipPaths),
  );
  if (outside.length > 0) {
    throw new CodingIntegrationGateError(
      `Workstream ${workstream.key} changed files outside its approved ownership boundary.`,
      "OWNERSHIP_ESCAPE",
      {
        workstreamKey: workstream.key,
        outside,
        ownershipPaths,
      },
    );
  }

  const baseSha = workstream.baseSha?.toLowerCase() ?? null;
  if (changedFiles.length > 0 && (!baseSha || !SHA40_RE.test(baseSha))) {
    throw new CodingIntegrationGateError(
      `Workstream ${workstream.key} is missing a valid base SHA.`,
      "INVALID_RESULT",
      { workstreamKey: workstream.key },
    );
  }

  return {
    workstreamId: workstream.id,
    key: workstream.key,
    title: workstream.title,
    role: workstream.role,
    branchName: workstream.branchName,
    baseSha,
    changedFiles: [...new Set(changedFiles)].sort(),
    patch,
    patchSha256,
    source,
    dependencies: [...workstream.dependencies].sort(),
  };
}

export function buildCodingIntegrationManifest(
  taskId: string,
  snapshot: CodingTaskGraphSnapshot,
): CodingIntegrationManifest {
  if (snapshot.graph.taskId !== taskId) {
    throw new CodingIntegrationGateError(
      "Task graph does not belong to the requested coding task.",
      "NOT_FOUND",
    );
  }
  if (
    snapshot.graph.status !== "COMPLETED" ||
    snapshot.workstreams.some((item) => item.status !== "COMPLETED")
  ) {
    throw new CodingIntegrationGateError(
      "All workstreams must be explicitly reviewed and completed before integration review.",
      "NOT_READY",
      {
        graphStatus: snapshot.graph.status,
        incomplete: snapshot.workstreams
          .filter((item) => item.status !== "COMPLETED")
          .map((item) => ({ key: item.key, status: item.status })),
      },
    );
  }

  const extracted = snapshot.workstreams.map(extractCandidate);
  const baseShas = new Set(
    extracted
      .filter((item) => item.changedFiles.length > 0 && item.baseSha)
      .map((item) => item.baseSha!),
  );
  if (baseShas.size > 1) {
    throw new CodingIntegrationGateError(
      "Completed workstreams do not share the same approved integration base SHA.",
      "BASE_SHA_MISMATCH",
      { baseShas: [...baseShas].sort() },
    );
  }

  const byKey = new Map(
    extracted.map((item) => [item.key, { dependencies: item.dependencies }]),
  );
  const owners = new Map<string, string[]>();
  for (const item of extracted) {
    for (const file of item.changedFiles) {
      const keys = owners.get(file) ?? [];
      keys.push(item.key);
      owners.set(file, keys);
    }
  }

  for (const [file, keys] of owners.entries()) {
    if (keys.length < 2) continue;
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        const left = keys[i]!;
        const right = keys[j]!;
        const ordered =
          dependsTransitively(byKey, left, right) ||
          dependsTransitively(byKey, right, left);
        if (!ordered) {
          throw new CodingIntegrationGateError(
            `Parallel workstreams ${left} and ${right} both changed '${file}'.`,
            "PARALLEL_FILE_CONFLICT",
            { file, left, right },
          );
        }
      }
    }
  }

  const order = topologicalKeys(extracted);
  const byExtractedKey = new Map(extracted.map((item) => [item.key, item]));
  const workstreams = order
    .map((key) => byExtractedKey.get(key))
    .filter((item): item is CodingIntegrationManifestWorkstream => Boolean(item));

  const changedFiles = [...new Set(workstreams.flatMap((item) => item.changedFiles))].sort();
  const manifestCore = {
    version: 1 as const,
    taskId,
    graphId: snapshot.graph.id,
    graphVersion: snapshot.graph.version,
    planHash: snapshot.graph.planHash,
    objective: snapshot.graph.objective,
    baseSha: baseShas.size === 1 ? [...baseShas][0]! : null,
    workstreams: workstreams.map((item) => ({
      workstreamId: item.workstreamId,
      key: item.key,
      branchName: item.branchName,
      baseSha: item.baseSha,
      changedFiles: item.changedFiles,
      patchSha256: item.patchSha256,
      source: item.source,
      dependencies: item.dependencies,
    })),
    changedFiles,
  };

  return {
    ...manifestCore,
    workstreams,
    patchCount: workstreams.filter((item) => Boolean(item.patch)).length,
    manifestHash: canonicalHash(manifestCore),
    nextAction: "REVIEW_INTEGRATION_MANIFEST",
    commitCreated: false,
    pushed: false,
    merged: false,
  };
}

export async function getCodingIntegrationManifest(
  taskId: string,
): Promise<CodingIntegrationManifest> {
  const snapshot = await getLatestCodingTaskGraph(taskId);
  if (!snapshot) {
    throw new CodingIntegrationGateError(
      "Coding task graph not found.",
      "NOT_FOUND",
    );
  }
  return buildCodingIntegrationManifest(taskId, snapshot);
}
