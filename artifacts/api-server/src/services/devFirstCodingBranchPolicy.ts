/** Enforce a DEV-first base for new coding jobs in Core-AI-Foundation. */
export const CORE_AI_REPOSITORY = "Travelintrips/Core-AI-Foundation";
export const CORE_AI_DEVELOP_BRANCH = "develop";

export function resolveNewCodingJobBranch(
  repository: string | undefined,
  requestedBranch: string | undefined,
): string | undefined {
  if (repository !== CORE_AI_REPOSITORY) return requestedBranch;
  if (!requestedBranch || requestedBranch === CORE_AI_DEVELOP_BRANCH) {
    return CORE_AI_DEVELOP_BRANCH;
  }
  throw new Error(
    "AI Core coding jobs must start on develop. A separate reviewed promotion is required for main/PROD.",
  );
}
