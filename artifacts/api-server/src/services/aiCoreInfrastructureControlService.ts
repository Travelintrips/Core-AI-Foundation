import { GoogleAuth, type GoogleAuthOptions } from "google-auth-library";

const GCP_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const GCP_COMPUTE_API = "https://compute.googleapis.com/compute/v1";
const HOSTINGER_API_BASES = ["https://developers.hostinger.com/api", "https://api.hostinger.com/api"] as const;

export type AiCoreInfrastructureOperation =
  | "GCP_VM_STATUS"
  | "GCP_VM_START"
  | "GCP_VM_STOP"
  | "GCP_VM_RESTART"
  | "HOSTINGER_VPS_STATUS"
  | "HOSTINGER_VPS_START"
  | "HOSTINGER_VPS_STOP"
  | "HOSTINGER_VPS_RESTART"
  | "HOSTINGER_DOCKER_STATUS"
  | "HOSTINGER_DOCKER_RESTART"
  | "EXTERNAL_AGENT_STATUS";

export type AiCoreInfrastructureResult = {
  operation: AiCoreInfrastructureOperation;
  provider: "gcp" | "hostinger" | "ai-core";
  mutating: boolean;
  reply: string;
  data: unknown;
};

function normalizedMessage(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

function actionOf(text: string): "status" | "start" | "stop" | "restart" | null {
  if (/\b(restart|reboot|mulai ulang)\b/i.test(text)) return "restart";
  if (/\b(stop|matikan|shutdown|hentikan)\b/i.test(text)) return "stop";
  if (/\b(start|nyalakan|hidupkan|jalankan)\b/i.test(text)) return "start";
  if (/\b(cek|check|status|health|inspect|periksa|lihat)\b/i.test(text)) return "status";
  return null;
}

export function detectAiCoreInfrastructureOperation(
  message: string,
): AiCoreInfrastructureOperation | null {
  const text = normalizedMessage(message);
  if (!text) return null;

  if (/\b(openclaw|openhands|n8n|external agent|agent registry|agent eksternal)\b/i.test(text) &&
      /\b(cek|status|health|registry|terdaftar|registered|aktif)\b/i.test(text)) {
    return "EXTERNAL_AGENT_STATUS";
  }

  const action = actionOf(text);
  if (!action) return null;

  if (/\b(hostinger|hpanel|vps)\b/i.test(text)) {
    if (/\b(docker|compose|container|project)\b/i.test(text)) {
      if (action === "restart") return "HOSTINGER_DOCKER_RESTART";
      if (action === "status") return "HOSTINGER_DOCKER_STATUS";
    }
    if (action === "restart") return "HOSTINGER_VPS_RESTART";
    if (action === "start") return "HOSTINGER_VPS_START";
    if (action === "stop") return "HOSTINGER_VPS_STOP";
    if (action === "status") return "HOSTINGER_VPS_STATUS";
  }

  if (/\b(gcp|google cloud|compute engine|gpu worker|ollama vm)\b/i.test(text)) {
    if (action === "restart") return "GCP_VM_RESTART";
    if (action === "start") return "GCP_VM_START";
    if (action === "stop") return "GCP_VM_STOP";
    if (action === "status") return "GCP_VM_STATUS";
  }

  return null;
}

function safeJson(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const text = JSON.stringify(value);
  return text.length > 20_000 ? { truncated: true, preview: text.slice(0, 20_000) } : value;
}

function gcpConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    projectId: (env["GCP_OLLAMA_VM_PROJECT"] ?? "").trim(),
    zone: (env["GCP_OLLAMA_VM_ZONE"] ?? "").trim(),
    instanceName: (env["GCP_OLLAMA_VM_INSTANCE"] ?? "").trim(),
    credentialJson:
      (env["GCP_AI_CORE_COMPUTE_SA_JSON"] ??
        env["GCP_CODING_WORKER_COMPUTE_SA_JSON"] ??
        env["GCP_OLLAMA_COMPUTE_SA_JSON"] ??
        "").trim(),
  };
}

