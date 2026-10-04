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

function actionOf(text: string): "status" | "start" | "stop" | "restart" | null {
  // A direct imperative action must win over incidental status/history words,
  // e.g. "start VM karena status terakhir TERMINATED".
  // Keep explicit read-only requests safe even if they mention action words.
  const explicitReadOnly = /\b(read[ -]?only|hanya baca|jangan (?:start|stop|restart|reboot|nyalakan|matikan|hidupkan|jalankan))\b/i.test(text);
  if (explicitReadOnly) return "status";
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

  if (/\b(hostinger|hpanel)\b/i.test(text) &&
      /\b(cari|find|discover|discovery|list|daftar|cek|check|lihat)\b/i.test(text) &&
      /\b(hosting username|hosting domain|hosting account|website|websites|akun hosting|domain hosting)\b/i.test(text)) {
    return "HOSTINGER_HOSTING_DISCOVERY";
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

  let data: unknown = null;

  if (operation === "HOSTINGER_DNS_LIST" || operation === "HOSTINGER_DNS_SUBDOMAIN_CREATE") {
    const dnsDomain = valueOf("domain") || hostingDomain;
    if (!dnsDomain) throw new Error("DNS operations require domain=<domain>.");
    const zonePath = `/dns/v1/zones/${encodeURIComponent(dnsDomain)}`;

    if (operation === "HOSTINGER_DNS_LIST") {
      const result = await firstSuccessful(zonePath, "GET");
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Hostinger DNS list failed with HTTP ${result.status}.`);
      }
      data = result.data;
    } else {
      const subdomain = valueOf("subdomain");
      const target = valueOf("target") || valueOf("content");
      const requestedType = valueOf("type").toUpperCase();
      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(subdomain)) {
        throw new Error("DNS subdomain create requires a valid subdomain=<prefix>.");
      }
      if (!target) throw new Error("DNS subdomain create requires target=<IPv4, IPv6, or hostname>.");

      const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(target);
      const ipv6 = /^[0-9a-f:]+$/i.test(target) && target.includes(":");
      const type = requestedType || (ipv4 ? "A" : ipv6 ? "AAAA" : "CNAME");
      if (!["A", "AAAA", "CNAME"].includes(type)) {
        throw new Error("DNS subdomain create supports only A, AAAA, or CNAME.");
      }
      const ttlRaw = valueOf("ttl");
      const ttl = ttlRaw ? Number.parseInt(ttlRaw, 10) : 300;
      if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400) {
        throw new Error("DNS ttl must be an integer between 60 and 86400.");
      }

      const body = {
        overwrite: false,
        zone: [{
          name: subdomain,
          type,
          ttl,
          records: [{ content: target }],
        }],
      };
      const validation = await firstSuccessful(`${zonePath}/validate`, "POST", body);
      if (validation.status < 200 || validation.status >= 300) {
        throw new Error(`Hostinger DNS validation failed with HTTP ${validation.status}.`);
      }
      const result = await firstSuccessful(zonePath, "PUT", body);
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Hostinger DNS update failed with HTTP ${result.status}.`);
      }
      data = {
        domain: dnsDomain,
        subdomain,
        type,
        target,
        ttl,
        overwrite: false,
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
      data = result.data;
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
      data = operation === "HOSTINGER_SUBDOMAIN_CREATE"
        ? { target, result: result.data }
        : { target, subdomains: result.data };
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

      if (operation === "HOSTINGER_DOCKER_DEPLOY") {
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
