/** Read-only CST-DEV remote-model admission preflight.
 * A successful permission check can NEVER authorize or start a worker.
 * This is deliberately not a migration, grant, secret issuer, or dispatcher.
 */
export const CST_MODEL_ADMISSION_REQUIREMENTS = [
  "DEV_RUNTIME_AND_PROJECT_VERIFIED",
  "APP_ROLE_EXPECTED",
  "JOBS_RLS_ENABLED",
  "WORKERS_RLS_ENABLED",
  "JOBS_SELECT_GRANT",
  "JOBS_INSERT_GRANT",
  "JOBS_REQUIRED_UPDATE_COLUMNS",
  "WORKERS_SELECT_GRANT",
  "WORKERS_INSERT_GRANT",
  "WORKERS_UPDATE_GRANT",
  "JOBS_MODEL_SELECT_RLS",
  "JOBS_MODEL_INSERT_RLS",
  "JOBS_MODEL_UPDATE_RLS",
  "WORKERS_REMOTE_SELECT_RLS",
  "WORKERS_REMOTE_INSERT_RLS",
  "WORKERS_REMOTE_UPDATE_RLS",
] as const;
export type CstModelAdmissionRequirement = typeof CST_MODEL_ADMISSION_REQUIREMENTS[number];
export type CstModelAdmissionChecks = Record<CstModelAdmissionRequirement, boolean>;
export function projectCstModelAdmissionReadiness(
  checks: Partial<CstModelAdmissionChecks>,
  checkedAt: Date = new Date(),
) {
  const blockers = CST_MODEL_ADMISSION_REQUIREMENTS.filter(key => checks[key] !== true);
  return {
    mode: "CST_DEV_READ_ONLY_RLS_PREFLIGHT_NOT_AUTHORIZATION" as const,
    checkedAt: checkedAt.toISOString(),
    status: blockers.length ? "blocked" as const : "review_required" as const,
    verifiedOperationalWorker: false as const,
    eligibleToDispatch: false as const,
    requiredChecks: CST_MODEL_ADMISSION_REQUIREMENTS.length,
    passedChecks: CST_MODEL_ADMISSION_REQUIREMENTS.length - blockers.length,
    blockers,
  };
}
