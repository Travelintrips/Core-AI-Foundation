const DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_MODEL = "qwen2.5-coder:7b";

export interface OllamaLocalConfig {
  enabled: boolean;
  required: boolean;
  baseUrl: string;
  model: string;
}

function envTrue(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export function isLoopbackOllamaBaseUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) return false;
  return parsed.username === "" && parsed.password === "";
}

export function readOllamaLocalConfig(
  env: NodeJS.ProcessEnv = process.env,
): OllamaLocalConfig {
  const explicitProvider =
    (env["AI_CODING_PROVIDER"] ?? "").trim().toLowerCase() === "ollama";
  const fallbackProvider =
    (env["AI_CODING_FALLBACK_PROVIDER"] ?? "").trim().toLowerCase() === "ollama";
  const enabled = envTrue(env["OLLAMA_ENABLED"]) || explicitProvider || fallbackProvider;
  const required = envTrue(env["OLLAMA_REQUIRED"]) || explicitProvider;
  const baseUrl = (env["OLLAMA_BASE_URL"] || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = (
    env["OLLAMA_MODEL"] ||
    env["AI_CODING_FALLBACK_MODEL"] ||
    DEFAULT_MODEL
  ).trim();

  if (!isLoopbackOllamaBaseUrl(baseUrl)) {
    throw new Error("OLLAMA_BASE_URL must be an unauthenticated loopback-only http URL.");
  }
  if (!model || model.length > 300 || /[\r\n\0]/.test(model)) {
    throw new Error("OLLAMA_MODEL is invalid.");
  }

  return { enabled, required, baseUrl, model };
}

export async function checkOllamaHealth(
  config = readOllamaLocalConfig(),
  timeoutMs = 1_500,
): Promise<{
  status: "ok" | "disabled" | "fail";
  latencyMs: number;
  model: string;
  modelAvailable?: boolean;
  detail?: string;
}> {
  if (!config.enabled) {
    return { status: "disabled", latencyMs: 0, model: config.model };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    const response = await fetch(config.baseUrl + "/models", {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return {
        status: "fail",
        latencyMs: Date.now() - started,
        model: config.model,
        detail: "HTTP " + response.status,
      };
    }

    const body = (await response.json().catch(() => null)) as
      | { data?: Array<{ id?: unknown }> }
      | null;
    const ids = Array.isArray(body?.data)
      ? body!.data!
          .map((item) => (typeof item?.id === "string" ? item.id : ""))
          .filter(Boolean)
      : [];
    const modelAvailable = ids.includes(config.model);

    return {
      status: modelAvailable ? "ok" : "fail",
      latencyMs: Date.now() - started,
      model: config.model,
      modelAvailable,
      ...(modelAvailable ? {} : { detail: "Configured Ollama model is not pulled." }),
    };
  } catch (error) {
    return {
      status: "fail",
      latencyMs: Date.now() - started,
      model: config.model,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
