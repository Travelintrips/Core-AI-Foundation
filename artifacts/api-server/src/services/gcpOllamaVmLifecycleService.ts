import { GoogleAuth, type GoogleAuthOptions } from "google-auth-library";

const COMPUTE_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const COMPUTE_API = "https://compute.googleapis.com/compute/v1";
const START_COOLDOWN_MS = 60_000;
const DEFAULT_IDLE_SHUTDOWN_MS = 5 * 60_000;

let lastStartRequestAt = 0;
let startInFlight: Promise<boolean> | null = null;

interface GcpOllamaVmConfig {
  enabled: boolean;
  projectId: string;
  zone: string;
  instanceName: string;
  credentialJson: string;
  idleShutdownMs: number;
}

export function readGcpOllamaVmConfig(env: NodeJS.ProcessEnv = process.env): GcpOllamaVmConfig {
  return {
    enabled: (env["GCP_OLLAMA_AUTOSTART_ENABLED"] ?? "false").trim().toLowerCase() === "true",
    projectId: (env["GCP_OLLAMA_VM_PROJECT"] ?? "").trim(),
    zone: (env["GCP_OLLAMA_VM_ZONE"] ?? "").trim(),
    instanceName: (env["GCP_OLLAMA_VM_INSTANCE"] ?? "").trim(),
    credentialJson:
      (env["GCP_AI_CORE_COMPUTE_SA_JSON"] ??
        env["GCP_CODING_WORKER_COMPUTE_SA_JSON"] ??
        env["GCP_OLLAMA_COMPUTE_SA_JSON"] ?? "").trim(),
    idleShutdownMs: Math.max(
      60_000,
      Number.parseInt(env["GCP_OLLAMA_IDLE_SHUTDOWN_MS"] ?? "", 10) || DEFAULT_IDLE_SHUTDOWN_MS,
    ),
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

async function authenticatedVmRequest(
  config: GcpOllamaVmConfig,
  action: "start" | "stop",
): Promise<boolean> {
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
    `/zones/${encodeURIComponent(config.zone)}/instances/${encodeURIComponent(config.instanceName)}/${action}`;

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

  throw new Error(`GCP Ollama VM ${action} failed with HTTP ${response.status}`);
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

  startInFlight = authenticatedVmRequest(config, "start")
    .then((started) => {
      if (started) lastStartRequestAt = Date.now();
      return started;
    })
    .finally(() => {
      startInFlight = null;
    });

  return startInFlight;
}


export async function stopGcpOllamaVmIfIdle(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<boolean> {
  const config = readGcpOllamaVmConfig(env);
  if (!isConfigured(config)) return false;

  const { db } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");
  const raw = await db.execute(sql`
    SELECT COUNT(*)::int AS active_jobs,
           MAX(updated_at) AS last_activity_at
    FROM ai_platform.ai_workers
    WHERE provider_slug = 'ollama'
      AND runtime_kind = 'ollama_worker'
  `);
  const row = (raw as unknown as { rows?: Array<{ active_jobs?: unknown; last_activity_at?: unknown }> }).rows?.[0];
  const active = Number(row?.active_jobs ?? 0);
  const lastActivity = row?.last_activity_at ? new Date(String(row.last_activity_at)).getTime() : 0;

  const busyRaw = await db.execute(sql`
    SELECT COALESCE(SUM(running_jobs), 0)::int AS running_jobs
    FROM ai_platform.ai_workers
    WHERE provider_slug = 'ollama'
      AND runtime_kind = 'ollama_worker'
  `);
  const runningJobs = Number((busyRaw as unknown as { rows?: Array<{ running_jobs?: unknown }> }).rows?.[0]?.running_jobs ?? 0);
  if (runningJobs > 0) return false;
  if (lastActivity > 0 && now - lastActivity < config.idleShutdownMs) return false;
  if (active <= 0 && lastStartRequestAt > 0 && now - lastStartRequestAt < config.idleShutdownMs) return false;

  return authenticatedVmRequest(config, "stop");
}
