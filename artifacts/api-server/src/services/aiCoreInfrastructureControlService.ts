import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoogleAuth, type GoogleAuthOptions } from "google-auth-library";
import { deployCodingStaticSite } from "./hostingerCodingStaticDeployService.js";

function execFileWithInput(
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
  input?: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { ...options, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          const safeStderr = String(stderr ?? "").trim().slice(-4000);
          const safeStdout = String(stdout ?? "").trim().slice(-4000);
          const detail = [
            error.message,
            safeStderr ? `stderr: ${safeStderr}` : "",
            safeStdout ? `stdout: ${safeStdout}` : "",
          ].filter(Boolean).join("\n");
          reject(new Error(detail));
          return;
        }
        resolve({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
    child.stdin?.end(input);
  });
}

const GCP_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const GCP_COMPUTE_API = "https://compute.googleapis.com/compute/v1";
const HOSTINGER_API_BASES = ["https://developers.hostinger.com/api"] as const;

export type AiCoreInfrastructureOperation =
  | "GCP_VM_STATUS"
  | "GCP_VM_START"
  | "GCP_VM_STOP"
  | "GCP_VM_RESTART"
  | "HOSTINGER_VPS_STATUS"
  | "HOSTINGER_VPS_START"
  | "HOSTINGER_VPS_STOP"
  | "HOSTINGER_VPS_RESTART"
  | "HOSTINGER_VPS_BOOTSTRAP_GIT"
  | "HOSTINGER_DOCKER_LIST"
  | "HOSTINGER_DOCKER_STATUS"
  | "HOSTINGER_DOCKER_CONTAINERS"
  | "HOSTINGER_DOCKER_LOGS"
  | "HOSTINGER_DOCKER_DEPLOY"
  | "HOSTINGER_DOCKER_START"
  | "HOSTINGER_DOCKER_STOP"
  | "HOSTINGER_DOCKER_RESTART"
  | "HOSTINGER_DOCKER_UPDATE"
  | "HOSTINGER_AI_WORKERS_DEPLOY"
  | "HOSTINGER_SUBDOMAIN_LIST"
  | "HOSTINGER_SUBDOMAIN_CREATE"
  | "HOSTINGER_SUBDOMAIN_DELETE"
  | "HOSTINGER_PARKED_DOMAIN_LIST"
  | "HOSTINGER_PARKED_DOMAIN_CREATE"
  | "HOSTINGER_PARKED_DOMAIN_DELETE"
  | "HOSTINGER_DNS_LIST"
  | "HOSTINGER_DNS_SUBDOMAIN_CREATE"
  | "HOSTINGER_DNS_RECORD_CREATE"
  | "HOSTINGER_DNS_RECORD_UPDATE"
  | "HOSTINGER_DNS_RECORD_DELETE"
  | "HOSTINGER_DOCKER_ENV_SET"
  | "HOSTINGER_SSH_PUBLIC_KEY_ATTACH"
  | "HOSTINGER_SSH_PUBLIC_KEY_LIST"
  | "HOSTINGER_SSH_AUTH_DIAGNOSTIC"
  | "HOSTINGER_DOMAIN_AVAILABILITY"
  | "HOSTINGER_HOSTING_DISCOVERY"
  | "HOSTINGER_CODING_STATIC_DEPLOY"
  | "EXTERNAL_AGENT_DIAGNOSTIC"
  | "EXTERNAL_AGENT_STATUS"
  | "WHATSAPP_GATEWAY_STATUS";

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

function isExplicitReadOnlyRequest(text: string): boolean {
  const normalized = text.replace(/^@+\s*/, "");

  // Fail closed for explicit no-change language. Read-only inspection prompts
  // often mention words such as auto-start/auto-stop while describing what to
  // inspect; those mentions must never be interpreted as infrastructure actions.
  if (/\b(read[ -]?only|hanya baca|tanpa (?:melakukan )?perubahan|without (?:making )?changes?|do not (?:make|apply) changes?|jangan (?:melakukan )?perubahan|jangan ubah apa ?pun)\b/i.test(normalized)) {
    return true;
  }

  // A leading inspection verb is authoritative unless the request begins with
  // an explicit mutation command such as "GCP stop VM ..." or
  // "Hostinger nyalakan VPS ...".
  return /^(?:cek|check|status|health|audit|inspect|periksa|lihat|verifikasi|verify)\b/i.test(normalized);
}

function actionOf(text: string): "status" | "start" | "stop" | "restart" | null {
  // Resolve negation per action instead of treating any "jangan <action>" as
  // globally read-only. This preserves commands such as "start VM, jangan
  // restart" while still preventing the specifically negated mutation.
  if (isExplicitReadOnlyRequest(text)) return "status";

  const isNegated = (pattern: string) =>
    new RegExp(`\\b(?:jangan|do not|don't)\\s+(?:\\w+\\s+){0,2}(?:${pattern})\\b`, "i").test(text);

  if (/\b(restart|reboot|mulai ulang)\b/i.test(text) && !isNegated("restart|reboot|mulai ulang")) return "restart";
  if (/\b(stop|matikan|shutdown|hentikan)\b/i.test(text) && !isNegated("stop|matikan|shutdown|hentikan")) return "stop";
  if (/\b(start|nyalakan|hidupkan|jalankan)\b/i.test(text) && !isNegated("start|nyalakan|hidupkan|jalankan")) return "start";
  if (/\b(cek|check|status|health|audit|inspect|periksa|lihat|verifikasi|verify)\b/i.test(text)) return "status";
  return null;
}

