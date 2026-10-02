import { GoogleAuth, type GoogleAuthOptions } from "google-auth-library";

const COMPUTE_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const COMPUTE_API = "https://compute.googleapis.com/compute/v1";
const START_COOLDOWN_MS = 30_000;

let lastStartRequestAt = 0;
let startInFlight: Promise<boolean> | null = null;

interface GcpCodingWorkerConfig {
  enabled: boolean;
  projectId: string;
  zone: string;
  instanceNames: string[];
  credentialJson: string;
}

export function readGcpCodingWorkerConfig(env: NodeJS.ProcessEnv = process.env): GcpCodingWorkerConfig {
  return {
    enabled: (env["GCP_CODING_WORKER_AUTOSTART_ENABLED"] ?? (env["NODE_ENV"] === "production" ? "true" : "false")).trim().toLowerCase() === "true",
    projectId: (env["GCP_CODING_WORKER_PROJECT"] ?? "aicore-505614").trim(),
    zone: (env["GCP_CODING_WORKER_ZONE"] ?? "asia-southeast2-a").trim(),
    instanceNames: (env["GCP_CODING_WORKER_INSTANCES"] ?? "ai-coding-worker-08,ai-coding-worker-11,ai-coding-worker-01,ai-coding-worker-02,ai-coding-worker-03")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    credentialJson:
      (env["GCP_CODING_WORKER_COMPUTE_SA_JSON"] ?? env["GCP_SECRET_MANAGER_BOOTSTRAP_JSON"] ?? "").trim(),
  };
}

function isConfigured(config: GcpCodingWorkerConfig): boolean {
  return Boolean(config.enabled && config.projectId && config.zone && config.instanceNames.length && config.credentialJson);
}

async function accessToken(config: GcpCodingWorkerConfig): Promise<string> {
  let credentials: NonNullable<GoogleAuthOptions["credentials"]>;
  try {
    credentials = JSON.parse(config.credentialJson) as NonNullable<GoogleAuthOptions["credentials"]>;
  } catch {
    throw new Error("GCP coding worker compute credential JSON is invalid");
  }
  const auth = new GoogleAuth({ credentials, scopes: [COMPUTE_SCOPE] });
  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const token = typeof tokenResult === "string" ? tokenResult : tokenResult?.token;
  if (!token) throw new Error("GCP coding worker authentication returned no access token");
  return token;
}

async function getStatus(config: GcpCodingWorkerConfig, name: string, token: string): Promise<string> {
  const url = `${COMPUTE_API}/projects/${encodeURIComponent(config.projectId)}` +
    `/zones/${encodeURIComponent(config.zone)}/instances/${encodeURIComponent(name)}?fields=status`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`GCP coding worker status failed with HTTP ${response.status}`);
  const body = await response.json() as { status?: string };
  return String(body.status ?? "").toUpperCase();
}

async function startInstance(config: GcpCodingWorkerConfig, name: string, token: string): Promise<boolean> {
  const url = `${COMPUTE_API}/projects/${encodeURIComponent(config.projectId)}` +
    `/zones/${encodeURIComponent(config.zone)}/instances/${encodeURIComponent(name)}/start`;
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (response.ok) return true;
  const body = await response.text();
  if (response.status === 400 && /already.*running|resource.*ready|already.*started/i.test(body)) return true;
  throw new Error(`GCP coding worker start failed with HTTP ${response.status}`);
}

async function requestStart(config: GcpCodingWorkerConfig): Promise<boolean> {
  const token = await accessToken(config);
  let firstStopped: string | null = null;
  for (const name of config.instanceNames) {
    const status = await getStatus(config, name, token);
    if (["RUNNING", "STAGING", "PROVISIONING", "REPAIRING"].includes(status)) return true;
    if (!firstStopped && ["TERMINATED", "STOPPED", "SUSPENDED"].includes(status)) firstStopped = name;
  }
  if (!firstStopped) return false;
  return startInstance(config, firstStopped, token);
}

export async function ensureGcpCodingWorkerStarted(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const config = readGcpCodingWorkerConfig(env);
  if (!isConfigured(config)) return false;
  if (Date.now() - lastStartRequestAt < START_COOLDOWN_MS) return true;
  if (startInFlight) return startInFlight;
  startInFlight = requestStart(config)
    .then((started) => { if (started) lastStartRequestAt = Date.now(); return started; })
    .finally(() => { startInFlight = null; });
  return startInFlight;
}
