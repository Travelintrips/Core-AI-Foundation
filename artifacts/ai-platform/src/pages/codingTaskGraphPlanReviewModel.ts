export interface CodingTaskGraphPlanWorkstreamInput {
  id: string;
  key: string;
  title: string;
  role: string;
  instruction: string;
  status: string;
  priority: number;
  ownershipPaths: string[];
  acceptanceCriteria: string[];
  verificationProfiles: string[];
  dependencies: string[];
}

export interface CodingTaskGraphPlanWorkstreamReview {
  id: string;
  key: string;
  title: string;
  role: string;
  instruction: string;
  status: string;
  priority: number;
  ownershipPaths: string[];
  acceptanceCriteria: string[];
  verificationProfiles: string[];
  dependencies: string[];
  complete: boolean;
  issues: string[];
}

export interface CodingTaskGraphPlanReviewModel {
  workstreams: CodingTaskGraphPlanWorkstreamReview[];
  completeForApproval: boolean;
  issues: string[];
  rootWorkstreams: string[];
  dependencyEdges: number;
}

function nonEmptyStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

export function buildCodingTaskGraphPlanReviewModel(
  input: CodingTaskGraphPlanWorkstreamInput[] | null | undefined,
): CodingTaskGraphPlanReviewModel {
  const source = Array.isArray(input) ? input : [];
  const keys = new Set<string>();
  const duplicateKeys = new Set<string>();

  for (const item of source) {
    if (keys.has(item.key)) duplicateKeys.add(item.key);
    keys.add(item.key);
  }

  const reviews = source.map((item) => {
    const issues: string[] = [];
    const ownershipPaths = nonEmptyStrings(item.ownershipPaths);
    const acceptanceCriteria = nonEmptyStrings(item.acceptanceCriteria);
    const verificationProfiles = nonEmptyStrings(item.verificationProfiles);
    const dependencies = nonEmptyStrings(item.dependencies);

    if (!item.key.trim()) issues.push("missing workstream key");
    if (!item.title.trim()) issues.push("missing title");
    if (!item.role.trim()) issues.push("missing role");
    if (!item.instruction.trim()) issues.push("missing instruction");
    if (
      !Number.isInteger(item.priority) ||
      item.priority < 0 ||
      item.priority > 100
    ) {
      issues.push("priority must be an integer between 0 and 100");
    }
    if (ownershipPaths.length === 0) {
      issues.push("missing ownership boundary");
    }
    if (acceptanceCriteria.length === 0) {
      issues.push("missing acceptance criteria");
    }
    if (verificationProfiles.length === 0) {
      issues.push("missing verification profile");
    }
    if (duplicateKeys.has(item.key)) {
      issues.push("duplicate workstream key");
    }
    for (const dependency of dependencies) {
      if (!keys.has(dependency)) {
        issues.push(`unknown dependency ${dependency}`);
      }
      if (dependency === item.key) {
        issues.push("self dependency");
      }
    }

    return {
      id: item.id,
      key: item.key,
      title: item.title,
      role: item.role,
      instruction: item.instruction,
      status: item.status,
      priority: item.priority,
      ownershipPaths,
      acceptanceCriteria,
      verificationProfiles,
      dependencies,
      complete: issues.length === 0,
      issues,
    };
  });

  const issues = [
    ...(source.length === 0 ? ["task graph has no workstreams"] : []),
    ...reviews.flatMap((item) =>
      item.issues.map((issue) => `${item.key || item.id}: ${issue}`),
    ),
  ];

  return {
    workstreams: reviews,
    completeForApproval: reviews.length > 0 && issues.length === 0,
    issues,
    rootWorkstreams: reviews
      .filter((item) => item.dependencies.length === 0)
      .map((item) => item.key),
    dependencyEdges: reviews.reduce(
      (sum, item) => sum + item.dependencies.length,
      0,
    ),
  };
}