export function detectAiCoreInfrastructureOperation(
  message: string,
): AiCoreInfrastructureOperation | null {
  const text = normalizedMessage(message);
  if (!text) return null;

  if (
    /\b(hostinger|hpanel)\b/i.test(text) &&
    /\bcoding\.cstlogistic\.co\.id\b/i.test(text) &&
    /\b(static|dashboard|website|site|frontend)\b/i.test(text) &&
    /\b(deploy|publish|buat|create|benahi|fix|repair|pulihkan)\b/i.test(text)
  ) {
    return "HOSTINGER_CODING_STATIC_DEPLOY";
  }

  // Hostinger capacity/resource inspection must outrank incidental external-agent
  // names (for example when evaluating whether OpenClaw can be moved there).
  if (/\b(hostinger|hpanel|vps)\b/i.test(text) &&
      /\b(kapasitas|capacity|resource|resources|cpu|vcpu|ram|memory|memori|swap|disk|storage|load|utilization|utilisation|penggunaan|headroom)\b/i.test(text) &&
      /\b(cek|check|status|health|audit|inspect|periksa|lihat|verifikasi|verify|kapasitas|capacity|resource|resources)\b/i.test(text)) {
    return "HOSTINGER_VPS_STATUS";
  }

  // Installing git is a narrow bootstrap action used only to unblock the
  // existing AI Workers deploy path. Keep this ahead of the broader worker
  // deployment detector so "install git for AI Workers" does not recurse back
  // into the deploy preflight that requires git.
  if (
    /\b(hostinger|hpanel|vps)\b/i.test(text) &&
    /\b(git)\b/i.test(text) &&
    /\b(install|pasang|bootstrap|siapkan|setup|prepare|benahi|perbaiki)\b/i.test(text)
  ) {
    return "HOSTINGER_VPS_BOOTSTRAP_GIT";
  }

  // Explicit Docker log inspection is read-only and must win before the
  // AI Workers deployment heuristic. Paths such as
  // /opt/core-ai-workers/deploy/ai-workers contain both "ai-workers" and
  // "deploy" even when the user only asks to read logs.
  if (
    /\b(hostinger|hpanel|vps)\b/i.test(text) &&
    /\b(docker|compose|container|project)\b/i.test(text) &&
    /\b(log|logs)\b/i.test(text)
  ) {
    return "HOSTINGER_DOCKER_LOGS";
  }

  // Deploying the AI worker stack is a bounded SSH deployment on an already
  // running VPS. It must outrank generic VPS start/stop heuristics, especially
  // when the prompt contains words like "jalankan installer".
  if (/\b(ai[ -]?workers?|worker stack|openclaw stack|external agent stack)\b/i.test(text) &&
      /\b(deploy|redeploy|install|installer|apply|rollout|perbarui|update)\b/i.test(text) &&
      /\b(hostinger|vps|worker|openclaw|openhands|n8n)\b/i.test(text)) {
    return "HOSTINGER_AI_WORKERS_DEPLOY";
  }

  if (/\b(whatsapp|wa gateway|wa admin|device wa|whatsapp admin)\b/i.test(text) &&
      /\b(cek|check|status|health|audit|inspect|periksa|lihat|verifikasi|verify|koneksi|connection|connectivity|online|terhubung)\b/i.test(text)) {
    return "WHATSAPP_GATEWAY_STATUS";
  }

  // Failure/runtime diagnosis must outrank the broad external-agent status
  // matcher. Prompts such as "cek error OpenClaw HTTP 400" are asking for the
  // failed command/runtime detail, not a registry snapshot.
  if (
    /\b(openclaw|openhands|external agent|agent eksternal)\b/i.test(text) &&
    /\b(diagnos(?:e|is|tic)?|diagnostik|error|failed|failure|gagal|http\s*4\d\d|provider|payload|schema|tool[_ -]?choice|parallel[_ -]?tool[_ -]?calls|runtime|application logs?|upstream|error\.message|error\.type|error\.code|error\.param)\b/i.test(text) &&
    /\b(cek|check|audit|inspect|telusuri|trace|cari|find|lihat|read|baca|diagnos(?:e|is|tic)?|diagnostik)\b/i.test(text)
  ) {
    return "EXTERNAL_AGENT_DIAGNOSTIC";
  }

  if (/\b(openclaw|openhands|n8n|external agent|agent registry|agent eksternal)\b/i.test(text) &&
      /\b(cek|status|health|registry|terdaftar|registered|aktif)\b/i.test(text)) {
    return "EXTERNAL_AGENT_STATUS";
  }

  if (/\b(hostinger|hpanel)\b/i.test(text) &&
      /\b(cari|find|discover|discovery|list|daftar|cek|check|lihat)\b/i.test(text) &&
      /\b(hosting username|hosting domain|hosting account|website|websites|akun hosting|domain hosting)\b/i.test(text)) {
    return "HOSTINGER_HOSTING_DISCOVERY";
  }

  if (/\b(hostinger|hpanel|vps)\b/i.test(text) &&
      /\b(ssh|private key|ssh key|kunci ssh)\b/i.test(text) &&
      /\b(diagnostic|diagnostik|fingerprint|cocok|match|pasangan|derive|turunkan)\b/i.test(text)) {
    return "HOSTINGER_SSH_AUTH_DIAGNOSTIC";
  }

  if (/\b(hostinger|hpanel|vps)\b/i.test(text) &&
      /\b(ssh|public key|public-key|ssh key|kunci ssh)\b/i.test(text) &&
      /\b(list|daftar|cek|check|status|lihat|verify|verifikasi)\b/i.test(text)) {
    return "HOSTINGER_SSH_PUBLIC_KEY_LIST";
  }

  if (/\b(hostinger|hpanel)\b/i.test(text) &&
      /\b(ssh|public key|public-key|ssh key|kunci ssh)\b/i.test(text) &&
      /\b(attach|pasang|daftarkan|register|add|tambah)\b/i.test(text)) {
    return "HOSTINGER_SSH_PUBLIC_KEY_ATTACH";
  }

  // Read-only Docker inspection must outrank incidental mutation words in
  // negative constraints such as "jangan deploy/restart/ubah env".
  if (/\b(hostinger|hpanel|vps)\b/i.test(text) &&
      /\b(docker|compose|container|project)\b/i.test(text) &&
      isExplicitReadOnlyRequest(text)) {
    return "HOSTINGER_DOCKER_STATUS";
  }

  if (/\b(hostinger|hpanel)\b/i.test(text) &&
      /\b(secret|secrets|env|environment|environment variable|variabel environment)\b/i.test(text) &&
      /\b(set|add|tambah|masukkan|masukan|simpan|update|ubah|ganti|apply|pasang)\b/i.test(text) &&
      !/(?:^|\s)content\s*=/i.test(text)) {
    return "HOSTINGER_DOCKER_ENV_SET";
  }

  if (/\b(hostinger|hpanel)\b/i.test(text) && /\b(dns|zone|record)\b/i.test(text)) {
    // Inspection requests can mention mutating verbs inside negative constraints.
    // Never interpret "jangan update/delete DNS" as an instruction to mutate.
    if (isExplicitReadOnlyRequest(text)) return "HOSTINGER_DNS_LIST";
    if (/\b(delete|hapus|remove)\b/i.test(text)) return "HOSTINGER_DNS_RECORD_DELETE";
    if (/\b(update|ubah|ganti|replace|overwrite)\b/i.test(text)) return "HOSTINGER_DNS_RECORD_UPDATE";
    if (/\b(create|buat|add|tambah|pasang)\b/i.test(text) && !/\bsubdomains?\b/i.test(text)) {
      return "HOSTINGER_DNS_RECORD_CREATE";
    }
  }

  if (/\b(hostinger|hpanel)\b/i.test(text) && /\b(parked domains?|domain aliases?|alias domains?|parkir domain)\b/i.test(text)) {
    if (/\b(delete|hapus|remove)\b/i.test(text)) return "HOSTINGER_PARKED_DOMAIN_DELETE";
    if (/\b(buat|create|add|tambah|pasang)\b/i.test(text)) return "HOSTINGER_PARKED_DOMAIN_CREATE";
    if (/\b(list|daftar|cek|check|status|lihat)\b/i.test(text)) return "HOSTINGER_PARKED_DOMAIN_LIST";
  }

  if (/\b(hostinger|hpanel)\b/i.test(text) && /\bsubdomains?\b/i.test(text)) {
    if (/\b(delete|hapus|remove)\b/i.test(text) && !/\b(dns|zone|record)\b/i.test(text)) {
      return "HOSTINGER_SUBDOMAIN_DELETE";
    }
    if (/\b(buat|create|add|tambah)\b/i.test(text)) {
      if (/\b(hosting|website)\b/i.test(text) || /(?:^|\s)username\s*=/i.test(text)) {
        return "HOSTINGER_SUBDOMAIN_CREATE";
      }
      return "HOSTINGER_DNS_SUBDOMAIN_CREATE";
    }
    if (/\b(list|daftar|cek|check|status|lihat)\b/i.test(text)) {
      if (/\b(dns|zone|record)\b/i.test(text)) return "HOSTINGER_DNS_LIST";
      return "HOSTINGER_SUBDOMAIN_LIST";
    }
  }

  if (/\b(hostinger|hpanel)\b/i.test(text) &&
      /\b(dns|zone|record)\b/i.test(text) &&
      /\b(list|daftar|cek|check|status|lihat)\b/i.test(text)) {
    return "HOSTINGER_DNS_LIST";
  }

  if (/\b(hostinger|hpanel)\b/i.test(text) &&
      /\b(domain)\b/i.test(text) &&
      /\b(available|availability|tersedia|ketersediaan|cek|check)\b/i.test(text)) {
    return "HOSTINGER_DOMAIN_AVAILABILITY";
  }

  if (/\b(hostinger|hpanel|vps)\b/i.test(text) && /\b(docker|compose|container|project)\b/i.test(text)) {
    if (isExplicitReadOnlyRequest(text)) return "HOSTINGER_DOCKER_STATUS";
    if (/\b(log|logs)\b/i.test(text)) return "HOSTINGER_DOCKER_LOGS";
    if (/\b(container|containers)\b/i.test(text) && /\b(list|daftar|cek|check|status|lihat)\b/i.test(text)) {
      return "HOSTINGER_DOCKER_CONTAINERS";
    }
    if (/\b(create|buat|deploy|apply|pasang)\b/i.test(text)) return "HOSTINGER_DOCKER_DEPLOY";
    if (/\b(?:env|environment)(?:\s+variables?)?\b/i.test(text) &&
        /\b(update|ubah|ganti|set|apply|deploy|redeploy|perbarui)\b/i.test(text)) {
      return "HOSTINGER_DOCKER_DEPLOY";
    }
    if (/\bupdate\s+env(?:ironment)?\s*=/i.test(text)) return "HOSTINGER_DOCKER_DEPLOY";
    if (/\b(update|redeploy|refresh|pull latest|perbarui)\b/i.test(text)) return "HOSTINGER_DOCKER_UPDATE";
    if (/\b(restart|reboot|mulai ulang)\b/i.test(text)) return "HOSTINGER_DOCKER_RESTART";
    if (/\b(stop|matikan|shutdown|hentikan)\b/i.test(text)) return "HOSTINGER_DOCKER_STOP";
    if (/\b(start|nyalakan|hidupkan|jalankan)\b/i.test(text)) return "HOSTINGER_DOCKER_START";
    if (/\b(list|daftar)\b/i.test(text) && /\b(project|docker)\b/i.test(text)) return "HOSTINGER_DOCKER_LIST";
    if (/\b(read[ -]?only|hanya baca|cek|check|status|health|inspect|periksa|lihat)\b/i.test(text)) {
      return "HOSTINGER_DOCKER_STATUS";
    }
  }

  // Billing/BigQuery requests are not Compute Engine VM operations. A generic
  // "GCP" mention plus "cek/status" must not hijack them into GCP_VM_STATUS.
  if (/\b(billing|billing export|bigquery|biaya|cost|usage cost|tagihan)\b/i.test(text)) {
    return null;
  }

  const action = actionOf(text);
  if (!action) return null;

  if (/\b(hostinger|hpanel|vps)\b/i.test(text)) {
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

function decodeAiWorkersPrivateKeyB64(env: NodeJS.ProcessEnv): string {
  const encoded = (env["AI_WORKERS_SSH_PRIVATE_KEY_B64"] ?? "").trim();
  if (!encoded) return "";
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
    if (!/^-----BEGIN (?:OPENSSH |RSA )?PRIVATE KEY-----[\s\S]+-----END (?:OPENSSH |RSA )?PRIVATE KEY-----$/.test(decoded)) {
      throw new Error("decoded value is not a supported private key");
    }
    return decoded;
  } catch {
    throw new Error("AI_WORKERS_SSH_PRIVATE_KEY_B64 is not a valid base64-encoded private key.");
  }
}

function hostingerConfig(env: NodeJS.ProcessEnv = process.env) {
  const b64PrivateKey = decodeAiWorkersPrivateKeyB64(env);
  return {
    token: (env["HOSTINGER_API_TOKEN"] ?? "").trim(),
    vmId: (env["HOSTINGER_VPS_ID"] ?? "").trim(),
    dockerProject: (env["HOSTINGER_DOCKER_PROJECT"] ?? "").trim(),
    hostingUsername: (env["HOSTINGER_HOSTING_USERNAME"] ?? "").trim(),
    hostingDomain: (env["HOSTINGER_HOSTING_DOMAIN"] ?? "").trim(),
    apiBase: (env["HOSTINGER_API_BASE"] ?? "").trim().replace(/\/$/, ""),
    // AI Workers deployments already have a dedicated protected SSH profile.
    // Reuse that profile as a fallback so infrastructure control does not require
    // duplicating the same credential under HOSTINGER_* names.
    sshHost: (env["HOSTINGER_SSH_HOST"] ?? env["AI_WORKERS_SSH_HOST"] ?? "").trim(),
    sshUser: (env["HOSTINGER_SSH_USER"] ?? env["AI_WORKERS_SSH_USER"] ?? "root").trim(),
    sshPort: (env["HOSTINGER_SSH_PORT"] ?? env["AI_WORKERS_SSH_PORT"] ?? "22").trim(),
    sshPrivateKey:
      (env["HOSTINGER_SSH_PRIVATE_KEY"] ?? "").trim() ||
      b64PrivateKey ||
      (env["AI_WORKERS_SSH_PRIVATE_KEY"] ?? "").trim(),
    sshDockerProjectDir: (env["HOSTINGER_DOCKER_PROJECT_DIR"] ?? "").trim(),
    aiWorkersDeployPath: (env["AI_WORKERS_DEPLOY_PATH"] ?? "/opt/core-ai-workers").trim(),
    aiWorkersEnvFile: (env["AI_WORKERS_REMOTE_ENV_FILE"] ?? "/etc/ai-core/ai-workers.env").trim(),
  };
}

async function callHostinger(
  operation: AiCoreInfrastructureOperation,
  env: NodeJS.ProcessEnv,
  message = "",
): Promise<AiCoreInfrastructureResult> {
  const config = hostingerConfig(env);
  if (!config.token) {
    throw new Error("Hostinger control plane requires HOSTINGER_API_TOKEN.");
  }

  if (operation === "HOSTINGER_CODING_STATIC_DEPLOY") {
    const data = await deployCodingStaticSite({ env });
    return {
      operation,
      provider: "hostinger",
      mutating: true,
      reply: "AI Coding static dashboard diterima Hostinger untuk deployment.",
      data: safeJson(data),
    };
  }

  const valueOf = (key: string): string => {
    const escaped = key.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
    const match = message.match(new RegExp(
      `(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s,;]+))`,
      "i",
    ));
    const quoted = match?.[1] ?? match?.[2];
    if (quoted !== undefined) return quoted.trim();
    return (match?.[3] ?? "").trim().replace(/[.?!:]+$/, "");
  };
  const boolOf = (key: string): boolean | undefined => {
    const value = valueOf(key).toLowerCase();
    if (!value) return undefined;
    if (["1", "true", "yes", "ya"].includes(value)) return true;
    if (["0", "false", "no", "tidak"].includes(value)) return false;
    throw new Error(`${key} must be true or false.`);
  };
  const parseEnvironment = (value: string): Map<string, string> => {
    const vars = new Map<string, string>();
    for (const line of value.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const val = trimmed.slice(separator + 1);
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) vars.set(key, val);
    }
    return vars;
  };
  const serializeEnvironment = (vars: Map<string, string>): string =>
    [...vars.entries()].map(([key, value]) => `${key}=${value}`).join("\n");

  const shellQuote = (value: string): string =>
    `'${value.replace(/'/g, `'"'"'`)}'`;

  const sanitizeAiWorkersDeployDiagnostic = (value: string): string => {
    return value
      .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/gi, "[REDACTED_PRIVATE_KEY]")
      .replace(/\b(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
      .replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)[^\s]+/gi, "$1[REDACTED]")
      .trim()
      .slice(-4000);
  };

  const classifyAiWorkersDeployFailure = (detail: string): string => {
    if (/AI_WORKERS_DEPLOY_PRECHECK_FAIL\s+missing=git/i.test(detail)) return "preflight_git";
    if (/AI_WORKERS_DEPLOY_PRECHECK_FAIL\s+missing=bash/i.test(detail)) return "preflight_bash";
    if (/AI_WORKERS_DEPLOY_PRECHECK_FAIL\s+missing=docker/i.test(detail)) return "preflight_docker";
    if (/AI_WORKERS_DEPLOY_PRECHECK_FAIL\s+path_not_git_nonempty=/i.test(detail)) return "preflight_target_path";
    if (/AI_WORKERS_DEPLOY_PRECHECK_FAIL\s+env_file_missing=/i.test(detail)) return "preflight_env_file";
    if (/permission denied|authentication failed|publickey/i.test(detail)) return "ssh_auth";
    if (/could not resolve hostname|name or service not known|connection timed out|connection refused/i.test(detail)) return "ssh_connectivity";
    if (/git clone|git -c|git fetch|git checkout|repository not found/i.test(detail)) return "git_sync";
    if (/install-ai-workers\.sh/i.test(detail)) return "installer";
    if (/ai-workers-healthcheck\.sh/i.test(detail)) return "healthcheck";
    return "remote_command";
  };

  const isDockerManagerUnsupported = (error: unknown): boolean =>
    error instanceof Error && /\[VPS:2044\]|does not support Docker Manager/i.test(error.message);

  const runHostingerGitBootstrapOverSsh = async (): Promise<unknown> => {
    const host = config.sshHost;
    const user = config.sshUser;
    const port = config.sshPort;
    const privateKey = config.sshPrivateKey;

    if (!host || !user || !privateKey) {
      throw new Error(
        "Hostinger git bootstrap requires SSH configuration from HOSTINGER_SSH_* or AI_WORKERS_SSH_*.",
      );
    }
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      throw new Error("HOSTINGER_SSH_PORT must be a valid TCP port.");
    }

    const command = [
      "set -euo pipefail",
      'if [ "$(id -u)" -eq 0 ]; then SUDO=""; else command -v sudo >/dev/null 2>&1 || { echo "HOSTINGER_GIT_BOOTSTRAP_FAIL missing=sudo" >&2; exit 70; }; SUDO="sudo"; fi',
      'if command -v git >/dev/null 2>&1; then echo "HOSTINGER_GIT_BOOTSTRAP git=already-present"; ' +
        'elif command -v apt-get >/dev/null 2>&1; then $SUDO apt-get update && $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y git; ' +
        'elif command -v dnf >/dev/null 2>&1; then $SUDO dnf install -y git; ' +
        'elif command -v yum >/dev/null 2>&1; then $SUDO yum install -y git; ' +
        'elif command -v apk >/dev/null 2>&1; then $SUDO apk add --no-cache git; ' +
        'else echo "HOSTINGER_GIT_BOOTSTRAP_FAIL package_manager=unsupported" >&2; exit 71; fi',
      'command -v git >/dev/null 2>&1 || { echo "HOSTINGER_GIT_BOOTSTRAP_FAIL missing=git-after-install" >&2; exit 72; }',
      'command -v bash >/dev/null 2>&1 || { echo "HOSTINGER_GIT_BOOTSTRAP_FAIL missing=bash" >&2; exit 73; }',
      'command -v docker >/dev/null 2>&1 || { echo "HOSTINGER_GIT_BOOTSTRAP_FAIL missing=docker" >&2; exit 74; }',
      'printf "HOSTINGER_GIT_BOOTSTRAP_OK\\n"',
      'git --version',
      'bash --version | head -n 1',
      'docker --version',
    ].join(" && ");

    const tempDir = await mkdtemp(join(tmpdir(), "ai-core-hostinger-git-"));
    const keyPath = join(tempDir, "id_hostinger");
    try {
      await writeFile(keyPath, privateKey.endsWith("\n") ? privateKey : privateKey + "\n", {
        mode: 0o600,
      });
      const { stdout, stderr } = await execFileWithInput("ssh", [
        "-i", keyPath,
        "-p", port,
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=12",
        "-o", "StrictHostKeyChecking=accept-new",
        `${user}@${host}`,
        command,
      ], {
        timeout: 5 * 60_000,
        maxBuffer: 1024 * 1024,
      });

      return {
        transport: "ssh",
        host,
        user,
        port: Number(port),
        installed: true,
        stdout: stdout.trim().slice(-4000),
        stderr: stderr.trim().slice(-1000),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        "Hostinger git bootstrap failed: " +
        sanitizeAiWorkersDeployDiagnostic(detail).slice(0, 1200),
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  const runAiWorkersDeployOverSsh = async (): Promise<unknown> => {
    const host = config.sshHost;
    const user = config.sshUser;
    const port = config.sshPort;
    const privateKey = config.sshPrivateKey;
    const deployPath = valueOf("directory") || config.aiWorkersDeployPath;
    const envFile = valueOf("envfile") || config.aiWorkersEnvFile;
    const explicitSha =
      valueOf("commit") ||
      valueOf("sha") ||
      (message.match(/\b[a-f0-9]{40}\b/i)?.[0] ?? "main");

    if (!host || !user || !privateKey) {
      throw new Error(
        "AI Workers deploy requires SSH configuration from HOSTINGER_SSH_* or AI_WORKERS_SSH_*.",
      );
    }
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      throw new Error("HOSTINGER_SSH_PORT must be a valid TCP port.");
    }
    if (!deployPath.startsWith("/") || deployPath.includes("\0")) {
      throw new Error("AI Workers deploy path must be an absolute path.");
    }
    if (!envFile.startsWith("/") || envFile.includes("\0")) {
      throw new Error("AI Workers env file must be an absolute path.");
    }
    if (!(explicitSha === "main" || /^[a-f0-9]{40}$/i.test(explicitSha))) {
      throw new Error("AI Workers deploy commit must be a 40-character Git SHA or main.");
    }

    const deployPathQuoted = shellQuote(deployPath);
    const envFileQuoted = shellQuote(envFile);
    const targetQuoted = shellQuote(explicitSha);
    const repoQuoted = shellQuote("https://github.com/Travelintrips/Core-AI-Foundation.git");

    const command = [
      "set -euo pipefail",
      `DEPLOY_PATH=${deployPathQuoted}`,
      `ENV_FILE=${envFileQuoted}`,
      `TARGET=${targetQuoted}`,
      'if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi',
      'command -v git >/dev/null || { echo "AI_WORKERS_DEPLOY_PRECHECK_FAIL missing=git" >&2; exit 70; }',
      'command -v bash >/dev/null || { echo "AI_WORKERS_DEPLOY_PRECHECK_FAIL missing=bash" >&2; exit 70; }',
      'command -v docker >/dev/null || { echo "AI_WORKERS_DEPLOY_PRECHECK_FAIL missing=docker" >&2; exit 70; }',
      '$SUDO mkdir -p "$DEPLOY_PATH"',
      '$SUDO chown "$(id -u):$(id -g)" "$DEPLOY_PATH"',
      'if [ ! -d "$DEPLOY_PATH/.git" ] && [ -n "$(find "$DEPLOY_PATH" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then echo "AI_WORKERS_DEPLOY_PRECHECK_FAIL path_not_git_nonempty=$DEPLOY_PATH" >&2; exit 72; fi',
      `if [ ! -d "$DEPLOY_PATH/.git" ]; then git clone ${repoQuoted} "$DEPLOY_PATH"; fi`,
      '[ -f "$ENV_FILE" ] || { echo "AI_WORKERS_DEPLOY_PRECHECK_FAIL env_file_missing=$ENV_FILE" >&2; exit 73; }',
      'git -C "$DEPLOY_PATH" fetch --prune origin',
      'if [ "$TARGET" = "main" ]; then TARGET="$(git -C "$DEPLOY_PATH" rev-parse origin/main)"; fi',
      'git -C "$DEPLOY_PATH" checkout --detach "$TARGET"',
      'cd "$DEPLOY_PATH"',
      '$SUDO env AI_WORKERS_ENV_FILE="$ENV_FILE" bash scripts/install-ai-workers.sh',
      '$SUDO env AI_WORKERS_ENV_FILE="$ENV_FILE" bash scripts/ai-workers-healthcheck.sh',
      'printf "AI_WORKERS_DEPLOY_OK commit=%s\\n" "$TARGET"',
    ].join(" && ");

    const tempDir = await mkdtemp(join(tmpdir(), "ai-core-ai-workers-ssh-"));
    const keyPath = join(tempDir, "id_hostinger");
    try {
      await writeFile(keyPath, privateKey.endsWith("\n") ? privateKey : privateKey + "\n", {
        mode: 0o600,
      });
      const { stdout, stderr } = await execFileWithInput("ssh", [
        "-i", keyPath,
        "-p", port,
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=12",
        "-o", "StrictHostKeyChecking=accept-new",
        `${user}@${host}`,
        command,
      ], {
        timeout: 15 * 60_000,
        maxBuffer: 2 * 1024 * 1024,
      });

      return {
        transport: "ssh",
        host,
        user,
        port: Number(port),
        directory: deployPath,
        envFile,
        target: explicitSha,
        deployed: true,
        stdout: stdout.trim().slice(-6000),
        stderr: stderr.trim().slice(-2000),
      };
    } catch (error) {
      const rawDetail = error instanceof Error ? error.message : String(error);
      const stderrMatch = rawDetail.match(/(?:^|\n)stderr:\s*([\s\S]*?)(?:\nstdout:|$)/i);
      const stdoutMatch = rawDetail.match(/(?:^|\n)stdout:\s*([\s\S]*)$/i);
      const stderrTail = sanitizeAiWorkersDeployDiagnostic(
        stderrMatch?.[1]?.trim() || "",
      ).slice(-1200);
      const stdoutTail = sanitizeAiWorkersDeployDiagnostic(
        stdoutMatch?.[1]?.trim() || "",
      ).slice(-2400);
      const remoteDetail = [
        stderrTail ? "stderr:\n" + stderrTail : "",
        stdoutTail ? "stdout:\n" + stdoutTail : "",
      ].filter(Boolean).join("\n");
      throw new Error(
        "AI Workers SSH deploy failed: " +
        (remoteDetail || sanitizeAiWorkersDeployDiagnostic(rawDetail).slice(-2400)),
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  const runDockerOverSsh = async (
    sshOperation: AiCoreInfrastructureOperation,
    sshProject: string,
    options: {
      content?: string;
      environment?: string;
      envKey?: string;
      envValue?: string;
    } = {},
  ): Promise<unknown> => {
    const host = config.sshHost;
    const user = config.sshUser;
    const port = config.sshPort;
    const privateKey = config.sshPrivateKey;
    const projectDir = valueOf("directory") || config.sshDockerProjectDir;

    if (!host || !user || !privateKey) {
      throw new Error(
        "Hostinger Docker Manager is unavailable on this OS. SSH fallback requires HOSTINGER_SSH_HOST, HOSTINGER_SSH_USER, and HOSTINGER_SSH_PRIVATE_KEY.",
      );
    }
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      throw new Error("HOSTINGER_SSH_PORT must be a valid TCP port.");
    }
    if (!projectDir || !projectDir.startsWith("/") || projectDir.includes("\0")) {
      throw new Error(
        "Hostinger SSH Docker fallback requires HOSTINGER_DOCKER_PROJECT_DIR or directory=<absolute-path>.",
      );
    }
    if (!/^[A-Za-z0-9_-]+$/.test(sshProject)) {
      throw new Error("Docker project name may contain only letters, numbers, dashes, and underscores.");
    }

    const projectDirQuoted = shellQuote(projectDir);
    const projectQuoted = shellQuote(sshProject);
    const prefix = `cd ${projectDirQuoted} && docker compose -p ${projectQuoted}`;
    let command = "";
    let stdinPayload: string | undefined;

    if (sshOperation === "HOSTINGER_DOCKER_STATUS" || sshOperation === "HOSTINGER_DOCKER_CONTAINERS") {
      command = `${prefix} ps --format json`;
    } else if (sshOperation === "HOSTINGER_DOCKER_LOGS") {
      const service = valueOf("service");
      if (service && !/^[A-Za-z0-9_.-]+$/.test(service)) {
        throw new Error("Docker service name may contain only letters, numbers, dots, dashes, and underscores.");
      }
      command = `${prefix} logs --tail 200 --no-color${service ? " " + shellQuote(service) : ""}`;
    } else if (sshOperation === "HOSTINGER_DOCKER_START") {
      command = `${prefix} up -d`;
    } else if (sshOperation === "HOSTINGER_DOCKER_STOP") {
      command = `${prefix} stop`;
    } else if (sshOperation === "HOSTINGER_DOCKER_RESTART") {
      command = `${prefix} restart`;
    } else if (sshOperation === "HOSTINGER_DOCKER_UPDATE") {
      command = `${prefix} pull && ${prefix} up -d --remove-orphans`;
    } else if (sshOperation === "HOSTINGER_DOCKER_DEPLOY") {
      const content = options.content ?? "";
      const environment = options.environment ?? "";
      if (!content) {
        throw new Error("Hostinger SSH Docker deploy requires compose content or an HTTPS/HTTP compose URL.");
      }

      const isComposeUrl = /^https?:\/\/[^\s]+$/i.test(content);
      const envBase64 = Buffer.from(environment, "utf8").toString("base64");
      if (isComposeUrl) {
        stdinPayload = envBase64 + "\n";
        command =
          `umask 077; mkdir -p ${projectDirQuoted} && cd ${projectDirQuoted} && ` +
          `curl -fsSL --max-time 30 ${shellQuote(content)} -o docker-compose.yml.tmp && ` +
          `mv docker-compose.yml.tmp docker-compose.yml && ` +
          `IFS= read -r env_b64; ` +
          `if [ -n "$env_b64" ]; then printf '%s' "$env_b64" | base64 -d > .env.tmp && mv .env.tmp .env; fi; ` +
          `docker compose -p ${projectQuoted} up -d --remove-orphans`;
      } else {
        const composeBase64 = Buffer.from(content, "utf8").toString("base64");
        stdinPayload = composeBase64 + "\n" + envBase64 + "\n";
        command =
          `umask 077; mkdir -p ${projectDirQuoted} && cd ${projectDirQuoted} && ` +
          `IFS= read -r compose_b64; IFS= read -r env_b64; ` +
          `printf '%s' "$compose_b64" | base64 -d > docker-compose.yml.tmp && ` +
          `mv docker-compose.yml.tmp docker-compose.yml && ` +
          `if [ -n "$env_b64" ]; then printf '%s' "$env_b64" | base64 -d > .env.tmp && mv .env.tmp .env; fi; ` +
          `docker compose -p ${projectQuoted} up -d --remove-orphans`;
      }
    } else if (sshOperation === "HOSTINGER_DOCKER_ENV_SET") {
      const key = options.envKey ?? "";
      const secretValue = options.envValue ?? "";
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error("Hostinger env/secret update requires key=<ENV_NAME>.");
      }
      if (!secretValue || /[\r\n]/.test(secretValue)) {
        throw new Error("Hostinger SSH env/secret value must be a non-empty single-line value.");
      }

      stdinPayload = Buffer.from(secretValue, "utf8").toString("base64") + "\n";
      command =
        `umask 077; mkdir -p ${projectDirQuoted} && cd ${projectDirQuoted} && touch .env && ` +
        `awk -v key=${shellQuote(key)} 'index($0, key "=") != 1 { print }' .env > .env.next && ` +
        `printf '%s=' ${shellQuote(key)} >> .env.next; ` +
        `IFS= read -r value_b64; printf '%s' "$value_b64" | base64 -d >> .env.next; ` +
        `printf '\\n' >> .env.next; mv .env.next .env; chmod 600 .env; ` +
        `docker compose -p ${projectQuoted} up -d --remove-orphans`;
    }

    if (!command) {
      throw new Error(
        `Hostinger SSH fallback does not support ${sshOperation}; use an explicit supported Docker operation.`,
      );
    }

    const tempDir = await mkdtemp(join(tmpdir(), "ai-core-hostinger-ssh-"));
    const keyPath = join(tempDir, "id_hostinger");
    try {
      await writeFile(keyPath, privateKey.endsWith("\n") ? privateKey : privateKey + "\n", {
        mode: 0o600,
      });
      const { stdout, stderr } = await execFileWithInput("ssh", [
        "-i", keyPath,
        "-p", port,
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=12",
        "-o", "StrictHostKeyChecking=accept-new",
        `${user}@${host}`,
        command,
      ], {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      }, stdinPayload);

      const baseResult = {
        transport: "ssh",
        host,
        user,
        port: Number(port),
        project: sshProject,
        directory: projectDir,
      };
      if (sshOperation === "HOSTINGER_DOCKER_ENV_SET") {
        return {
          ...baseResult,
          key: options.envKey,
          value: "[REDACTED]",
          applied: true,
        };
      }
      if (sshOperation === "HOSTINGER_DOCKER_DEPLOY") {
        return {
          ...baseResult,
          deployed: true,
          environmentApplied: Boolean(options.environment),
        };
      }
      return {
        ...baseResult,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Hostinger SSH Docker fallback failed: ${detail.slice(0, 800)}`);
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  let project = valueOf("project") || config.dockerProject;
  const hostingUsername = valueOf("username") || config.hostingUsername;
  const explicitHostingDomain = valueOf("domain");
  const hostingDomain = explicitHostingDomain || config.hostingDomain;
  const bases = Array.from(new Set([config.apiBase, ...HOSTINGER_API_BASES].filter(Boolean)));

  const request = async (
    url: string,
    requestMethod = "GET",
    body?: Record<string, unknown>,
  ) => {
    const response = await fetch(url, {
      method: requestMethod,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "CST-AI-Core-Hostinger/1.0",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    const bodyText = await response.text();
    let data: unknown = bodyText;
    try { data = bodyText ? JSON.parse(bodyText) : null; } catch { /* text response */ }
    return { response, data };
  };

  const firstSuccessful = async (
    path: string,
    method = "GET",
    body?: Record<string, unknown>,
  ) => {
    let lastStatus = 404;
    let lastData: unknown = null;
    for (const base of bases) {
      const result = await request(base + path, method, body);
      lastStatus = result.response.status;
      lastData = result.data;
      if (result.response.ok) return { status: result.response.status, data: result.data };
      const detail =
        typeof result.data === "string"
          ? result.data.slice(0, 500)
          : JSON.stringify(result.data ?? {}).slice(0, 500);
      const dnsInvalidZone =
        result.response.status === 422 && /\[DNS:4005\]|domain name is not valid/i.test(detail);
      if (dnsInvalidZone) {
        return { status: result.response.status, data: result.data };
      }
      if (result.response.status !== 404) {
        throw new Error(
          `Hostinger operation failed with HTTP ${result.response.status}${detail ? `: ${detail}` : "."}`,
        );
      }
    }
    return { status: lastStatus, data: lastData };
  };

  const discoverHostingWebsites = async () => {
    const result = await firstSuccessful("/hosting/v1/websites", "GET");
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Hostinger hosting discovery failed with HTTP ${result.status}.`);
    }
    const payload = result.data as { data?: unknown[]; meta?: unknown } | unknown[] | null;
    const websites = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)
        ? (payload as { data: unknown[] }).data
        : [];
    return { payload, websites };
  };

  const resolveHostingTarget = async () => {
    const requestedDomain = explicitHostingDomain || config.hostingDomain;
    const requestedUsername = valueOf("username") || config.hostingUsername;

    if (requestedDomain && requestedUsername) {
      return { domain: requestedDomain, username: requestedUsername };
    }

    const { websites } = await discoverHostingWebsites();
    const normalized = websites
      .filter((site) => site && typeof site === "object")
      .map((site) => site as Record<string, unknown>);

    if (requestedDomain) {
      const exact = normalized.find((site) =>
        String(site["domain"] ?? "").toLowerCase() === requestedDomain.toLowerCase()
      );
      if (!exact) {
        throw new Error(`Hostinger hosting domain ${requestedDomain} was not found in accessible websites.`);
      }
      const username = String(exact["username"] ?? "").trim();
      if (!username) {
        throw new Error(`Hostinger hosting domain ${requestedDomain} has no usable hosting username.`);
      }
      return { domain: requestedDomain, username };
    }

    if (requestedUsername) {
      const candidates = normalized.filter((site) => String(site["username"] ?? "") === requestedUsername);
      if (candidates.length === 1) {
        const domain = String(candidates[0]?.["domain"] ?? "").trim();
        if (!domain) throw new Error("Resolved hosting website has no domain.");
        return { domain, username: requestedUsername };
      }
      if (candidates.length > 1) {
        throw new Error("Multiple Hostinger websites match this username. Specify domain=<domain>.");
      }
    }

    throw new Error("Specify domain=<domain> for multi-domain Hostinger operations.");
  };

  const parentDnsZoneCandidates = (domain: string): string[] => {
    const labels = domain.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
    const candidates: string[] = [];
    for (let index = 1; index <= labels.length - 2; index += 1) {
      candidates.push(labels.slice(index).join("."));
    }
    return candidates;
  };

  const isDnsZoneMiss = (result: { status: number; data: unknown }): boolean => {
    if (result.status === 404) return true;
    if (result.status !== 422) return false;
    const detail =
      typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data ?? {});
    return /\[DNS:4005\]|domain name is not valid/i.test(detail);
  };

  const resolveParentDnsZone = async (requestedDomain: string): Promise<string | null> => {
    for (const candidate of parentDnsZoneCandidates(requestedDomain)) {
      const result = await firstSuccessful(`/dns/v1/zones/${encodeURIComponent(candidate)}`, "GET");
      if (result.status >= 200 && result.status < 300) return candidate;
    }
    return null;
  };

  const zoneRelativeRecordName = (
    requestedDomain: string,
    zoneDomain: string,
    recordName: string,
  ): string => {
    const requested = requestedDomain.toLowerCase().replace(/\.$/, "");
    const zone = zoneDomain.toLowerCase().replace(/\.$/, "");
    if (requested === zone) return recordName;
    const suffix = "." + zone;
    if (!requested.endsWith(suffix)) return recordName;
    const delegatedPrefix = requested.slice(0, -suffix.length);
    if (!delegatedPrefix) return recordName;
    if (recordName === "@") return delegatedPrefix;
    const normalizedRecord = recordName.toLowerCase().replace(/\.$/, "");
    if (normalizedRecord === delegatedPrefix || normalizedRecord.endsWith("." + delegatedPrefix)) {
      return recordName;
    }
    return `${recordName}.${delegatedPrefix}`;
  };

  let data: unknown = null;

  if (operation === "HOSTINGER_VPS_BOOTSTRAP_GIT") {
    data = await runHostingerGitBootstrapOverSsh();
  } else if (operation === "HOSTINGER_AI_WORKERS_DEPLOY") {
    try {
      data = await runAiWorkersDeployOverSsh();
    } catch (error) {
      const rawDetail = error instanceof Error ? error.message : String(error);
      const diagnostic = sanitizeAiWorkersDeployDiagnostic(rawDetail);
      data = {
        transport: "ssh",
        host: config.sshHost,
        user: config.sshUser,
        port: Number(config.sshPort),
        directory: valueOf("directory") || config.aiWorkersDeployPath,
        envFile: valueOf("envfile") || config.aiWorkersEnvFile,
        deployed: false,
        failed: true,
        stage: classifyAiWorkersDeployFailure(diagnostic),
        diagnostic,
        retryable: !/preflight_target_path|preflight_env_file/.test(classifyAiWorkersDeployFailure(diagnostic)),
      };
    }
  } else if (operation === "HOSTINGER_SSH_AUTH_DIAGNOSTIC") {
    const privateKey = config.sshPrivateKey;
    if (!privateKey) throw new Error("Hostinger SSH diagnostic requires configured SSH private key.");
    const tempDir = await mkdtemp(join(tmpdir(), "ai-core-hostinger-ssh-diag-"));
    const keyPath = join(tempDir, "id_hostinger");
    try {
      await writeFile(keyPath, privateKey.endsWith("\n") ? privateKey : privateKey + "\n", { mode: 0o600 });
      const { stdout } = await execFileWithInput("ssh-keygen", ["-y", "-f", keyPath], {
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      });
      const derived = stdout.trim().split(/\s+/);
      if (derived.length < 2) throw new Error("ssh-keygen returned no usable public key.");
      data = {
        keyType: derived[0],
        publicKey: derived.slice(0, 2).join(" "),
        source: (env["HOSTINGER_SSH_PRIVATE_KEY"] ?? "").trim()
          ? "HOSTINGER_SSH_PRIVATE_KEY"
          : (env["AI_WORKERS_SSH_PRIVATE_KEY_B64"] ?? "").trim()
            ? "AI_WORKERS_SSH_PRIVATE_KEY_B64"
            : "AI_WORKERS_SSH_PRIVATE_KEY",
        privateKeyExposed: false,
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } else if (operation === "HOSTINGER_SSH_PUBLIC_KEY_LIST") {
    if (!config.vmId) throw new Error("Hostinger SSH key list requires HOSTINGER_VPS_ID.");
    const listed = await firstSuccessful(
      `/vps/v1/virtual-machines/${encodeURIComponent(config.vmId)}/public-keys`,
      "GET",
    );
    if (listed.status < 200 || listed.status >= 300) {
      throw new Error(`Hostinger VPS SSH key list failed with HTTP ${listed.status}.`);
    }
    const payload = listed.data as { data?: unknown[] } | unknown[] | null;
    const items = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)
        ? (payload as { data: unknown[] }).data
        : [];
    data = items.map((item) => {
      const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        id: value["id"] ?? null,
        name: value["name"] ?? null,
      };
    });
  } else if (operation === "HOSTINGER_SSH_PUBLIC_KEY_ATTACH") {
    if (!config.vmId) throw new Error("Hostinger SSH key attach requires HOSTINGER_VPS_ID.");
    const key = valueOf("key");
    const name = valueOf("name") || "ai-core-hostinger";
    if (!key || !/^ssh-(?:ed25519|rsa)\s+[A-Za-z0-9+/=]+(?:\s+.*)?$/.test(key)) {
      throw new Error("Hostinger SSH key attach requires key=<OpenSSH-public-key>.");
    }

    const existing = await firstSuccessful("/vps/v1/public-keys", "GET");
    if (existing.status < 200 || existing.status >= 300) {
      throw new Error(`Hostinger SSH public key list failed with HTTP ${existing.status}.`);
    }
    const payload = existing.data as { data?: unknown[] } | unknown[] | null;
    const items = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)
        ? (payload as { data: unknown[] }).data
        : [];
    const normalizedKey = key.trim();
    const match = items
      .filter((item) => item && typeof item === "object")
      .map((item) => item as Record<string, unknown>)
      .find((item) => String(item["key"] ?? "").trim() === normalizedKey);

    let publicKeyId = match ? Number(match["id"]) : NaN;
    if (!Number.isInteger(publicKeyId) || publicKeyId <= 0) {
      const created = await firstSuccessful("/vps/v1/public-keys", "POST", {
        name,
        key: normalizedKey,
      });
      if (created.status < 200 || created.status >= 300) {
        throw new Error(`Hostinger SSH public key create failed with HTTP ${created.status}.`);
      }
      const createdValue = created.data && typeof created.data === "object"
        ? created.data as Record<string, unknown>
        : {};
      publicKeyId = Number(createdValue["id"]);
      if (!Number.isInteger(publicKeyId) || publicKeyId <= 0) {
        throw new Error("Hostinger SSH public key create returned no usable id.");
      }
    }

    const attached = await firstSuccessful(
      `/vps/v1/public-keys/attach/${encodeURIComponent(config.vmId)}`,
      "POST",
      { ids: [publicKeyId] },
    );
    if (attached.status < 200 || attached.status >= 300) {
      throw new Error(`Hostinger SSH public key attach failed with HTTP ${attached.status}.`);
    }
    data = {
      virtualMachineId: config.vmId,
      publicKeyId,
      name,
      attached: true,
      result: attached.data,
    };
  } else if ([
    "HOSTINGER_DNS_LIST",
    "HOSTINGER_DNS_SUBDOMAIN_CREATE",
    "HOSTINGER_DNS_RECORD_CREATE",
    "HOSTINGER_DNS_RECORD_UPDATE",
    "HOSTINGER_DNS_RECORD_DELETE",
  ].includes(operation)) {
    const requestedDnsDomain = valueOf("domain") || hostingDomain;
    if (!requestedDnsDomain) throw new Error("DNS operations require domain=<domain>.");

    let dnsDomain = requestedDnsDomain;
    let zonePath = `/dns/v1/zones/${encodeURIComponent(dnsDomain)}`;

    const fallbackToParentZone = async (): Promise<boolean> => {
      const resolved = await resolveParentDnsZone(requestedDnsDomain);
      if (!resolved || resolved === dnsDomain) return false;
      dnsDomain = resolved;
      zonePath = `/dns/v1/zones/${encodeURIComponent(dnsDomain)}`;
      return true;
    };

    if (operation === "HOSTINGER_DNS_LIST") {
      let result = await firstSuccessful(zonePath, "GET");
      if (isDnsZoneMiss(result) && await fallbackToParentZone()) {
        result = await firstSuccessful(zonePath, "GET");
      }
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Hostinger DNS list failed with HTTP ${result.status}.`);
      }
      data = dnsDomain === requestedDnsDomain
        ? result.data
        : { requestedDomain: requestedDnsDomain, zoneDomain: dnsDomain, records: result.data };
    } else if (operation === "HOSTINGER_DNS_RECORD_DELETE") {
      const rawName = valueOf("name") || valueOf("subdomain");
      const type = valueOf("type").toUpperCase();
      if (!rawName) throw new Error("DNS record delete requires name=<record-name>.");
      if (!type) throw new Error("DNS record delete requires type=<record-type>.");

      let name = rawName;
      let result = await firstSuccessful(zonePath, "DELETE", {
        filters: [{ name, type }],
      });
      if (isDnsZoneMiss(result) && await fallbackToParentZone()) {
        name = zoneRelativeRecordName(requestedDnsDomain, dnsDomain, rawName);
        result = await firstSuccessful(zonePath, "DELETE", {
          filters: [{ name, type }],
        });
      }
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Hostinger DNS delete failed with HTTP ${result.status}.`);
      }
      data = {
        domain: dnsDomain,
        ...(dnsDomain !== requestedDnsDomain ? { requestedDomain: requestedDnsDomain } : {}),
        name,
        type,
        deleted: true,
        result: result.data,
      };
    } else {
      const legacySubdomain = operation === "HOSTINGER_DNS_SUBDOMAIN_CREATE";
      const rawName = valueOf("name") || valueOf("subdomain") || "@";
      const content = valueOf("content") || valueOf("target");
      const requestedType = valueOf("type").toUpperCase();
      if (!content) throw new Error("DNS record mutation requires content=<record-value> or target=<record-value>.");

      const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(content);
      const ipv6 = /^[0-9a-f:]+$/i.test(content) && content.includes(":");
      const type = requestedType || (ipv4 ? "A" : ipv6 ? "AAAA" : "CNAME");
      const allowedTypes = new Set(["A", "AAAA", "CNAME", "TXT", "MX", "SRV", "CAA", "NS"]);
      if (!allowedTypes.has(type)) {
        throw new Error("DNS record type must be one of A, AAAA, CNAME, TXT, MX, SRV, CAA, or NS.");
      }
      if (legacySubdomain && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(rawName)) {
        throw new Error("DNS subdomain create requires a valid subdomain=<prefix>.");
      }

      const ttlRaw = valueOf("ttl");
      const ttl = ttlRaw ? Number.parseInt(ttlRaw, 10) : 300;
      if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400) {
        throw new Error("DNS ttl must be an integer between 60 and 86400.");
      }

      const overwrite = operation === "HOSTINGER_DNS_RECORD_UPDATE" || boolOf("overwrite") === true;
      let name = rawName;
      const buildBody = () => ({
        overwrite,
        zone: [{
          name,
          type,
          ttl,
          records: [{ content }],
        }],
      });

      let body = buildBody();
      let validation = await firstSuccessful(`${zonePath}/validate`, "POST", body);
      if (isDnsZoneMiss(validation) && await fallbackToParentZone()) {
        name = zoneRelativeRecordName(requestedDnsDomain, dnsDomain, rawName);
        body = buildBody();
        validation = await firstSuccessful(`${zonePath}/validate`, "POST", body);
      }
      if (validation.status < 200 || validation.status >= 300) {
        throw new Error(`Hostinger DNS validation failed with HTTP ${validation.status}.`);
      }

      let result = await firstSuccessful(zonePath, "PUT", body);
      if (result.status === 404 && dnsDomain === requestedDnsDomain && await fallbackToParentZone()) {
        name = zoneRelativeRecordName(requestedDnsDomain, dnsDomain, rawName);
        body = buildBody();
        validation = await firstSuccessful(`${zonePath}/validate`, "POST", body);
        if (validation.status < 200 || validation.status >= 300) {
          throw new Error(`Hostinger DNS validation failed with HTTP ${validation.status}.`);
        }
        result = await firstSuccessful(zonePath, "PUT", body);
      }
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Hostinger DNS update failed with HTTP ${result.status}.`);
      }
      data = {
        domain: dnsDomain,
        ...(dnsDomain !== requestedDnsDomain ? { requestedDomain: requestedDnsDomain } : {}),
        name,
        type,
        content,
        ttl,
        overwrite,
        validation: validation.data,
        result: result.data,
      };
    }
  } else if (operation === "HOSTINGER_HOSTING_DISCOVERY") {
    const { payload, websites } = await discoverHostingWebsites();
    data = {
      websites: websites.map((site) => {
        const value = site && typeof site === "object" ? site as Record<string, unknown> : {};
        return {
          domain: value["domain"] ?? null,
          username: value["username"] ?? null,
          order_id: value["order_id"] ?? null,
          website_type: value["website_type"] ?? null,
          is_enabled: value["is_enabled"] ?? null,
          root_directory: value["root_directory"] ?? null,
        };
      }),
      suggested_configuration: websites
        .filter((site) => site && typeof site === "object")
        .map((site) => site as Record<string, unknown>)
        .filter((site) => site["username"] && site["domain"])
        .map((site) => ({
          HOSTINGER_HOSTING_USERNAME: String(site["username"]),
          HOSTINGER_HOSTING_DOMAIN: String(site["domain"]),
        })),
      meta: payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as { meta?: unknown }).meta ?? null
        : null,
    };
  } else if (operation === "HOSTINGER_DOMAIN_AVAILABILITY") {
    const rawDomain = valueOf("name") || hostingDomain;
    const tlds = (valueOf("tlds") || "com").split("|").map((v) => v.replace(/^\./, "").trim()).filter(Boolean);
    const bareName = rawDomain.includes(".") ? rawDomain.split(".")[0] : rawDomain;
    if (!bareName) throw new Error("Domain availability requires name=<domain-name>.");
    const result = await firstSuccessful("/domains/v1/availability", "POST", {
      domain: bareName,
      tlds,
      with_alternatives: boolOf("alternatives") ?? false,
    });
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Hostinger domain availability failed with HTTP ${result.status}.`);
    }
    data = result.data;
  } else if ([
    "HOSTINGER_PARKED_DOMAIN_LIST",
    "HOSTINGER_PARKED_DOMAIN_CREATE",
    "HOSTINGER_PARKED_DOMAIN_DELETE",
  ].includes(operation)) {
    const target = await resolveHostingTarget();
    const path =
      `/hosting/v1/accounts/${encodeURIComponent(target.username)}/websites/${encodeURIComponent(target.domain)}/parked-domains`;
    if (operation === "HOSTINGER_PARKED_DOMAIN_LIST") {
      const result = await firstSuccessful(path, "GET");
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Hostinger parked-domain list failed with HTTP ${result.status}.`);
      }
      data = { target, parkedDomains: result.data };
    } else {
      const parkedDomain = valueOf("parked_domain") || valueOf("alias") || valueOf("name");
      if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(parkedDomain)) {
        throw new Error(
          operation === "HOSTINGER_PARKED_DOMAIN_DELETE"
            ? "Parked-domain delete requires parked_domain=<fully-qualified-domain>."
            : "Parked-domain create requires parked_domain=<fully-qualified-domain>.",
        );
      }
      if (operation === "HOSTINGER_PARKED_DOMAIN_DELETE") {
        const result = await firstSuccessful(
          `${path}/${encodeURIComponent(parkedDomain)}`,
          "DELETE",
        );
        if (result.status < 200 || result.status >= 300) {
          throw new Error(`Hostinger parked-domain delete failed with HTTP ${result.status}.`);
        }
        data = { target, parkedDomain, deleted: true, result: result.data };
      } else {
        const result = await firstSuccessful(path, "POST", { parked_domain: parkedDomain });
        if (result.status < 200 || result.status >= 300) {
          throw new Error(`Hostinger parked-domain create failed with HTTP ${result.status}.`);
        }
        data = { target, parkedDomain, result: result.data };
      }
    }
  } else if ([
    "HOSTINGER_SUBDOMAIN_LIST",
    "HOSTINGER_SUBDOMAIN_CREATE",
    "HOSTINGER_SUBDOMAIN_DELETE",
  ].includes(operation)) {
    const target = await resolveHostingTarget();
    const path =
      `/hosting/v1/accounts/${encodeURIComponent(target.username)}/websites/${encodeURIComponent(target.domain)}/subdomains`;
    if (operation === "HOSTINGER_SUBDOMAIN_LIST") {
      const result = await firstSuccessful(path, "GET");
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Hostinger subdomain list failed with HTTP ${result.status}.`);
      }
      data = { target, subdomains: result.data };
    } else {
      const subdomain = valueOf("subdomain");
      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(subdomain)) {
        throw new Error(
          operation === "HOSTINGER_SUBDOMAIN_DELETE"
            ? "Subdomain delete requires a valid subdomain=<prefix>."
            : "Subdomain create requires a valid subdomain=<prefix>.",
        );
      }
      if (operation === "HOSTINGER_SUBDOMAIN_DELETE") {
        const result = await firstSuccessful(
          `${path}/${encodeURIComponent(subdomain)}`,
          "DELETE",
        );
        if (result.status < 200 || result.status >= 300) {
          throw new Error(`Hostinger subdomain delete failed with HTTP ${result.status}.`);
        }
        data = { target, subdomain, deleted: true, result: result.data };
      } else {
        const directory = valueOf("directory");
        const usePublic = boolOf("public");
        const body: Record<string, unknown> = { subdomain };
        if (directory) body.directory = directory;
        if (usePublic !== undefined) body.is_using_public_directory = usePublic;
        const result = await firstSuccessful(path, "POST", body);
        if (result.status < 200 || result.status >= 300) {
          throw new Error(`Hostinger subdomain create failed with HTTP ${result.status}.`);
        }
        data = { target, subdomain, result: result.data };
      }
    }
  } else {
    if (!config.vmId) {
      throw new Error("Hostinger VPS/Docker operations require HOSTINGER_VPS_ID.");
    }
    const vmBase = `/vps/v1/virtual-machines/${encodeURIComponent(config.vmId)}`;

    const resolveDockerProject = async (): Promise<string> => {
      const result = await firstSuccessful(`${vmBase}/docker`, "GET");
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Hostinger Docker project discovery failed with HTTP ${result.status}.`);
      }
      const payload = result.data as { data?: unknown[] } | unknown[] | null;
      const items = Array.isArray(payload)
        ? payload
        : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)
          ? (payload as { data: unknown[] }).data
          : [];
      const names = Array.from(new Set(
        items
          .filter((item) => item && typeof item === "object")
          .map((item) => {
            const value = item as Record<string, unknown>;
            return String(
              value["project_name"] ??
              value["projectName"] ??
              value["name"] ??
              "",
            ).trim();
          })
          .filter(Boolean),
      ));

      if (names.length === 1) return names[0]!;
      if (names.length === 0) {
        throw new Error(
          "No Hostinger Docker project is accessible. Specify project=<name> for deploy or configure HOSTINGER_DOCKER_PROJECT.",
        );
      }
      throw new Error(
        `Multiple Hostinger Docker projects are accessible (${names.join(", ")}). Specify project=<name> or configure HOSTINGER_DOCKER_PROJECT.`,
      );
    };

    if (
      operation.startsWith("HOSTINGER_DOCKER_") &&
      operation !== "HOSTINGER_DOCKER_LIST" &&
      operation !== "HOSTINGER_DOCKER_DEPLOY" &&
      !project
    ) {
      try {
        project = await resolveDockerProject();
      } catch (error) {
        if (!isDockerManagerUnsupported(error)) throw error;
        // Docker Manager cannot enumerate projects on a generic Ubuntu VPS.
        // SSH fallback therefore needs an explicit/configured project name.
        project = valueOf("project") || config.dockerProject;
        if (!project) {
          throw new Error(
            "Hostinger Docker Manager is unavailable on this OS. SSH fallback requires project=<name> or HOSTINGER_DOCKER_PROJECT.",
          );
        }
      }
    }

    if (operation === "HOSTINGER_DOCKER_LIST") {
      const result = await firstSuccessful(`${vmBase}/docker`, "GET");
      if (result.status < 200 || result.status >= 300) throw new Error(`Hostinger Docker list failed with HTTP ${result.status}.`);
      data = result.data;
    } else if (operation.startsWith("HOSTINGER_DOCKER_")) {
      if (operation !== "HOSTINGER_DOCKER_DEPLOY" && !project) {
        throw new Error("Docker operation requires HOSTINGER_DOCKER_PROJECT or project=<name>.");
      }
      if (project && !/^[A-Za-z0-9_-]+$/.test(project)) {
        throw new Error("Docker project name may contain only letters, numbers, dashes, and underscores.");
      }

      if (operation === "HOSTINGER_DOCKER_ENV_SET") {
        if (!project) throw new Error("Hostinger env/secret update requires project=<docker-project>.");
        const inline = valueOf("env") || valueOf("secret");
        let key = valueOf("key") || valueOf("name");
        let secretValue = valueOf("value");
        if ((!key || !secretValue) && inline.includes("=")) {
          const separator = inline.indexOf("=");
          key = key || inline.slice(0, separator).trim();
          secretValue = secretValue || inline.slice(separator + 1);
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
          throw new Error("Hostinger env/secret update requires key=<ENV_NAME>.");
        }
        if (!secretValue) {
          throw new Error("Hostinger env/secret update requires value=<secret-value> or env=KEY=value.");
        }

        try {
          const encodedProject = encodeURIComponent(project);
          const current = await firstSuccessful(`${vmBase}/docker/${encodedProject}`, "GET");
          if (current.status < 200 || current.status >= 300) {
            throw new Error(`Hostinger Docker project read failed with HTTP ${current.status}.`);
          }
          const currentProject = current.data && typeof current.data === "object"
            ? current.data as Record<string, unknown>
            : {};
          const content = typeof currentProject["content"] === "string" ? currentProject["content"] : "";
          if (!content) throw new Error("Hostinger Docker project response did not include compose content.");
          const variables = parseEnvironment(
            typeof currentProject["environment"] === "string" ? currentProject["environment"] : "",
          );
          variables.set(key, secretValue);
          const environment = serializeEnvironment(variables);
          const result = await firstSuccessful(`${vmBase}/docker`, "POST", {
            project_name: project,
            content,
            environment,
          });
          if (result.status < 200 || result.status >= 300) {
            throw new Error(`Hostinger Docker environment update failed with HTTP ${result.status}.`);
          }
          data = {
            project,
            key,
            value: "[REDACTED]",
            environmentVariableCount: variables.size,
            result: result.data,
          };
        } catch (error) {
          if (!isDockerManagerUnsupported(error)) throw error;
          data = await runDockerOverSsh(operation, project, {
            envKey: key,
            envValue: secretValue,
          });
        }
      } else if (operation === "HOSTINGER_DOCKER_DEPLOY") {
        const deployProject = project || valueOf("project");
        const content = valueOf("content");
        const environment = valueOf("env");
        if (!deployProject || !content) {
          throw new Error("Docker deploy requires project=<name> and content=<compose URL or raw YAML>.");
        }
        if (!/^[A-Za-z0-9_-]+$/.test(deployProject)) {
          throw new Error("Docker project name may contain only letters, numbers, dashes, and underscores.");
        }

        try {
          const body: Record<string, unknown> = { project_name: deployProject, content };
          if (environment) body.environment = environment;
          const result = await firstSuccessful(`${vmBase}/docker`, "POST", body);
          if (result.status < 200 || result.status >= 300) {
            throw new Error(`Hostinger Docker deploy failed with HTTP ${result.status}.`);
          }
          data = result.data;
        } catch (error) {
          if (!isDockerManagerUnsupported(error)) throw error;
          data = await runDockerOverSsh(operation, deployProject, {
            content,
            environment,
          });
        }
      } else {
        const encodedProject = encodeURIComponent(project);
        const suffix =
          operation === "HOSTINGER_DOCKER_CONTAINERS" ? "/containers" :
          operation === "HOSTINGER_DOCKER_LOGS" ? "/logs" :
          operation === "HOSTINGER_DOCKER_START" ? "/start" :
          operation === "HOSTINGER_DOCKER_STOP" ? "/stop" :
          operation === "HOSTINGER_DOCKER_RESTART" ? "/restart" :
          operation === "HOSTINGER_DOCKER_UPDATE" ? "/update" : "";
        const method = ["HOSTINGER_DOCKER_START","HOSTINGER_DOCKER_STOP","HOSTINGER_DOCKER_RESTART","HOSTINGER_DOCKER_UPDATE"].includes(operation)
          ? "POST" : "GET";
        try {
          const result = await firstSuccessful(`${vmBase}/docker/${encodedProject}${suffix}`, method);
          if (result.status < 200 || result.status >= 300) {
            throw new Error(`Hostinger Docker operation failed with HTTP ${result.status}.`);
          }
          data = result.data;
        } catch (error) {
          if (!isDockerManagerUnsupported(error)) throw error;
          data = await runDockerOverSsh(operation, project);
        }
      }
    } else {
      let suffix = "";
      let method = "GET";
      if (operation === "HOSTINGER_VPS_START") { suffix = "/start"; method = "POST"; }
      if (operation === "HOSTINGER_VPS_STOP") { suffix = "/stop"; method = "POST"; }
      if (operation === "HOSTINGER_VPS_RESTART") { suffix = "/restart"; method = "POST"; }

      let result = await firstSuccessful(vmBase + suffix, method);
      if (result.status === 404 && operation === "HOSTINGER_VPS_STATUS") {
        result = await firstSuccessful("/vps/v1/virtual-machines", "GET");
        const payload = result.data as { data?: unknown[] } | unknown[] | null;
        const machines = Array.isArray(payload)
          ? payload
          : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)
            ? (payload as { data: unknown[] }).data
            : [];
        const exact = machines.find((machine) =>
          machine && typeof machine === "object" && String((machine as { id?: unknown }).id ?? "") === config.vmId);
        if (exact) data = exact;
        else if (machines.length === 1) {
          data = {
            ...(machines[0] as Record<string, unknown>),
            configured_vps_id: config.vmId,
            discovered_vps_id: (machines[0] as { id?: unknown }).id ?? null,
            configuration_warning: "HOSTINGER_VPS_ID does not match the only VPS accessible by this token.",
          };
        } else if (machines.length > 1) {
          data = {
            configured_vps_id: config.vmId,
            accessible_virtual_machines: machines,
            configuration_warning: "HOSTINGER_VPS_ID was not found; multiple VPS instances are accessible.",
          };
        }
      } else {
        data = result.data;
      }
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Hostinger operation failed with HTTP ${result.status}. Verify HOSTINGER_VPS_ID or set HOSTINGER_API_BASE.`);
      }
    }
  }

  const readOnly = new Set<AiCoreInfrastructureOperation>([
    "HOSTINGER_VPS_STATUS",
    "HOSTINGER_SSH_PUBLIC_KEY_LIST",
    "HOSTINGER_DOCKER_LIST",
    "HOSTINGER_DOCKER_STATUS",
    "HOSTINGER_DOCKER_CONTAINERS",
    "HOSTINGER_DOCKER_LOGS",
    "HOSTINGER_SUBDOMAIN_LIST",
    "HOSTINGER_PARKED_DOMAIN_LIST",
    "HOSTINGER_DNS_LIST",
    "HOSTINGER_DOMAIN_AVAILABILITY",
    "HOSTINGER_HOSTING_DISCOVERY",
  ]);
  const mutating = !readOnly.has(operation);
  const aiWorkersDeployFailed =
    operation === "HOSTINGER_AI_WORKERS_DEPLOY" &&
    Boolean(data && typeof data === "object" && (data as Record<string, unknown>)["failed"] === true);
  return {
    operation,
    provider: "hostinger",
    mutating,
    reply: aiWorkersDeployFailed
      ? "Deploy AI Workers gagal di remote runtime; detail aman dikembalikan untuk diagnosis dan retry."
      : mutating
        ? `Operasi ${operation} diterima Hostinger.`
        : `Status Hostinger untuk ${operation} berhasil dibaca.`,
    data: safeJson(data),
  };
}

