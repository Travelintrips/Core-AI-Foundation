import { GoogleAuth, type GoogleAuthOptions } from "google-auth-library";

const COMPUTE_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const COMPUTE_API = "https://compute.googleapis.com/compute/v1";
const START_COOLDOWN_MS = 60_000;

let lastStartRequestAt = 0;
let startInFlight: Promise<boolean> | null = null;

interface GcpOllamaVmConfig {
  enabled: boolean;
  projectId: string;
  zone: string;
  instanceName: string;
  credentialJson: string;
}

export function readGcpOllamaVmConfig(env: NodeJS.ProcessEnv = process.env): GcpOllamaVmConfig {
  return {
    enabled: (env["GCP_OLLAMA_AUTOSTART_ENABLED"] ?? "false").trim().toLowerCase() === "true",
    projectId: (env["GCP_OLLAMA_VM_PROJECT"] ?? "").trim(),
    zone: (env["GCP_OLLAMA_VM_ZONE"] ?? "").trim(),
    instanceName: (env["GCP_OLLAMA_VM_INSTANCE"] ?? "").trim(),
    credentialJson:
      (env["GCP_OLLAMA_COMPUTE_SA_JSON"] ?? env["GCP_SECRET_MANAGER_BOOTSTRAP_JSON"] ?? "").trim(),
  };
}

function isConfigured(config: GcpOllamaVmConfig): boolean {
  return Boolean(
    config.enabled &&
    config.projectId &&
    config.zone &&
    config.instanceName &&
    config.credentialJson,
  );
}

async function requestStart(config: GcpOllamaVmConfig): Promise<boolean> {
  let credentials: NonNullable<GoogleAuthOptions["credentials"]>;
  try {
    credentials = JSON.parse(config.credentialJson) as NonNullable<GoogleAuthOptions["credentials"]>;
  } catch {
    throw new Error("GCP Ollama compute credential JSON is invalid");
  }

  const auth = new GoogleAuth({ credentials, scopes: [COMPUTE_SCOPE] });
  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const token = typeof tokenResult === "string" ? tokenResult : tokenResult?.token;
  if (!token) throw new Error("GCP Ollama compute authentication returned no access token");

  const url =
    `${COMPUTE_API}/projects/${encodeURIComponent(config.projectId)}` +
    `/zones/${encodeURIComponent(config.zone)}/instances/${encodeURIComponent(config.instanceName)}/start`;

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (response.ok) return true;

  const body = await response.text();
  if (
    response.status === 400 &&
    /already.*running|resource.*ready|already.*started/i.test(body)
  ) {
    return true;
  }

  throw new Error(`GCP Ollama VM start failed with HTTP ${response.status}`);
}

export async function ensureGcpOllamaVmStarted(
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const config = readGcpOllamaVmConfig(env);
  if (!isConfigured(config)) return false;

  if (Date.now() - lastStartRequestAt < START_COOLDOWN_MS) {
    return true;
  }

  if (startInFlight) return startInFlight;

  startInFlight = requestStart(config)
    .then((started) => {
      if (started) lastStartRequestAt = Date.now();
      return started;
    })
    .finally(() => {
      startInFlight = null;
    });

  return startInFlight;
}
