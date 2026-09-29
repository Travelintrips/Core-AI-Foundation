import { execFile } from "node:child_process";
import { promisify } from "node:util";
const apiBase = (process.env["AICORE_REMOTE_URL"] ?? "https://aicore.cstlogistic.co.id").replace(/\/$/, "");
const enrollmentSecret = (process.env["OLLAMA_REMOTE_ENROLLMENT_SECRET"] ?? "").trim();
const ollamaBase = (process.env["OLLAMA_BASE_URL"] ?? "http://127.0.0.1:11434/v1").replace(/\/$/, "");
const modelId = (process.env["OLLAMA_WORKER_MODEL"] ?? "qwen2.5-coder:7b").trim();
const workerName = (process.env["OLLAMA_WORKER_NAME"] ?? "ollama-windows-worker").trim();
const nodeId = (process.env["OLLAMA_WORKER_NODE_ID"] ?? workerName).trim();
const pollMs = Math.max(500, Number(process.env["OLLAMA_REMOTE_POLL_MS"] ?? 1000));
const maxConcurrentJobs = Math.max(
  1,
  Math.min(4, Number(process.env["OLLAMA_WORKER_MAX_CONCURRENCY"] ?? 1)),
);
const invocationTimeoutMs = Math.max(
  10_000,
  Math.min(50_000, Number(process.env["OLLAMA_REMOTE_INVOCATION_TIMEOUT_MS"] ?? 45_000)),
);
const gcpAutoStopEnabled =
  (process.env["GCP_GPU_AUTO_STOP_ENABLED"] ?? "false").trim().toLowerCase() === "true";
const gcpIdleStopMs = Math.max(
  60_000,
  Math.min(30 * 60_000, Number(process.env["GCP_GPU_IDLE_STOP_MS"] ?? 300_000)),
);
const runSelfTest = process.argv.includes("--self-test");
const execFileAsync = promisify(execFile);
const powershellRoot = (process.env["LOCAL_CODING_POWERSHELL_ROOT"] ?? process.cwd()).trim();
const allowedScripts = new Set(["test", "typecheck", "lint", "build"]);
const forbiddenShellMeta = /[;&|><\x60\r\n\0]/;

if (!enrollmentSecret) throw new Error("OLLAMA_REMOTE_ENROLLMENT_SECRET is required");

async function json(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

async function verifyLocalOllama(): Promise<void> {
  const data = await json(await fetch(ollamaBase + "/models"));
  const models = Array.isArray(data["data"]) ? data["data"] : [];
  if (!models.some((item: any) => item?.id === modelId)) {
    throw new Error(`Ollama model '${modelId}' is not installed locally`);
  }
}

async function register(): Promise<{ workerId: number; token: string }> {
  const data = await json(await fetch(apiBase + "/api/ai/ollama-workers/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ollama-enrollment-secret": enrollmentSecret,
    },
    body: JSON.stringify({
      workerName,
      nodeId,
      modelId,
      maxConcurrentJobs,
      region: process.env["OLLAMA_WORKER_REGION"] ?? "remote",
    }),
  }));
  if (!Number.isInteger(data["workerId"]) || typeof data["heartbeatToken"] !== "string") {
    throw new Error("AI Core returned an invalid worker registration");
  }
  return { workerId: data["workerId"], token: data["heartbeatToken"] };
}

function workerHeaders(token: string): Record<string, string> {
  return { "content-type": "application/json", "x-ollama-worker-token": token };
}


async function queueSelfTest(workerId: number, token: string): Promise<void> {
  const data = await json(await fetch(apiBase + `/api/ai/ollama-workers/${workerId}/self-test`, {
    method: "POST",
    headers: workerHeaders(token),
    body: "{}",
  }));
  console.log(`Remote Ollama self-test queued: ${data["jobId"] ?? "unknown"} (${data["jobCode"] ?? "unknown"})`);
}