async function callWhatsappGatewayStatus(env: NodeJS.ProcessEnv): Promise<AiCoreInfrastructureResult> {
  const baseUrl = (env["CST_WA_GATEWAY_URL"] ?? "https://wa.cstlogistic.co.id").trim().replace(/\/$/, "");
  const apiKey = (env["CST_WA_GATEWAY_API_KEY"] ?? env["CST_WA_GATEWAY_TOKEN"] ?? "").trim();
  const notifyTo = (env["AI_CODING_WA_NOTIFY_TO"] ?? "").trim();
  const configuredDevice = (env["AI_CORE_WA_REPLY_DEVICE_ID"] ?? "").trim();
  const configured = {
    baseUrl: Boolean(baseUrl),
    apiKey: Boolean(apiKey),
    adminTarget: Boolean(notifyTo),
    replyDevice: Boolean(configuredDevice),
  };
  if (!baseUrl || !apiKey) {
    return {
      operation: "WHATSAPP_GATEWAY_STATUS",
      provider: "ai-core",
      mutating: false,
      reply: "Konfigurasi WhatsApp Gateway belum lengkap.",
      data: { configured, reachable: false, adminTargetConfigured: Boolean(notifyTo) },
    };
  }

  const headers = { authorization: `Bearer ${apiKey}`, accept: "application/json" };
  const attempts: Array<{ path: string; status: number | null; ok: boolean; data?: unknown }> = [];
  for (const path of ["/healthz", "/health", "/v1/devices"]) {
    try {
      const response = await fetch(baseUrl + path, { headers, signal: AbortSignal.timeout(10_000) });
      const body = await response.text();
      let data: unknown = body;
      try { data = body ? JSON.parse(body) : null; } catch { /* text response */ }
      attempts.push({ path, status: response.status, ok: response.ok, data: safeJson(data) });
    } catch (error) {
      attempts.push({ path, status: null, ok: false, data: error instanceof Error ? error.message : String(error) });
    }
  }
  const reachable = attempts.some((attempt) => attempt.ok);
  return {
    operation: "WHATSAPP_GATEWAY_STATUS",
    provider: "ai-core",
    mutating: false,
    reply: reachable
      ? "WhatsApp Gateway dapat dijangkau; konfigurasi admin dibaca tanpa mengirim pesan."
      : "WhatsApp Gateway belum dapat diverifikasi dari runtime AI Core.",
    data: {
      configured,
      reachable,
      adminTargetConfigured: Boolean(notifyTo),
      adminTargetMasked: notifyTo ? `***${notifyTo.slice(-4)}` : null,
      checks: attempts,
    },
  };
}

