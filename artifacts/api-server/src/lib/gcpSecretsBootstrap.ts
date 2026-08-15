/**
 * GCP Secret Manager bootstrap.
 *
 * Reads GCP_SECRET_MANAGER_BOOTSTRAP_JSON (a service-account JSON blob) and,
 * for each secret in GCP_SECRET_NAMES, fetches the latest version from
 * Google Cloud Secret Manager and injects it into process.env — but only
 * when the environment variable is not already set.
 *
 * This runs as the very first thing at startup so that downstream modules
 * (DB connection, auth middleware, etc.) always see the resolved values.
 */

import { GoogleAuth } from "google-auth-library";

/**
 * Secrets to pull from GCP Secret Manager.
 * The GCP secret name must match the env-var name exactly.
 * Secrets that are already present in process.env are skipped.
 */
const GCP_SECRET_NAMES: string[] = [
  "SUPABASE_PROD_DATABASE_URL",
  "ADMIN_API_KEY",
  "VITE_ADMIN_API_KEY",
  "SESSION_SECRET",
  "SMTP_PASSWORD",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "REPLICATE_API_TOKEN",
  "COHERE_API_KEY",
];

interface SecretAccessResponse {
  payload?: { data?: string };
}

export async function bootstrapGcpSecrets(): Promise<void> {
  const bootstrapJson = process.env["GCP_SECRET_MANAGER_BOOTSTRAP_JSON"];

  if (!bootstrapJson) {
    // Not configured — normal in development.
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
      credentials: credentials as Parameters<typeof GoogleAuth>[0]["credentials"],
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

  let loaded = 0;
  let skipped = 0;
  let missing = 0;

  for (const secretName of GCP_SECRET_NAMES) {
    // If already set (e.g. injected by Replit Secrets), respect that value.
    if (process.env[secretName]) {
      skipped++;
      continue;
    }

    const url =
      `https://secretmanager.googleapis.com/v1/projects/${projectId}` +
      `/secrets/${secretName}/versions/latest:access`;

    try {
      const response = await client.request<SecretAccessResponse>({ url });
      const b64 = response.data?.payload?.data;
      if (b64) {
        process.env[secretName] = Buffer.from(b64, "base64").toString("utf8");
        loaded++;
      } else {
        console.warn(`[gcp-bootstrap] Secret "${secretName}" returned empty payload.`);
        missing++;
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        // Secret doesn't exist in GCP — not necessarily an error.
        missing++;
      } else {
        console.warn(`[gcp-bootstrap] Could not fetch secret "${secretName}" (HTTP ${status ?? "?"})`, err);
        missing++;
      }
    }
  }

  console.log(
    `[gcp-bootstrap] Done — loaded=${loaded} skipped(already-set)=${skipped} not-found=${missing} project=${projectId}`,
  );
}