async function gcpToken(env: NodeJS.ProcessEnv): Promise<{
  token: string;
  projectId: string;
  zone: string;
  instanceName: string;
}> {
  const config = gcpConfig(env);
  if (!config.projectId || !config.zone || !config.instanceName || !config.credentialJson) {
    throw new Error("GCP control plane is not fully configured.");
  }

  let credentials: NonNullable<GoogleAuthOptions["credentials"]>;
  try {
    credentials = JSON.parse(config.credentialJson) as NonNullable<GoogleAuthOptions["credentials"]>;
  } catch {
    throw new Error("GCP compute credential JSON is invalid.");
  }

  const auth = new GoogleAuth({ credentials, scopes: [GCP_SCOPE] });
  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const token = typeof tokenResult === "string" ? tokenResult : tokenResult?.token;
  if (!token) throw new Error("GCP authentication returned no access token.");

  return { token, ...config };
}

async function callGcp(
  operation: AiCoreInfrastructureOperation,
  env: NodeJS.ProcessEnv,
): Promise<AiCoreInfrastructureResult> {
  const config = await gcpToken(env);
  const base =
    `${GCP_COMPUTE_API}/projects/${encodeURIComponent(config.projectId)}` +
    `/zones/${encodeURIComponent(config.zone)}/instances/${encodeURIComponent(config.instanceName)}`;

  const method = operation === "GCP_VM_STATUS" ? "GET" : "POST";
  const suffix =
    operation === "GCP_VM_START" ? "/start" :
    operation === "GCP_VM_STOP" ? "/stop" :
    operation === "GCP_VM_RESTART" ? "/reset" : "";
  const response = await fetch(base + suffix, {
    method,
    headers: { Authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(20_000),
  });

  const bodyText = await response.text();
  let data: unknown = bodyText;
  try { data = bodyText ? JSON.parse(bodyText) : null; } catch { /* text response */ }
  if (!response.ok) {
    throw new Error(`GCP Compute operation failed with HTTP ${response.status}.`);
  }

  const mutating = operation !== "GCP_VM_STATUS";
  return {
    operation,
    provider: "gcp",
    mutating,
    reply: mutating
      ? `Operasi ${operation} diterima Google Cloud untuk ${config.instanceName}.`
      : `Status Google Cloud untuk ${config.instanceName} berhasil dibaca.`,
    data: safeJson(data),
  };
}

function hostingerConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    token: (env["HOSTINGER_API_TOKEN"] ?? "").trim(),
    vmId: (env["HOSTINGER_VPS_ID"] ?? "").trim(),
    dockerProject: (env["HOSTINGER_DOCKER_PROJECT"] ?? "").trim(),
    apiBase: (env["HOSTINGER_API_BASE"] ?? "").trim().replace(/\\/$/, ""),
  };
}

