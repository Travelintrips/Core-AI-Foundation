import { z } from "zod";

export const CODING_MULTI_TASK_PLAN_VERSION = 1 as const;
export const CODING_MULTI_TASK_MAX_WORKSTREAMS = 20;

const WORKSTREAM_ID_RE = /^WS-[0-9]{3}$/;
const SAFE_PATH_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[A-Za-z0-9._/@*{}\[\]-]+(?:\/[A-Za-z0-9._/@*{}\[\]-]+)*$/;

export const codingWorkstreamRoleSchema = z.enum([
  "database",
  "backend",
  "frontend",
  "tests",
  "security",
  "integration",
  "release",
  "documentation",
  "custom",
]);

export const codingVerificationProfileSchema = z.enum([
  "typecheck",
  "unit_tests",
  "targeted_tests",
  "build",
  "lint",
  "security_tests",
]);

const workstreamSchema = z
  .object({
    id: z.string().regex(WORKSTREAM_ID_RE),
    title: z.string().min(1).max(160),
    role: codingWorkstreamRoleSchema,
    instruction: z.string().min(1).max(6_000),
    dependencies: z.array(z.string().regex(WORKSTREAM_ID_RE)).max(20).default([]),
    ownershipPaths: z
      .array(z.string().min(1).max(500).regex(SAFE_PATH_RE))
      .max(40)
      .default([]),
    acceptanceCriteria: z.array(z.string().min(1).max(500)).min(1).max(20),
    verificationProfiles: z
      .array(codingVerificationProfileSchema)
      .max(6)
      .default([]),
    priority: z.number().int().min(0).max(100).default(50),
  })
  .strict();

export const codingMultiTaskPlanV1Schema = z
  .object({
    version: z.literal(CODING_MULTI_TASK_PLAN_VERSION),
    taskId: z.string().min(1).max(200),
    objective: z.string().min(1).max(8_000),
    workstreams: z
      .array(workstreamSchema)
      .min(1)
      .max(CODING_MULTI_TASK_MAX_WORKSTREAMS),
  })
  .strict();

export type CodingWorkstream = z.infer<typeof workstreamSchema>;
export type CodingMultiTaskPlanV1 = z.infer<typeof codingMultiTaskPlanV1Schema>;

export type CodingMultiTaskPlanErrorCode =
  | "INVALID_SCHEMA"
  | "DUPLICATE_ID"
  | "MISSING_DEPENDENCY"
  | "SELF_DEPENDENCY"
  | "CYCLIC_DEPENDENCY"
  | "OWNERSHIP_CONFLICT";

export class CodingMultiTaskPlanError extends Error {
  constructor(
    message: string,
    readonly code: CodingMultiTaskPlanErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CodingMultiTaskPlanError";
  }
}

function ownershipOverlaps(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\/+$/, "");
  const a = normalize(left);
  const b = normalize(right);
  return (
    a === b ||
    a.startsWith(b + "/") ||
    b.startsWith(a + "/")
  );
}

function assertGraph(plan: CodingMultiTaskPlanV1): void {
  const ids = plan.workstreams.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    throw new CodingMultiTaskPlanError(
      "Workstream IDs must be unique.",
      "DUPLICATE_ID",
    );
  }

  const byId = new Map(plan.workstreams.map((item) => [item.id, item]));
  for (const item of plan.workstreams) {
    if (item.dependencies.includes(item.id)) {
      throw new CodingMultiTaskPlanError(
        `Workstream ${item.id} depends on itself.`,
        "SELF_DEPENDENCY",
        { workstreamId: item.id },
      );
    }
    for (const dependency of item.dependencies) {
      if (!byId.has(dependency)) {
        throw new CodingMultiTaskPlanError(
          `Workstream ${item.id} depends on missing ${dependency}.`,
          "MISSING_DEPENDENCY",
          { workstreamId: item.id, dependency },
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string, stack: string[]): void => {
    if (visiting.has(id)) {
      throw new CodingMultiTaskPlanError(
        "Workstream dependency graph contains a cycle.",
        "CYCLIC_DEPENDENCY",
        { cycle: [...stack, id] },
      );
    }
    if (visited.has(id)) return;

    visiting.add(id);
    const item = byId.get(id)!;
    for (const dependency of item.dependencies) {
      visit(dependency, [...stack, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of ids) visit(id, []);

  // Ownership overlap is allowed only when one workstream is transitively
  // ordered after the other. Parallel workers must not own the same path.
  const dependsTransitively = (from: string, target: string): boolean => {
    const seen = new Set<string>();
    const walk = (id: string): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      const item = byId.get(id);
      if (!item) return false;
      if (item.dependencies.includes(target)) return true;
      return item.dependencies.some(walk);
    };
    return walk(from);
  };

  for (let i = 0; i < plan.workstreams.length; i += 1) {
    for (let j = i + 1; j < plan.workstreams.length; j += 1) {
      const left = plan.workstreams[i]!;
      const right = plan.workstreams[j]!;
      const ordered =
        dependsTransitively(left.id, right.id) ||
        dependsTransitively(right.id, left.id);
      if (ordered) continue;

      for (const a of left.ownershipPaths) {
        for (const b of right.ownershipPaths) {
          if (ownershipOverlaps(a, b)) {
            throw new CodingMultiTaskPlanError(
              `Parallel workstreams ${left.id} and ${right.id} overlap ownership at '${a}' / '${b}'.`,
              "OWNERSHIP_CONFLICT",
              {
                left: left.id,
                right: right.id,
                leftPath: a,
                rightPath: b,
              },
            );
          }
        }
      }
    }
  }
}

export function validateCodingMultiTaskPlanV1(
  value: unknown,
): CodingMultiTaskPlanV1 {
  const parsed = codingMultiTaskPlanV1Schema.safeParse(value);
  if (!parsed.success) {
    throw new CodingMultiTaskPlanError(
      parsed.error.issues
        .map((issue) =>
          `${issue.path.join(".") || "plan"}: ${issue.message}`,
        )
        .join("; "),
      "INVALID_SCHEMA",
    );
  }

  assertGraph(parsed.data);
  return parsed.data;
}

export function topologicalCodingWorkstreams(
  planInput: unknown,
): CodingWorkstream[] {
  const plan = validateCodingMultiTaskPlanV1(planInput);
  const byId = new Map(plan.workstreams.map((item) => [item.id, item]));
  const visited = new Set<string>();
  const result: CodingWorkstream[] = [];

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    const item = byId.get(id)!;
    for (const dependency of [...item.dependencies].sort()) {
      visit(dependency);
    }
    visited.add(id);
    result.push(item);
  };

  for (const item of [...plan.workstreams].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    visit(item.id);
  }

  return result;
}

export function readyCodingWorkstreams(
  planInput: unknown,
  completedIds: Iterable<string>,
): CodingWorkstream[] {
  const plan = validateCodingMultiTaskPlanV1(planInput);
  const completed = new Set(completedIds);
  return plan.workstreams
    .filter(
      (item) =>
        !completed.has(item.id) &&
        item.dependencies.every((dependency) => completed.has(dependency)),
    )
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.id.localeCompare(b.id);
    });
}
