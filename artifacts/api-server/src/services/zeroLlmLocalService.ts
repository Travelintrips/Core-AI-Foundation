const DEFAULT_BASE_URL = "http://127.0.0.1:8765/v1";
const DEFAULT_MODEL = "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B";

export interface ZeroLlmLocalConfig {
  enabled: boolean;
  required: boolean;
  baseUrl: string;
  model: string;
}

function envTrue(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export function isLoopbackZeroLlmBaseUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    return false;
  }
  return parsed.username === "" && parsed.password === "";
}

export function readZeroLlmLocalConfig(
  env: NodeJS.ProcessEnv = process.env,
): ZeroLlmLocalConfig {
  const explicitProvider =
    (env["AI_CODING_PROVIDER"] ?? "").trim().toLowerCase() === "zerollm";
  const enabled = envTrue(env["ZEROLLM_ENABLED"]) || explicitProvider;
  const required = envTrue(env["ZEROLLM_REQUIRED"]) || explicitProvider;
  const baseUrl = (env["ZEROLLM_BASE_URL"] || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = (env["ZEROLLM_MODEL"] || DEFAULT_MODEL).trim();

  if (!isLoopbackZeroLlmBaseUrl(baseUrl)) {
    throw new Error(
      "ZEROLLM_BASE_URL must be an unauthenticated loopback-only http URL.",
    );
  }
  if (!model || model.length > 300 || /[\r\n\0]/.test(model)) {
    throw new Error("ZEROLLM_MODEL is invalid.");
  }

  return { enabled, required, baseUrl, model };
}

export async function checkZeroLlmHealth(
  config = readZeroLlmLocalConfig(),
  timeoutMs = 1_500,
): Promise<{
  status: "ok" | "disabled" | "fail";
  latencyMs: number;
  model: string;
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
    const healthUrl = new URL(config.baseUrl);
    healthUrl.pathname = "/healthz";
    healthUrl.search = "";
    const response = await fetch(healthUrl, {
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
      | Record<string, unknown>
      | null;
    return {
      status: body?.status === "ok" ? "ok" : "fail",
      latencyMs: Date.now() - started,
      model: config.model,
      ...(body?.status === "ok" ? {} : { detail: "Invalid health payload" }),
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
