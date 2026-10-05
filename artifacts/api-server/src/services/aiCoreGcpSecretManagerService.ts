import { GoogleAuth, type GoogleAuthOptions } from "google-auth-library";

const GCP_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const SECRET_MANAGER_API = "https://secretmanager.googleapis.com/v1";
export const AI_CORE_CONSOLIDATED_SECRET_NAME = "aicore-app-secrets";

export type AiCoreGcpSecretOperation =
  | "GCP_SECRET_STATUS"
  | "GCP_SECRET_LIST_KEYS"
  | "GCP_SECRET_UPSERT_KEY"
  | "GCP_SECRET_DELETE_KEY";

export type AiCoreGcpSecretResult = {
  mutating: boolean;
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

function secretHttpError(operation: string, status: number): Error {
  if (status === 403) {
    return new Error(
      `GCP Secret Manager ${operation} permission denied (HTTP 403). Grant the service account only the required Secret Manager role and retry.`,
    );
  }
  if (status === 404) {
    return new Error(
      `GCP Secret Manager secret "${AI_CORE_CONSOLIDATED_SECRET_NAME}" was not found (HTTP 404).`,
    );
  }
  return new Error(`GCP Secret Manager ${operation} failed with HTTP ${status}.`);
}

async function readLatestSecret(
  token: string,
  projectId: string,
): Promise<Record<string, string>> {
  const response = await fetch(`${secretBase(projectId)}/versions/latest:access`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw secretHttpError("read", response.status);

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

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

async function addSecretVersion(
  token: string,
  projectId: string,
  values: Record<string, string>,
): Promise<string | null> {
  const data = Buffer.from(JSON.stringify(values), "utf8").toString("base64");
  const response = await fetch(`${secretBase(projectId)}:addVersion`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload: { data } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw secretHttpError("write", response.status);
  const payload = await response.json().catch(() => ({})) as { name?: string };
  return typeof payload.name === "string" ? payload.name : null;
}

function extractParameter(message: string, name: string): string | null {
  const pattern = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s]+))`,
    "i",
  );
  const match = message.match(pattern);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim() || null;
}

export function parseAiCoreGcpSecretMutation(message: string): {
  key: string;
  value?: string;
} {
  const key = extractParameter(message, "key");
  if (!key || !/^[A-Z][A-Z0-9_]{1,127}$/.test(key)) {
    throw new Error(
      "Secret Manager mutation requires key=ENV_NAME using uppercase letters, numbers, and underscores.",
    );
  }
  const value = extractParameter(message, "value");
  return value == null ? { key } : { key, value };
}

export async function executeAiCoreGcpSecretOperation(input: {
  operation: AiCoreGcpSecretOperation;
  message?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<AiCoreGcpSecretResult> {
  const env = input.env ?? process.env;
  const auth = await accessToken(env);
  const base = secretBase(auth.projectId);

  if (input.operation === "GCP_SECRET_STATUS") {
    const response = await fetch(base, {
      method: "GET",
      headers: { Authorization: `Bearer ${auth.token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw secretHttpError("status", response.status);
    return {
      mutating: false,
      reply: "GCP Secret Manager control plane tersedia untuk aicore-app-secrets.",
      data: {
        projectId: auth.projectId,
        secretName: AI_CORE_CONSOLIDATED_SECRET_NAME,
        configured: true,
        secretValuesExposed: false,
        writePermissionCheckedAtMutation: true,
      },
    };
  }

  const current = await readLatestSecret(auth.token, auth.projectId);

  if (input.operation === "GCP_SECRET_LIST_KEYS") {
    const keys = Object.keys(current).sort();
    return {
      mutating: false,
      reply: `Daftar key ${AI_CORE_CONSOLIDATED_SECRET_NAME} berhasil dibaca tanpa membuka nilainya.`,
      data: {
        projectId: auth.projectId,
        secretName: AI_CORE_CONSOLIDATED_SECRET_NAME,
        keyCount: keys.length,
        keys,
        secretValuesExposed: false,
      },
    };
  }

  const parsed = parseAiCoreGcpSecretMutation(input.message ?? "");

  if (input.operation === "GCP_SECRET_UPSERT_KEY") {
    if (parsed.value == null) {
      throw new Error("Secret Manager upsert requires value=...; the value will not be echoed.");
    }
    const existed = Object.prototype.hasOwnProperty.call(current, parsed.key);
    const next = { ...current, [parsed.key]: parsed.value };
    const versionName = await addSecretVersion(auth.token, auth.projectId, next);
    return {
      mutating: true,
      reply: `Secret key ${parsed.key} berhasil ${existed ? "dirotasi" : "ditambahkan"} tanpa menampilkan nilainya.`,
      data: {
        projectId: auth.projectId,
        secretName: AI_CORE_CONSOLIDATED_SECRET_NAME,
        key: parsed.key,
        change: existed ? "rotated" : "created",
        versionName,
        keyCount: Object.keys(next).length,
        secretValuesExposed: false,
      },
    };
  }

  const existed = Object.prototype.hasOwnProperty.call(current, parsed.key);
  if (!existed) {
    return {
      mutating: false,
      reply: `Secret key ${parsed.key} tidak ada; tidak ada perubahan yang dilakukan.`,
      data: {
        projectId: auth.projectId,
        secretName: AI_CORE_CONSOLIDATED_SECRET_NAME,
        key: parsed.key,
        deleted: false,
        keyCount: Object.keys(current).length,
        secretValuesExposed: false,
      },
    };
  }

  const next = { ...current };
  delete next[parsed.key];
  const versionName = await addSecretVersion(auth.token, auth.projectId, next);
  return {
    mutating: true,
    reply: `Secret key ${parsed.key} berhasil dihapus dari versi aktif berikutnya tanpa menampilkan nilai secret.`,
    data: {
      projectId: auth.projectId,
      secretName: AI_CORE_CONSOLIDATED_SECRET_NAME,
      key: parsed.key,
      deleted: true,
      versionName,
      keyCount: Object.keys(next).length,
      secretValuesExposed: false,
    },
  };
}
