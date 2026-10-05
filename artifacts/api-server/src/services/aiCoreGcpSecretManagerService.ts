import { GoogleAuth, type GoogleAuthOptions } from "google-auth-library";

const GCP_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const SECRET_MANAGER_API = "https://secretmanager.googleapis.com/v1";
export const AI_CORE_CONSOLIDATED_SECRET_NAME = "aicore-app-secrets";

export type AiCoreGcpSecretReadOperation =
  | "GCP_SECRET_STATUS"
  | "GCP_SECRET_LIST_KEYS";

export type AiCoreGcpSecretReadResult = {
  reply: string;
  data: Record<string, unknown>;
};

function parseBootstrapConfig(env: NodeJS.ProcessEnv) {
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

async function accessToken(env: NodeJS.ProcessEnv) {
  const config = parseBootstrapConfig(env);
  const auth = new GoogleAuth({
    credentials: config.credentials,
    scopes: [GCP_SCOPE],
  });
  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const token = typeof tokenResult === "string" ? tokenResult : tokenResult?.token;
  if (!token) throw new Error("GCP Secret Manager authentication returned no access token.");
  return { token, projectId: config.projectId };
}

function secretBase(projectId: string): string {
  return `${SECRET_MANAGER_API}/projects/${encodeURIComponent(projectId)}/secrets/${AI_CORE_CONSOLIDATED_SECRET_NAME}`;
}

function safeHttpError(operation: string, status: number): Error {
  if (status === 403) {
    return new Error(`GCP Secret Manager ${operation} permission denied (HTTP 403).`);
  }
  if (status === 404) {
    return new Error(`GCP Secret Manager secret "${AI_CORE_CONSOLIDATED_SECRET_NAME}" was not found (HTTP 404).`);
  }
  return new Error(`GCP Secret Manager ${operation} failed with HTTP ${status}.`);
}

async function readLatestKeys(
  token: string,
  projectId: string,
): Promise<string[]> {
  const response = await fetch(`${secretBase(projectId)}/versions/latest:access`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw safeHttpError("read", response.status);

  const payload = await response.json() as { payload?: { data?: string } };
  const encoded = payload.payload?.data;
  if (!encoded) throw new Error("GCP Secret Manager latest secret payload is empty.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("GCP Secret Manager latest secret payload is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("GCP Secret Manager consolidated secret payload must be a JSON object.");
  }

  return Object.keys(parsed as Record<string, unknown>).sort();
}

export async function executeAiCoreGcpSecretReadOperation(input: {
  operation: AiCoreGcpSecretReadOperation;
  env?: NodeJS.ProcessEnv;
}): Promise<AiCoreGcpSecretReadResult> {
  const env = input.env ?? process.env;
  const auth = await accessToken(env);
  const base = secretBase(auth.projectId);

  if (input.operation === "GCP_SECRET_STATUS") {
    const response = await fetch(base, {
      method: "GET",
      headers: { Authorization: `Bearer ${auth.token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw safeHttpError("status", response.status);
    return {
      reply: "GCP Secret Manager tersedia untuk aicore-app-secrets.",
      data: {
        projectId: auth.projectId,
        secretName: AI_CORE_CONSOLIDATED_SECRET_NAME,
        configured: true,
        secretValuesExposed: false,
        writeViaAiChatEnabled: false,
      },
    };
  }

  const keys = await readLatestKeys(auth.token, auth.projectId);
  return {
    reply: `Daftar key ${AI_CORE_CONSOLIDATED_SECRET_NAME} berhasil dibaca tanpa membuka nilainya.`,
    data: {
      projectId: auth.projectId,
      secretName: AI_CORE_CONSOLIDATED_SECRET_NAME,
      keyCount: keys.length,
      keys,
      secretValuesExposed: false,
      writeViaAiChatEnabled: false,
    },
  };
}