async function heartbeat(workerId: number, token: string): Promise<void> {
  await json(await fetch(apiBase + `/api/ai/ollama-workers/${workerId}/heartbeat`, {
    method: "POST", headers: workerHeaders(token), body: "{}",
  }));
}

async function claim(workerId: number, token: string): Promise<Record<string, any> | null> {
  const url = apiBase + `/api/ai/ollama-workers/${workerId}/claim`;
  const response = await fetch(url, {
    method: "POST", headers: workerHeaders(token), body: "{}",
  });
  if (response.status === 204) return null;
  if (response.status === 503) {
    const body = await response.text();
    const error = new Error(`CLAIM_TEMPORARILY_UNAVAILABLE: HTTP 503 from ${url}: ${body.slice(0, 240)}`);
    (error as Error & { code?: string }).code = "CLAIM_TEMPORARILY_UNAVAILABLE";
    throw error;
  }
  return json(response);
}

function parseBoundedInput(value: unknown): { system: string; user: string } {
  if (typeof value !== "string") throw new Error("Remote invocation input is invalid");
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (parsed["version"] !== 1 || typeof parsed["system"] !== "string" || typeof parsed["user"] !== "string") {
    throw new Error("Remote invocation bounded input is invalid");
  }
  return { system: parsed["system"], user: parsed["user"] };
}


