import { GoogleAuth } from "google-auth-library";
import { logger } from "./logger.js";

export const GCP_SECRET_MANAGER_PROJECT_ID = "aicore-505614";
export const GCP_SECRET_MANAGER_SECRET_ID = "aicore-app-secrets";
export const GCP_SECRET_MANAGER_BOOTSTRAP_ENV = "GCP_SECRET_MANAGER_BOOTSTRAP_JSON";

const SECRET_MANAGER_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const SECRET_MANAGER_API = "https://secretmanager.googleapis.com/v1";
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

type JsonRecord = Record<string, unknown>;

export interface LoadedApplicationSecrets {
  projectId: string;
  secretId: string;
  secretVersion: string;
  loadedKeyCount: number;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBootstrapCredential(rawBootstrap: string): JsonRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBootstrap);
  } catch {
    throw new Error("[gcp-secrets] Bootstrap credential is not valid JSON.");
  }

  if (!isJsonRecord(parsed)) {
    throw new Error("[gcp-secrets] Bootstrap credential must be a JSON object.");
  }

  if (
    typeof parsed.client_email !== "string" ||
    parsed.client_email.trim().length === 0 ||
    typeof parsed.private_key !== "string" ||
    parsed.private_key.includes("BEGIN") === false
  ) {
    throw new Error("[gcp-secrets] Bootstrap credential is missing service-account fields.");
  }

  return parsed;
}

function parseApplicationSecrets(rawPayload: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    throw new Error("[gcp-secrets] Secret Manager payload is not valid JSON.");
  }

  if (!isJsonRecord(parsed)) {
    throw new Error("[gcp-secrets] Secret Manager payload must be a JSON object.");
  }

  // Accept either the canonical flat object or a { "secrets": { ... } } wrapper.
  const candidate = isJsonRecord(parsed.secrets) ? parsed.secrets : parsed;
  const applicationSecrets: Record<string, string> = {};

  for (const [key, value] of Object.entries(candidate)) {
    if (key === GCP_SECRET_MANAGER_BOOTSTRAP_ENV || !ENV_KEY_PATTERN.test(key)) {
      continue;
    }

    if (typeof value === "string") {
      applicationSecrets[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      applicationSecrets[key] = String(value);
    }
  }

  if (Object.keys(applicationSecrets).length === 0) {
    throw new Error("[gcp-secrets] Secret Manager payload contains no application secrets.");
  }

  return applicationSecrets;
}

async function getAccessToken(credentials: JsonRecord): Promise<string> {
  const auth = new GoogleAuth({
    credentials: {
      client_email: credentials.client_email as string,
      private_key: credentials.private_key as string,
      ...(typeof credentials.project_id === "string"
        ? { project_id: credentials.project_id }
        : {}),
    },
    scopes: [SECRET_MANAGER_SCOPE],
  });

  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const token = typeof tokenResult === "string" ? tokenResult : tokenResult?.token;

  if (!token) {
    throw new Error("[gcp-secrets] Google authentication returned no access token.");
  }

  return token;
}

async function readLatestSecretVersion(accessToken: string): Promise<string> {
  const secretVersion =
    `projects/${GCP_SECRET_MANAGER_PROJECT_ID}/secrets/` +
    `${GCP_SECRET_MANAGER_SECRET_ID}/versions/latest`;

  let response: Response;
  try {
    response = await fetch(`${SECRET_MANAGER_API}/${secretVersion}:access`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(
      `[gcp-secrets] Secret Manager request failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `[gcp-secrets] Secret Manager access failed with HTTP ${response.status}.`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("[gcp-secrets] Secret Manager returned an invalid response.");
  }

  if (!isJsonRecord(body) || typeof body.payload !== "object" || body.payload === null) {
    throw new Error("[gcp-secrets] Secret Manager response has no payload.");
  }

  const payload = body.payload as JsonRecord;
  if (typeof payload.data !== "string" || payload.data.length === 0) {
    throw new Error("[gcp-secrets] Secret Manager response has no secret data.");
  }

  try {
    return Buffer.from(payload.data, "base64").toString("utf8");
  } catch {
    throw new Error("[gcp-secrets] Secret Manager payload could not be decoded.");
  }
}

/**
 * Loads application secrets before any database- or route-dependent module is
 * imported. Values are only placed in process.env; never log them.
 */
export async function loadApplicationSecrets(): Promise<LoadedApplicationSecrets> {
  const rawBootstrap = process.env[GCP_SECRET_MANAGER_BOOTSTRAP_ENV]?.trim();
  if (!rawBootstrap) {
    throw new Error(
      `[gcp-secrets] ${GCP_SECRET_MANAGER_BOOTSTRAP_ENV} is required at startup.`,
    );
  }

  const credentials = parseBootstrapCredential(rawBootstrap);
  const accessToken = await getAccessToken(credentials);
  const rawPayload = await readLatestSecretVersion(accessToken);
  const applicationSecrets = parseApplicationSecrets(rawPayload);

  for (const [key, value] of Object.entries(applicationSecrets)) {
    process.env[key] = value;
  }

  logger.info(
    {
      projectId: GCP_SECRET_MANAGER_PROJECT_ID,
      secretId: GCP_SECRET_MANAGER_SECRET_ID,
      loadedKeyCount: Object.keys(applicationSecrets).length,
    },
    "[gcp-secrets] Application secrets loaded",
  );

  return {
    projectId: GCP_SECRET_MANAGER_PROJECT_ID,
    secretId: GCP_SECRET_MANAGER_SECRET_ID,
    secretVersion:
      `projects/${GCP_SECRET_MANAGER_PROJECT_ID}/secrets/` +
      `${GCP_SECRET_MANAGER_SECRET_ID}/versions/latest`,
    loadedKeyCount: Object.keys(applicationSecrets).length,
  };
}