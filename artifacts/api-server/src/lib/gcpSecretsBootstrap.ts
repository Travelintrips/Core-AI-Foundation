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
  const production = env["NODE_ENV"] === "production";

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

  let secretJson: Record<string, string>;
  try {
    const response = await client.request<SecretAccessResponse>({ url });
    const b64 = response.data?.payload?.data;
    if (!b64) {
      console.error(`[gcp-bootstrap] Secret "${CONSOLIDATED_SECRET_NAME}" returned empty payload — skipping.`);
      return;
    }
    const raw = Buffer.from(b64, "base64").toString("utf8");
    secretJson = JSON.parse(raw) as Record<string, string>;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      console.warn(`[gcp-bootstrap] Secret "${CONSOLIDATED_SECRET_NAME}" not found in project ${projectId} — skipping.`);
    } else {
      console.error(`[gcp-bootstrap] Could not fetch secret "${CONSOLIDATED_SECRET_NAME}" (HTTP ${status ?? "?"})`, err);
    }
    return;
  }

  const applied = applyGcpApplicationSecrets(secretJson);

  console.log(
    `[gcp-bootstrap] Done — loaded=${applied.loaded} overridden=${applied.overridden} skipped(already-set)=${applied.skipped} source=${CONSOLIDATED_SECRET_NAME} project=${projectId}`,
  );
}
