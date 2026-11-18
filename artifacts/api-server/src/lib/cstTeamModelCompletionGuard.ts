/** Guard for the one-job CST-DEV model pilot completion event.
 * This only classifies evidence; it never dispatches, grants or signs.
 * Existing non-pilot job completion paths must remain unchanged.
 */
export type ModelCompletionMode = "ordinary" | "await_persist" | "blocked";
export type ModelJobForCompletion = {
  id: number; jobType: string; payloadJson: unknown;
};
export type ModelWorkerForCompletion = {
  id: number; workerName: string; workerType: string;
  providerSlug: string | null; runtimeKind: string | null;
  modelId: string | null; capabilities: unknown;
};
/** Exact DEV pilot ID is reserved even when an RLS policy hides the row.
 * A missing SELECT must NEVER turn the reserved pilot into ordinary completion.
 */
export function isExactCstDevModelPilotJobId(
  jobId: number,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Number.isSafeInteger(jobId) && jobId > 0 &&
    env.APP_ENV === "development" && env.NODE_ENV === "development" &&
    env.CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED === "true" &&
    env.CST_TEAM_DEV_APPROVED_JOB_ID === String(jobId);
}

export function classifyCstDevModelCompletion(
  job: ModelJobForCompletion | null | undefined,
  worker: ModelWorkerForCompletion | null | undefined,
  workerId: number,
  env: NodeJS.ProcessEnv = process.env,
): ModelCompletionMode {
  if (env.APP_ENV !== "development" || env.NODE_ENV !== "development" ||
      env.CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED !== "true" ||
      !job || job.jobType !== "ollama_model_invocation") return "ordinary";
  const payload = job.payloadJson;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "ordinary";
  const p = payload as Record<string, unknown>;
  if (typeof p.requestId !== "string" ||
      !p.requestId.startsWith("cst-ai-team-company1-dev:")) return "ordinary";
  // Any Company-1 pilot job with the flag enabled MUST NOT silently fall
  // back to fire-and-forget event publishing when identity evidence is wrong.
  if (!/^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$/.test(p.requestId) ||
      p.modelId !== "qwen2.5:3b" ||
      !Number.isSafeInteger(job.id) || job.id < 1 ||
      env.CST_TEAM_DEV_APPROVED_JOB_ID !== String(job.id) ||
      !worker || !Number.isSafeInteger(workerId) || workerId < 1 ||
      worker.id !== workerId ||
      !worker.workerName.startsWith("cst-dev-dell-onejob-") ||
      env.CST_TEAM_DEV_APPROVED_WORKER_NAME !== worker.workerName ||
      worker.workerType !== "coding_worker" ||
      worker.providerSlug !== "ollama" || worker.runtimeKind !== "ollama_remote_pull" ||
      worker.modelId !== "qwen2.5:3b" ||
      !Array.isArray(worker.capabilities) || worker.capabilities.length !== 1 ||
      worker.capabilities[0] !== "ollama_inference" ||
      String(p._claimedByWorkerId ?? "") !== String(workerId)) {
    return "blocked";
  }
  return "await_persist";
}