async function callHostinger(
  operation: AiCoreInfrastructureOperation,
  env: NodeJS.ProcessEnv,
): Promise<AiCoreInfrastructureResult> {
  const config = hostingerConfig(env);
  if (!config.token || !config.vmId) {
    throw new Error("Hostinger control plane requires HOSTINGER_API_TOKEN and HOSTINGER_VPS_ID.");
  }

  const bases = Array.from(new Set([config.apiBase, ...HOSTINGER_API_BASES].filter(Boolean)));
  let method = "GET";
  let suffix = "";

  if (operation === "HOSTINGER_VPS_START") { suffix = "/start"; method = "POST"; }
  if (operation === "HOSTINGER_VPS_STOP") { suffix = "/stop"; method = "POST"; }
  if (operation === "HOSTINGER_VPS_RESTART") { suffix = "/restart"; method = "POST"; }

  if (operation === "HOSTINGER_DOCKER_STATUS" || operation === "HOSTINGER_DOCKER_RESTART") {
    if (!config.dockerProject) {
      throw new Error("HOSTINGER_DOCKER_PROJECT is required for Docker project operations.");
    }
    suffix = `/docker/${encodeURIComponent(config.dockerProject)}`;
    if (operation === "HOSTINGER_DOCKER_RESTART") {
      suffix += "/restart";
      method = "POST";
    }
  }

  const request = async (url: string, requestMethod = method) => {
    const response = await fetch(url, {
      method: requestMethod,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const bodyText = await response.text();
    let data: unknown = bodyText;
    try { data = bodyText ? JSON.parse(bodyText) : null; } catch { /* text response */ }
    return { response, data };
  };

  let data: unknown = null;
  let lastStatus = 404;
  for (const base of bases) {
    const vmBase = `${base}/vps/v1/virtual-machines/${encodeURIComponent(config.vmId)}`;
    const result = await request(vmBase + suffix);
    lastStatus = result.response.status;
    if (result.response.ok) {
      data = result.data;
      lastStatus = 200;
      break;
    }
    if (result.response.status !== 404) {
      throw new Error(`Hostinger operation failed with HTTP ${result.response.status}.`);
    }
  }

  if (lastStatus === 404 && operation === "HOSTINGER_VPS_STATUS") {
    for (const base of bases) {
      const discovered = await request(`${base}/vps/v1/virtual-machines`, "GET");
      if (!discovered.response.ok) {
        if (discovered.response.status === 404) continue;
        throw new Error(`Hostinger VPS discovery failed with HTTP ${discovered.response.status}.`);
      }
      const payload = discovered.data as { data?: unknown[] } | unknown[] | null;
      const machines = Array.isArray(payload)
        ? payload
        : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)
          ? (payload as { data: unknown[] }).data
          : [];
      const exact = machines.find((machine) =>
        machine && typeof machine === "object" && String((machine as { id?: unknown }).id ?? "") === config.vmId);
      if (exact) {
        data = exact;
        lastStatus = 200;
        break;
      }
      if (machines.length === 1) {
        data = {
          ...(machines[0] as Record<string, unknown>),
          configured_vps_id: config.vmId,
          discovered_vps_id: (machines[0] as { id?: unknown }).id ?? null,
          configuration_warning: "HOSTINGER_VPS_ID does not match the only VPS accessible by this token.",
        };
        lastStatus = 200;
        break;
      }
      if (machines.length > 1) {
        data = {
          configured_vps_id: config.vmId,
          accessible_virtual_machines: machines,
          configuration_warning: "HOSTINGER_VPS_ID was not found; multiple VPS instances are accessible.",
        };
        lastStatus = 200;
        break;
      }
    }
  }

  if (lastStatus !== 200) {
    throw new Error(`Hostinger operation failed with HTTP ${lastStatus}. Verify HOSTINGER_VPS_ID or set HOSTINGER_API_BASE.`);
  }

  const mutating =
    operation !== "HOSTINGER_VPS_STATUS" &&
    operation !== "HOSTINGER_DOCKER_STATUS";
  return {
    operation,
    provider: "hostinger",
    mutating,
    reply: mutating
      ? `Operasi ${operation} diterima Hostinger.`
      : `Status Hostinger berhasil dibaca.`,
    data: safeJson(data),
  };
}

export async function executeAiCoreInfrastructureOperation(input: {
  operation: AiCoreInfrastructureOperation;
  requestedBy?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<AiCoreInfrastructureResult> {
  const env = input.env ?? process.env;
  let result: AiCoreInfrastructureResult;

  if (input.operation === "EXTERNAL_AGENT_STATUS") {
    const { getExternalAgentRegistrySnapshot } = await import("./externalAgentRegistryService.js");
    const agents = await getExternalAgentRegistrySnapshot();
    result = {
      operation: input.operation,
      provider: "ai-core",
      mutating: false,
      reply: "Status external agent registry berhasil dibaca.",
      data: { agents },
    };
  } else if (input.operation.startsWith("GCP_")) {
    result = await callGcp(input.operation, env);
  } else {
    result = await callHostinger(input.operation, env);
  }

  const { logAudit } = await import("./aiAuditService.js");
  await logAudit(
    "ai-core-chat",
    result.mutating ? "infrastructure_operation_executed" : "infrastructure_status_read",
    input.operation,
    "ai_core_control_plane",
    "success",
    {
      provider: result.provider,
      requestedBy: input.requestedBy ?? "ai-core-chat",
      mutating: result.mutating,
    },
  ).catch(() => undefined);

  return result;
}
