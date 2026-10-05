import { GoogleAuth, type GoogleAuthOptions } from "google-auth-library";

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
  | "HOSTINGER_DOCKER_LIST"
  | "HOSTINGER_DOCKER_STATUS"
  | "HOSTINGER_DOCKER_CONTAINERS"
  | "HOSTINGER_DOCKER_LOGS"
  | "HOSTINGER_DOCKER_DEPLOY"
  | "HOSTINGER_DOCKER_START"
  | "HOSTINGER_DOCKER_STOP"
  | "HOSTINGER_DOCKER_RESTART"
  | "HOSTINGER_DOCKER_UPDATE"
  | "HOSTINGER_SUBDOMAIN_LIST"
  | "HOSTINGER_SUBDOMAIN_CREATE"
  | "HOSTINGER_DNS_LIST"
  | "HOSTINGER_DNS_SUBDOMAIN_CREATE"
  | "HOSTINGER_DNS_RECORD_CREATE"
  | "HOSTINGER_DNS_RECORD_UPDATE"
  | "HOSTINGER_DNS_RECORD_DELETE"
  | "HOSTINGER_DOCKER_ENV_SET"
  | "HOSTINGER_DOMAIN_AVAILABILITY"
  | "HOSTINGER_HOSTING_DISCOVERY"
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

  // Hostinger capacity/resource inspection must outrank incidental external-agent
  // names (for example when evaluating whether OpenClaw can be moved there).
  if (/\b(hostinger|hpanel|vps)\b/i.test(text) &&
      /\b(kapasitas|capacity|resource|resources|cpu|vcpu|ram|memory|memori|swap|disk|storage|load|utilization|utilisation|penggunaan|headroom)\b/i.test(text) &&
      /\b(cek|check|status|health|audit|inspect|periksa|lihat|verifikasi|verify|kapasitas|capacity|resource|resources)\b/i.test(text)) {
    return "HOSTINGER_VPS_STATUS";
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

  if (/\b(hostinger|hpanel)\b/i.test(text) &&
      /\b(secret|secrets|env|environment|environment variable|variabel environment)\b/i.test(text) &&
      /\b(set|add|tambah|masukkan|masukan|simpan|update|ubah|ganti|apply|pasang)\b/i.test(text) &&
      !/(?:^|\s)content\s*=/i.test(text)) {
    return "HOSTINGER_DOCKER_ENV_SET";
  }

  if (/\b(hostinger|hpanel)\b/i.test(text) && /\b(dns|zone|record)\b/i.test(text)) {
    if (/\b(delete|hapus|remove)\b/i.test(text)) return "HOSTINGER_DNS_RECORD_DELETE";
    if (/\b(update|ubah|ganti|replace|overwrite)\b/i.test(text)) return "HOSTINGER_DNS_RECORD_UPDATE";
    if (/\b(create|buat|add|tambah|pasang)\b/i.test(text) && !/\bsubdomain\b/i.test(text)) {
      return "HOSTINGER_DNS_RECORD_CREATE";
    }
  }

  if (/\b(hostinger|hpanel)\b/i.test(text) && /\bsubdomain\b/i.test(text)) {
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

function hostingerConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    token: (env["HOSTINGER_API_TOKEN"] ?? "").trim(),
    vmId: (env["HOSTINGER_VPS_ID"] ?? "").trim(),
    dockerProject: (env["HOSTINGER_DOCKER_PROJECT"] ?? "").trim(),
    hostingUsername: (env["HOSTINGER_HOSTING_USERNAME"] ?? "").trim(),
    hostingDomain: (env["HOSTINGER_HOSTING_DOMAIN"] ?? "").trim(),
    apiBase: (env["HOSTINGER_API_BASE"] ?? "").trim().replace(/\/$/, ""),
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
  const project = valueOf("project") || config.dockerProject;
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
      if (result.response.status !== 404) {
        const detail =
          typeof result.data === "string"
            ? result.data.slice(0, 500)
            : JSON.stringify(result.data ?? {}).slice(0, 500);
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

  if ([
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
      if (result.status === 404 && await fallbackToParentZone()) {
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
      if (result.status === 404 && await fallbackToParentZone()) {
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
      if (validation.status === 404 && await fallbackToParentZone()) {
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
  } else if (operation === "HOSTINGER_SUBDOMAIN_LIST" || operation === "HOSTINGER_SUBDOMAIN_CREATE") {
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
        throw new Error("Subdomain create requires a valid subdomain=<prefix>.");
      }
      const directory = valueOf("directory");
      const usePublic = boolOf("public");
      const body: Record<string, unknown> = { subdomain };
      if (directory) body.directory = directory;
      if (usePublic !== undefined) body.is_using_public_directory = usePublic;
      const result = await firstSuccessful(path, "POST", body);
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Hostinger subdomain create failed with HTTP ${result.status}.`);
      }
      data = { target, result: result.data };
    }
  } else {
    if (!config.vmId) {
      throw new Error("Hostinger VPS/Docker operations require HOSTINGER_VPS_ID.");
    }
    const vmBase = `/vps/v1/virtual-machines/${encodeURIComponent(config.vmId)}`;

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
      } else if (operation === "HOSTINGER_DOCKER_DEPLOY") {
        const deployProject = project || valueOf("project");
        const content = valueOf("content");
        const environment = valueOf("env");
        if (!deployProject || !content) {
          throw new Error("Docker deploy requires project=<name> and content=<compose URL or raw YAML>.");
        }
        const body: Record<string, unknown> = { project_name: deployProject, content };
        if (environment) body.environment = environment;
        const result = await firstSuccessful(`${vmBase}/docker`, "POST", body);
        if (result.status < 200 || result.status >= 300) throw new Error(`Hostinger Docker deploy failed with HTTP ${result.status}.`);
        data = result.data;
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
        const result = await firstSuccessful(`${vmBase}/docker/${encodedProject}${suffix}`, method);
        if (result.status < 200 || result.status >= 300) throw new Error(`Hostinger Docker operation failed with HTTP ${result.status}.`);
        data = result.data;
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
    "HOSTINGER_DOCKER_LIST",
    "HOSTINGER_DOCKER_STATUS",
    "HOSTINGER_DOCKER_CONTAINERS",
    "HOSTINGER_DOCKER_LOGS",
    "HOSTINGER_SUBDOMAIN_LIST",
    "HOSTINGER_DNS_LIST",
    "HOSTINGER_DOMAIN_AVAILABILITY",
    "HOSTINGER_HOSTING_DISCOVERY",
  ]);
  const mutating = !readOnly.has(operation);
  return {
    operation,
    provider: "hostinger",
    mutating,
    reply: mutating
      ? `Operasi ${operation} diterima Hostinger.`
      : `Status Hostinger untuk ${operation} berhasil dibaca.`,
    data: safeJson(data),
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
