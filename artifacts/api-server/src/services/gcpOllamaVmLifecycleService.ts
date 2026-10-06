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
  remoteAutoStopEnabled: boolean;
}

export function readGcpOllamaVmConfig(env: NodeJS.ProcessEnv = process.env): GcpOllamaVmConfig {
  const explicitEnabled = env["GCP_OLLAMA_AUTOSTART_ENABLED"];
  const production = env["NODE_ENV"] === "production";
  const credentialJson = (
    env["GCP_AI_CORE_COMPUTE_SA_JSON"] ??
    env["GCP_CODING_WORKER_COMPUTE_SA_JSON"] ??
    env["GCP_OLLAMA_COMPUTE_SA_JSON"] ??
    // The AI Core bootstrap service account already has the scoped
    // aiCoreGpuController role in the Ollama project. Reusing it avoids a
    // second long-lived compute credential in Hostinger.
    env["GCP_SECRET_MANAGER_BOOTSTRAP_JSON"] ??
    ""
  ).trim();

  return {
    enabled:
      explicitEnabled != null
        ? explicitEnabled.trim().toLowerCase() === "true"
        : production && Boolean(credentialJson),
    projectId: (env["GCP_OLLAMA_VM_PROJECT"] ?? "ollama-510011").trim(),
    zone: (env["GCP_OLLAMA_VM_ZONE"] ?? "asia-northeast1-c").trim(),
    instanceName: (
      env["GCP_OLLAMA_VM_INSTANCE"] ?? "instance-20260928-124118"
    ).trim(),
    credentialJson,
    idleShutdownMs: Math.max(
      60_000,
      Number.parseInt(env["GCP_OLLAMA_IDLE_SHUTDOWN_MS"] ?? "", 10) || DEFAULT_IDLE_SHUTDOWN_MS,
    ),
    // Keep API-host auto-stop opt-in. A shared GPU VM may also run ComfyUI or
    // other workloads invisible to the Ollama worker registry. In that setup
    // the VM-local idle guard is the only safe authority to power the VM off.
    remoteAutoStopEnabled:
      (env["GCP_OLLAMA_REMOTE_AUTOSTOP_ENABLED"] ?? "false").trim().toLowerCase() === "true",
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

async function authenticatedClient(config: GcpOllamaVmConfig) {
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
  return token;
}

function vmBaseUrl(config: GcpOllamaVmConfig): string {
  return `${COMPUTE_API}/projects/${encodeURIComponent(config.projectId)}` +
    `/zones/${encodeURIComponent(config.zone)}/instances/${encodeURIComponent(config.instanceName)}`;
}

async function readVmStatus(config: GcpOllamaVmConfig): Promise<string | null> {
  const token = await authenticatedClient(config);
  const response = await fetch(vmBaseUrl(config), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`GCP Ollama VM status failed with HTTP ${response.status}`);
  }
  const data = await response.json() as { status?: unknown };
  return typeof data.status === "string" ? data.status.trim().toUpperCase() : null;
}

export function shouldIssueGcpOllamaVmStart(
  vmStatus: string | null,
  now: number,
  previousStartRequestAt: number,
  cooldownMs = START_COOLDOWN_MS,
): boolean {
  const status = (vmStatus ?? "").trim().toUpperCase();
  if (["RUNNING", "PROVISIONING", "STAGING"].includes(status)) return false;
  // A terminated VM must never be hidden behind an in-process cooldown. The
  // previous start may have been accepted by Compute Engine but failed or the
  // instance may have been stopped by another control plane afterwards.
  if (status === "TERMINATED") return true;
  return now - previousStartRequestAt >= cooldownMs;
}

async function readVmLastStartAt(config: GcpOllamaVmConfig): Promise<number> {
  const token = await authenticatedClient(config);
  const response = await fetch(vmBaseUrl(config), { method: "GET", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`GCP Ollama VM status failed with HTTP ${response.status}`);
  const data = await response.json() as { lastStartTimestamp?: unknown };
  const parsed = data.lastStartTimestamp ? new Date(String(data.lastStartTimestamp)).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isGcpOllamaVmWithinStartupGrace(lastStartAt: number, now: number, idleShutdownMs: number): boolean {
  return lastStartAt > 0 && now >= lastStartAt && now - lastStartAt < idleShutdownMs;
}

async function authenticatedVmRequest(
  config: GcpOllamaVmConfig,
  action: "start" | "stop",
): Promise<boolean> {
  const token = await authenticatedClient(config);
  const url = `${vmBaseUrl(config)}/${action}`;

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

  if (startInFlight) return startInFlight;

  const now = Date.now();
  const vmStatus = await readVmStatus(config).catch(() => null);
  if (!shouldIssueGcpOllamaVmStart(vmStatus, now, lastStartRequestAt)) {
    return true;
  }

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
  if (!isConfigured(config) || !config.remoteAutoStopEnabled) return false;

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

  // Protect starts performed by the separate infrastructure control plane too.
  // Compute Engine persists this timestamp, so process restarts cannot erase the grace period.
  const vmLastStartAt = await readVmLastStartAt(config);
  if (isGcpOllamaVmWithinStartupGrace(vmLastStartAt, now, config.idleShutdownMs)) return false;
  if (lastActivity > 0 && now - lastActivity < config.idleShutdownMs) return false;
  if (active <= 0 && lastStartRequestAt > 0 && now - lastStartRequestAt < config.idleShutdownMs) return false;

  return authenticatedVmRequest(config, "stop");
}
