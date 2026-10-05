import { GoogleAuth, type GoogleAuthOptions } from "google-auth-library";

const GCP_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const SECRET_MANAGER_API = "https://secretmanager.googleapis.com/v1";
const CONSOLIDATED_SECRET_NAME = "aicore-app-secrets";

export const PROVIDER_SECRET_ADMIN_KEYS = [
  "OPENAI_ADMIN_KEY",
  "OPENAI_MONTHLY_BUDGET_USD",
  "ANTHROPIC_ADMIN_KEY",
  "ANTHROPIC_MONTHLY_BUDGET_USD",
  "GEMINI_BILLING_PROJECT_ID",
  "GEMINI_MONTHLY_BUDGET",
  "AI_PROVIDER_BILLING_ALERT_PERCENT",
] as const;

export type ProviderSecretAdminKey = typeof PROVIDER_SECRET_ADMIN_KEYS[number];

export type ProviderSecretAdminStatus = {
  secretName: string;
  projectId: string;
  configuredKeys: ProviderSecretAdminKey[];
  missingKeys: ProviderSecretAdminKey[];
  secretValuesExposed: false;
};

function isAllowedKey(value: string): value is ProviderSecretAdminKey {
  return (PROVIDER_SECRET_ADMIN_KEYS as readonly string[]).includes(value);
}

function parseBootstrapCredential(env: NodeJS.ProcessEnv) {
  const raw = (env["GCP_SECRET_MANAGER_BOOTSTRAP_JSON"] ?? "").trim();
  if (!raw) {
    throw new Error("GCP Secret Manager bootstrap credential is not configured.");
  }

  let credentials: NonNullable<GoogleAuthOptions["credentials"]>;
  try {
    credentials = JSON.parse(raw) as NonNullable<GoogleAuthOptions["credentials"]>;
  } catch {
    throw new Error("GCP Secret Manager bootstrap credential JSON is invalid.");
  }

  const projectId =
    typeof (credentials as Record<string, unknown>)["project_id"] === "string"
      ? String((credentials as Record<string, unknown>)["project_id"]).trim()
      : "";
  if (!projectId) {
    throw new Error("GCP Secret Manager bootstrap credential has no project_id.");
  }

  return { credentials, projectId };
}

async function getAuth(env: NodeJS.ProcessEnv) {
  const config = parseBootstrapCredential(env);
  const auth = new GoogleAuth({
    credentials: config.credentials,
    scopes: [GCP_SCOPE],
  });
  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const token = typeof tokenResult === "string" ? tokenResult : tokenResult?.token;
  if (!token) {
    throw new Error("GCP Secret Manager authentication returned no access token.");
  }
  return { token, projectId: config.projectId };
}

function baseUrl(projectId: string): string {
  return `${SECRET_MANAGER_API}/projects/${encodeURIComponent(projectId)}/secrets/${CONSOLIDATED_SECRET_NAME}`;
}

function safeHttpError(action: "read" | "write", status: number): Error {
  if (status === 403) {
    return new Error(
      action === "write"
        ? "GCP Secret Manager write permission denied. Grant secretmanager.versions.add for aicore-app-secrets."
        : "GCP Secret Manager read permission denied.",
    );
  }
  if (status === 404) {
    return new Error(`GCP Secret Manager secret "${CONSOLIDATED_SECRET_NAME}" was not found.`);
  }
  return new Error(`GCP Secret Manager ${action} failed with HTTP ${status}.`);
}

async function readLatestSecret(
  token: string,
  projectId: string,
): Promise<Record<string, string>> {
  const response = await fetch(`${baseUrl(projectId)}/versions/latest:access`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw safeHttpError("read", response.status);

  const payload = await response.json() as { payload?: { data?: string } };
  const encoded = payload.payload?.data;
  if (!encoded) throw new Error("GCP Secret Manager latest payload is empty.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("GCP Secret Manager consolidated payload is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("GCP Secret Manager consolidated payload must be a JSON object.");
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

async function addSecretVersion(
  token: string,
  projectId: string,
  payload: Record<string, string>,
): Promise<string | null> {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const response = await fetch(`${baseUrl(projectId)}:addVersion`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload: { data: encoded } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw safeHttpError("write", response.status);

  const body = await response.json().catch(() => ({})) as { name?: string };
  return typeof body.name === "string" ? body.name : null;
}

function validateValue(key: ProviderSecretAdminKey, raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("Secret/config value cannot be empty.");
  if (value.length > 16_384) throw new Error("Secret/config value is too large.");

  if (
    key === "OPENAI_MONTHLY_BUDGET_USD" ||
    key === "ANTHROPIC_MONTHLY_BUDGET_USD" ||
    key === "GEMINI_MONTHLY_BUDGET"
  ) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Budget must be a positive number.");
    }
  }
  if (key === "AI_PROVIDER_BILLING_ALERT_PERCENT") {
    const percent = Number(value);
    if (!Number.isFinite(percent) || percent < 1 || percent > 99) {
      throw new Error("Alert threshold must be between 1 and 99.");
    }
  }
  return value;
}

export async function getProviderSecretAdminStatus(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderSecretAdminStatus> {
  const auth = await getAuth(env);
  const current = await readLatestSecret(auth.token, auth.projectId);
  const configuredKeys = PROVIDER_SECRET_ADMIN_KEYS.filter((key) =>
    Boolean((current[key] ?? "").trim()),
  );
  const missingKeys = PROVIDER_SECRET_ADMIN_KEYS.filter(
    (key) => !configuredKeys.includes(key),
  );

  return {
    secretName: CONSOLIDATED_SECRET_NAME,
    projectId: auth.projectId,
    configuredKeys: [...configuredKeys],
    missingKeys: [...missingKeys],
    secretValuesExposed: false,
  };
}

export async function upsertProviderSecretAdminValue(input: {
  key: string;
  value: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{
  key: ProviderSecretAdminKey;
  created: boolean;
  versionName: string | null;
  secretValuesExposed: false;
}> {
  if (!isAllowedKey(input.key)) {
    throw new Error("Secret/config key is not allowed by Secure Secret Admin.");
  }
  const value = validateValue(input.key, input.value);
  const env = input.env ?? process.env;
  const auth = await getAuth(env);
  const current = await readLatestSecret(auth.token, auth.projectId);
  const created = !Object.prototype.hasOwnProperty.call(current, input.key);
  const next = { ...current, [input.key]: value };
  const versionName = await addSecretVersion(auth.token, auth.projectId, next);

  return {
    key: input.key,
    created,
    versionName,
    secretValuesExposed: false,
  };
}