function safeFilterName(value: string): boolean {
  return /^[@A-Za-z0-9._/*-]+$/.test(value) && !value.includes("..") && value.length <= 160;
}

function parseAllowlistedCommand(command: unknown): string | null {
  if (typeof command !== "string") return null;
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 300 || forbiddenShellMeta.test(normalized)) return null;

  if (["Get-Location", "Get-ChildItem", "Get-ChildItem -Name"].includes(normalized)) return normalized;
  if ([
    "git status --short",
    "git diff --check",
    "git diff --name-only",
    "git rev-parse HEAD",
    "node --version",
    "pnpm --version",
  ].includes(normalized)) return "& " + normalized;

  const parts = normalized.split(" ");
  if (parts[0] === "pnpm") {
    let script: string | undefined;
    if (parts.length === 2) script = parts[1];
    else if (parts.length === 3 && parts[1] === "run") script = parts[2];
    else if (parts.length === 4 && parts[1] === "--filter" && safeFilterName(parts[2] ?? "")) script = parts[3];
    else if (parts.length === 5 && parts[1] === "--filter" && safeFilterName(parts[2] ?? "") && parts[3] === "run") script = parts[4];
    if (script && allowedScripts.has(script)) return "& " + normalized;
  }

  if (parts[0] === "npm" && parts.length === 3 && parts[1] === "run" && allowedScripts.has(parts[2] ?? "")) {
    return "& " + normalized;
  }

  return null;
}

async function executePowerShell(payload: Record<string, any>): Promise<Record<string, unknown>> {
  const commands = Array.isArray(payload["commands"]) ? payload["commands"] : [];
  if (commands.length < 1 || commands.length > 6) throw new Error("Remote PowerShell command set is invalid");

  const results: Array<Record<string, unknown>> = [];
  for (const raw of commands) {
    const script = parseAllowlistedCommand(raw);
    if (!script) throw new Error("Remote PowerShell command is outside the trusted allowlist");
    const started = Date.now();
    try {
      const output = await execFileAsync(
        process.platform === "win32" ? "powershell.exe" : "pwsh",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        {
          cwd: powershellRoot,
          timeout: 180_000,
          maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, CI: "1", NO_COLOR: "1" },
        },
      );
      results.push({
        command: raw,
        status: "PASSED",
        exitCode: 0,
        stdout: String(output.stdout ?? "").slice(0, 200_000),
        stderr: String(output.stderr ?? "").slice(0, 100_000),
        durationMs: Date.now() - started,
      });
    } catch (error) {
      const typed = error as Error & { code?: number | string; stdout?: string; stderr?: string };
      results.push({
        command: raw,
        status: "FAILED",
        exitCode: typeof typed.code === "number" ? typed.code : null,
        stdout: String(typed.stdout ?? "").slice(0, 200_000),
        stderr: String(typed.stderr ?? typed.message ?? "").slice(0, 100_000),
        durationMs: Date.now() - started,
      });
      break;
    }
  }

  return {
    requestedBy: payload["requestedBy"] ?? null,
    modelId: payload["modelId"] ?? modelId,
    reason: payload["reason"] ?? null,
    status:
      results.length === commands.length && results.every((item) => item["status"] === "PASSED")
        ? "COMPLETED"
        : "FAILED",
    results,
  };
}

async function invoke(payload: Record<string, any>): Promise<Record<string, unknown>> {
  const bounded = parseBoundedInput(payload["input"]);
  const format = payload["responseFormat"] as Record<string, any>;
  const structured = format?.["type"] === "structured";
  const system = structured
    ? [bounded.system, "", "Return exactly one JSON object and no Markdown.", "The JSON object must satisfy this schema:", JSON.stringify(format["jsonSchema"] ?? {})].join("\n")
    : bounded.system;

  const data = await json(await fetch(ollamaBase + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "system", content: system }, { role: "user", content: bounded.user }],
      stream: false,
      temperature: 0,
      max_tokens: payload["maxOutputTokens"],
      ...(structured ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(invocationTimeoutMs),
  }));

  const text = data["choices"]?.[0]?.["message"]?.["content"];
  if (typeof text !== "string") throw new Error("Ollama returned a malformed response");
  const usage = data["usage"] ?? {};
  const inputTokens = Number.isInteger(usage["prompt_tokens"]) ? usage["prompt_tokens"] : 0;
  const outputTokens = Number.isInteger(usage["completion_tokens"]) ? usage["completion_tokens"] : 0;
  const totalTokens = Number.isInteger(usage["total_tokens"]) ? usage["total_tokens"] : inputTokens + outputTokens;

  return {
    ...(typeof data["id"] === "string" ? { providerRequestId: data["id"].slice(0, 200) } : {}),
    output: structured ? { type: "structured", value: JSON.parse(text) } : { type: "text", text },
    usage: { inputTokens, outputTokens, totalTokens },
  };
}

async function complete(workerId: number, token: string, jobId: number, result: Record<string, unknown>): Promise<void> {
  await json(await fetch(apiBase + `/api/ai/ollama-workers/${workerId}/jobs/${jobId}/complete`, {
    method: "POST", headers: workerHeaders(token), body: JSON.stringify({ result }),
  }));
}

async function retry(workerId: number, token: string, jobId: number, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await json(await fetch(apiBase + `/api/ai/ollama-workers/${workerId}/jobs/${jobId}/retry`, {
    method: "POST", headers: workerHeaders(token), body: JSON.stringify({ error: message.slice(0, 2000) }),
  }));
}

async function registerWithRetry(): Promise<{ workerId: number; token: string }> {
  for (;;) {
    try {
      const registration = await register();
      console.log(`Remote Ollama worker registered: ${registration.workerId} (${modelId})`);
      return registration;
    } catch (error) {
      console.error("Remote Ollama registration failed; retrying in 5s:", error);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

async function requestGcpSelfStop(): Promise<boolean> {
  if (!gcpAutoStopEnabled) return false;

  const metadataHeaders = { "Metadata-Flavor": "Google" };
  const metadataBase = "http://metadata.google.internal/computeMetadata/v1";

  try {
    const [projectRes, zoneRes, nameRes, tokenRes] = await Promise.all([
      fetch(metadataBase + "/project/project-id", { headers: metadataHeaders }),
      fetch(metadataBase + "/instance/zone", { headers: metadataHeaders }),
      fetch(metadataBase + "/instance/name", { headers: metadataHeaders }),
      fetch(metadataBase + "/instance/service-accounts/default/token", { headers: metadataHeaders }),
    ]);

    if (![projectRes, zoneRes, nameRes, tokenRes].every((response) => response.ok)) {
      throw new Error("GCP metadata is unavailable for auto-stop");
    }

    const project = (await projectRes.text()).trim();
    const zone = (await zoneRes.text()).trim().split("/").pop() ?? "";
    const instance = (await nameRes.text()).trim();
    const tokenData = await tokenRes.json() as { access_token?: unknown };
    const token = typeof tokenData.access_token === "string" ? tokenData.access_token : "";

    if (!project || !zone || !instance || !token) {
      throw new Error("GCP metadata returned incomplete auto-stop identity");
    }

    const response = await fetch(
      `https://compute.googleapis.com/compute/v1/projects/${encodeURIComponent(project)}/zones/${encodeURIComponent(zone)}/instances/${encodeURIComponent(instance)}/stop`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GCP self-stop failed HTTP ${response.status}: ${body.slice(0, 240)}`);
    }

    console.log(`GCP auto-stop requested after ${Math.round(gcpIdleStopMs / 1000)}s idle`);
    return true;
  } catch (error) {
    console.error("GCP auto-stop request failed:", error);
    return false;
  }
}

async function executeClaimedJob(
  registration: { workerId: number; token: string },
  job: Record<string, any>,
): Promise<void> {
  const jobId = Number(job["jobId"]);
  const heartbeatTimer = setInterval(() => {
    void heartbeat(registration.workerId, registration.token).catch(() => undefined);
  }, 20_000);
  heartbeatTimer.unref?.();

  try {
    const result =
      job["jobType"] === "ollama_powershell_execution"
        ? await executePowerShell(job["payload"] ?? {})
        : await invoke(job["payload"] ?? {});
    await complete(registration.workerId, registration.token, jobId, result);
    console.log(`Completed remote Ollama job ${jobId}`);
  } catch (error) {
    await retry(registration.workerId, registration.token, jobId, error).catch(() => undefined);
    console.error(`Remote Ollama job ${jobId} failed:`, error);
  } finally {
    clearInterval(heartbeatTimer);
  }
}

async function main(): Promise<void> {
  await verifyLocalOllama();
  let registration = await registerWithRetry();

  if (runSelfTest) {
    await queueSelfTest(registration.workerId, registration.token);
  }

  const activeJobs = new Set<Promise<void>>();
  let lastHeartbeat = Date.now();
  let idleSince: number | null = null;

  for (;;) {
    try {
      if (Date.now() - lastHeartbeat >= 20_000) {
        await heartbeat(registration.workerId, registration.token);
        lastHeartbeat = Date.now();
      }

      if (activeJobs.size >= maxConcurrentJobs) {
        idleSince = null;
        await Promise.race(activeJobs);
        continue;
      }

      let job: Record<string, any> | null;
      try {
        job = await claim(registration.workerId, registration.token);
      } catch (error) {
        idleSince = null;
        const code = (error as Error & { code?: string }).code;
        if (code === "CLAIM_TEMPORARILY_UNAVAILABLE") {
          console.error("Remote Ollama claim temporarily unavailable; keeping worker registration and retrying in 5s:", error);
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          continue;
        }
        throw error;
      }

      if (!job) {
        if (activeJobs.size === 0) {
          idleSince ??= Date.now();
          if (
            gcpAutoStopEnabled &&
            Date.now() - idleSince >= gcpIdleStopMs
          ) {
            const requested = await requestGcpSelfStop();
            idleSince = requested ? null : Date.now();
            if (requested) {
              await new Promise((resolve) => setTimeout(resolve, 30_000));
            }
          }
        } else {
          idleSince = null;
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        continue;
      }

      idleSince = null;
      let execution!: Promise<void>;
      execution = executeClaimedJob(registration, job).finally(() => {
        activeJobs.delete(execution);
      });
      activeJobs.add(execution);
    } catch (error) {
      idleSince = null;
      console.error("Remote Ollama worker loop error:", error);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      registration = await registerWithRetry();
      lastHeartbeat = Date.now();
    }
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
