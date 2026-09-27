const apiBase = (process.env["AICORE_REMOTE_URL"] ?? "https://aicore.cstlogistic.co.id").replace(/\/$/, "");
const enrollmentSecret = (process.env["OLLAMA_REMOTE_ENROLLMENT_SECRET"] ?? "").trim();
const ollamaBase = (process.env["OLLAMA_BASE_URL"] ?? "http://127.0.0.1:11434/v1").replace(/\/$/, "");
const modelId = (process.env["OLLAMA_WORKER_MODEL"] ?? "qwen2.5-coder:7b").trim();
const workerName = (process.env["OLLAMA_WORKER_NAME"] ?? "ollama-windows-worker").trim();
const nodeId = (process.env["OLLAMA_WORKER_NODE_ID"] ?? workerName).trim();
const pollMs = Math.max(500, Number(process.env["OLLAMA_REMOTE_POLL_MS"] ?? 1000));

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
    body: JSON.stringify({ workerName, nodeId, modelId, maxConcurrentJobs: 1, region: "windows-local" }),
  }));
  if (!Number.isInteger(data["workerId"]) || typeof data["heartbeatToken"] !== "string") {
    throw new Error("AI Core returned an invalid worker registration");
  }
  return { workerId: data["workerId"], token: data["heartbeatToken"] };
}

function workerHeaders(token: string): Record<string, string> {
  return { "content-type": "application/json", "x-ollama-worker-token": token };
}

async function heartbeat(workerId: number, token: string): Promise<void> {
  await json(await fetch(apiBase + `/api/ai/ollama-workers/${workerId}/heartbeat`, {
    method: "POST", headers: workerHeaders(token), body: "{}",
  }));
}

async function claim(workerId: number, token: string): Promise<Record<string, any> | null> {
  const response = await fetch(apiBase + `/api/ai/ollama-workers/${workerId}/claim`, {
    method: "POST", headers: workerHeaders(token), body: "{}",
  });
  if (response.status === 204) return null;
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

async function main(): Promise<void> {
  await verifyLocalOllama();
  let registration = await register();
  console.log(`Remote Ollama worker registered: ${registration.workerId} (${modelId})`);

  let lastHeartbeat = 0;
  for (;;) {
    try {
      if (Date.now() - lastHeartbeat >= 20_000) {
        await heartbeat(registration.workerId, registration.token);
        lastHeartbeat = Date.now();
      }
      const job = await claim(registration.workerId, registration.token);
      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        continue;
      }

      const jobId = Number(job["jobId"]);
      const heartbeatTimer = setInterval(() => {
        void heartbeat(registration.workerId, registration.token).catch(() => undefined);
      }, 20_000);
      heartbeatTimer.unref?.();
      try {
        const result = await invoke(job["payload"] ?? {});
        await complete(registration.workerId, registration.token, jobId, result);
        console.log(`Completed remote Ollama job ${jobId}`);
      } catch (error) {
        await retry(registration.workerId, registration.token, jobId, error).catch(() => undefined);
        console.error(`Remote Ollama job ${jobId} failed:`, error);
      } finally {
        clearInterval(heartbeatTimer);
      }
    } catch (error) {
      console.error("Remote Ollama worker loop error:", error);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      try {
        registration = await register();
        lastHeartbeat = Date.now();
      } catch {
        // Retry registration on the next loop.
      }
    }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