export async function executeAiCoreInfrastructureOperation(input: {
  operation: AiCoreInfrastructureOperation;
  requestedBy?: string;
  message?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<AiCoreInfrastructureResult> {
  const env = input.env ?? process.env;
  let result: AiCoreInfrastructureResult;

  if (input.operation === "WHATSAPP_GATEWAY_STATUS") {
    result = await callWhatsappGatewayStatus(env);
  } else if (input.operation === "EXTERNAL_AGENT_DIAGNOSTIC") {
    const { getExternalAgentDiagnostic } = await import("./localCodingControlBridgeService.js");
    const commandId =
      input.message?.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)?.[0] ??
      null;
    const diagnostic = await getExternalAgentDiagnostic({
      commandId,
      clientIdContains: /openhands/i.test(input.message ?? "") ? "openhands" : "openclaw",
    });
    result = {
      operation: input.operation,
      provider: "ai-core",
      mutating: false,
      reply: diagnostic
        ? "Diagnosis kegagalan external agent berhasil dibaca."
        : "Tidak ditemukan kegagalan external agent yang cocok untuk diagnosis.",
      data: {
        diagnostic,
        detailCaptured: Boolean(
          diagnostic?.latestResponse &&
          (
            Object.keys(diagnostic.latestResponse.metadata ?? {}).length > 0 ||
            Object.keys(diagnostic.latestResponse.checkpoint ?? {}).length > 0
          )
        ),
        note: diagnostic?.latestResponse
          ? "Jika error.message/type/code/param tidak ada pada metadata/checkpoint, detail upstream belum dipersist oleh supervisor/runtime."
          : "Tidak ada response terminal yang dapat dianalisis.",
      },
    };
  } else if (input.operation === "EXTERNAL_AGENT_STATUS") {
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
    result = await callHostinger(input.operation, env, input.message ?? "");
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
