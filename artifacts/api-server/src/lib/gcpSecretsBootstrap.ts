/**
 * GCP Secret Manager bootstrap.
 *
 * Reads GCP_SECRET_MANAGER_BOOTSTRAP_JSON (a service-account JSON blob) and
 * fetches the consolidated secret `aicore-app-secrets` (latest version) from
 * Google Cloud Secret Manager. The secret payload must be a JSON object whose
 * keys are env-var names. Existing environment values normally take precedence,
 * except for canonical production database URLs: those are refreshed from the
 * consolidated GCP secret so a stale Hostinger setting cannot shadow a rotated
 * Supabase credential during a rolling deploy.
 *
 * This runs as the very first thing at startup so that downstream modules
 * (DB connection, auth middleware, etc.) always see the resolved values.
 *
 * Service account requires: roles/secretmanager.secretAccessor (read-only).
 */

import { GoogleAuth, type GoogleAuthOptions } from "google-auth-library";

const CONSOLIDATED_SECRET_NAME = "aicore-app-secrets";

interface SecretAccessResponse {
  payload?: { data?: string };
}

const PRODUCTION_GCP_AUTHORITATIVE_KEYS = new Set([
  "SUPABASE_PROD_DATABASE_URL",
  "SUPABASE_DATABASE_URL",
]);

export function applyGcpApplicationSecrets(
  secretJson: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): { loaded: number; overridden: number; skipped: number } {
  let loaded = 0;
  let overridden = 0;
  let skipped = 0;
  const normalizedEnv = (value: unknown): string =>
    typeof value === "string" ? value.trim().toLowerCase() : "";
  const production =
    normalizedEnv(env["NODE_ENV"]) === "production" ||
    normalizedEnv(env["APP_ENV"]) === "production" ||
    normalizedEnv(secretJson["APP_ENV"]) === "production";

  for (const [key, value] of Object.entries(secretJson)) {
    if (typeof value !== "string") continue;

    const existing = env[key];
    const gcpAuthoritative =
      production && PRODUCTION_GCP_AUTHORITATIVE_KEYS.has(key);

    if (existing && !gcpAuthoritative) {
      skipped += 1;
      continue;
    }

    if (existing && gcpAuthoritative && existing !== value) {
      overridden += 1;
    } else if (!existing) {
      loaded += 1;
    }

    env[key] = value;
  }

  return { loaded, overridden, skipped };
}

export async function bootstrapGcpSecrets(): Promise<void> {
  const bootstrapJson = process.env["GCP_SECRET_MANAGER_BOOTSTRAP_JSON"];

  if (!bootstrapJson) {
    // Not configured — normal in pure-local development.
    return;
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(bootstrapJson) as Record<string, unknown>;
  } catch {
    console.error(
      "[gcp-bootstrap] GCP_SECRET_MANAGER_BOOTSTRAP_JSON is not valid JSON — skipping.",
    );
    return;
  }

  const projectId = credentials["project_id"];
  if (typeof projectId !== "string" || !projectId) {
    console.error(
      "[gcp-bootstrap] Missing project_id in GCP_SECRET_MANAGER_BOOTSTRAP_JSON — skipping.",
    );
    return;
  }

  let auth: GoogleAuth;
  try {
    auth = new GoogleAuth({
      credentials: credentials as NonNullable<GoogleAuthOptions["credentials"]>,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  } catch (err) {
    console.error("[gcp-bootstrap] Failed to create GoogleAuth client:", err);
    return;
  }

  let client: Awaited<ReturnType<typeof auth.getClient>>;
  try {
    client = await auth.getClient();
  } catch (err) {
    console.error("[gcp-bootstrap] Failed to authenticate with GCP:", err);
    return;
  }

  const url =
    `https://secretmanager.googleapis.com/v1/projects/${projectId}` +
    `/secrets/${CONSOLIDATED_SECRET_NAME}/versions/latest:access`;

  let secretJson: Record<string, string> | undefined;
  // Hostinger may start several instances while the GCP billing state is
  // propagating. Retry only temporary service/billing errors; never retry
  // ordinary permission-denied 403 responses or persist secrets to disk.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await client.request<SecretAccessResponse>({ url });
      const b64 = response.data?.payload?.data;
      if (!b64) throw new Error("Secret payload is empty");
      secretJson = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Record<string, string>;
      break;
    } catch (err: unknown) {
      const response = (err as { response?: { status?: number; data?: { error?: { message?: string } } } })?.response;
      const status = response?.status;
      const message = String(response?.data?.error?.message ?? "");
      const transient = status === 429 || status === 500 || status === 502 ||
        status === 503 || status === 504 ||
        (status === 403 && /requires billing to be enabled|billing.*propagat/i.test(message));
      if (transient && attempt < 4) {
        console.warn(`[gcp-bootstrap] Temporary Secret Manager HTTP ${status}; retry ${attempt}/3`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        continue;
      }
      // Avoid logging the raw auth/error object which may contain sensitive data.
      console.error(`[gcp-bootstrap] Secret Manager access failed HTTP ${status ?? "unknown"}; retryable=${transient}`);
      return;
    }
  }
  if (!secretJson) return;

  const applied = applyGcpApplicationSecrets(secretJson);

  console.log(
    `[gcp-bootstrap] Done — loaded=${applied.loaded} overridden=${applied.overridden} skipped(already-set)=${applied.skipped} source=${CONSOLIDATED_SECRET_NAME} project=${projectId}`,
  );
}
