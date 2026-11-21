/**
 * Hard fail-closed guard for the *non-authorizing* CST-DEV Owner UI preview.
 *
 * The existing Review Workspace router eagerly attempts CREATE TABLE on import.
 * A read-only preview must not run that schema initializer. For every normal
 * application runtime, the original initializer is unchanged.
 *
 * This is NOT a DB read-only role, release signature, authenticated Owner
 * approval, dispatcher capability or authorization to expose a POST route.
 * The reverse proxy must separately allowlist only the preview GET endpoints.
 */
export function skipWorkspaceSchemaEnsureForOneJobPreview(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const candidate = env["CST_DEV_ONEJOB_READONLY_PREVIEW"];
  if (candidate == null || candidate === "" || candidate === "false") return false;
  if (candidate !== "true") throw Error("ONEJOB_PREVIEW_INVALID_BOOLEAN");

  const conditions = env["APP_ENV"] === "development" &&
    env["NODE_ENV"] === "development" &&
    env["AI_DEV_BACKGROUND_RUNTIME_ENABLED"] === "false" &&
    env["AI_DISPATCHER_ENABLED"] === "false" &&
    env["OLLAMA_WORKER_RUNTIME_ENABLED"] === "false" &&
    env["AI_SCHEDULER_ENABLED"] === "false" &&
    env["AI_CORE_DEV_CONTINUITY_ENABLED"] === "false" &&
    env["CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED"] === "false" &&
    env["CST_DEV_ONEJOB_BROKER_ENABLED"] === "false" &&
    env["AI_DEV_SAFE_WORKERS_ENABLED"] === "false" &&
    !env["SUPABASE_PROD_DATABASE_URL"] &&
    !env["SUPABASE_DATABASE_URL"] &&
    !env["SUPABASE_SERVICE_ROLE_KEY"] &&
    env["SUPABASE_URL_DEV"] === "https://xssrfshdrtdfupgqwfdw.supabase.co";
  if (!conditions) throw Error("ONEJOB_PREVIEW_UNSAFE_RUNTIME_DENIED");
  return true;
}
