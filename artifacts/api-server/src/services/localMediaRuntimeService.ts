import { spawn } from "node:child_process";

export interface LocalMediaRuntimeConfig {
  enabled: boolean;
  comfyUiBaseUrl: string;
  ffmpegPath: string;
}

function envTrue(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function normalizeLoopbackUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("COMFYUI_BASE_URL must be a valid URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("COMFYUI_BASE_URL must use http or https.");
  }

  const host = parsed.hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("COMFYUI_BASE_URL must be loopback-only.");
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function readLocalMediaRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): LocalMediaRuntimeConfig {
  return {
    enabled: envTrue(env["LOCAL_MEDIA_RUNTIME_ENABLED"]),
    comfyUiBaseUrl: normalizeLoopbackUrl(
      env["COMFYUI_BASE_URL"] || "http://127.0.0.1:8188",
    ),
    ffmpegPath: (env["FFMPEG_PATH"] || "ffmpeg").trim(),
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 3_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkFfmpeg(path: string): Promise<{
  status: "ok" | "fail";
  detail: string;
}> {
  return await new Promise((resolve) => {
    const child = spawn(path, ["-version"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let firstLine = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (!firstLine) firstLine = chunk.toString("utf8").split(/\r?\n/, 1)[0] ?? "";
    });

    child.once("error", (error) => {
      resolve({ status: "fail", detail: error.message });
    });

    child.once("close", (code) => {
      resolve({
        status: code === 0 ? "ok" : "fail",
        detail: firstLine || `ffmpeg exited with code ${code ?? "unknown"}`,
      });
    });
  });
}

export async function getLocalMediaRuntimeStatus(): Promise<Record<string, unknown>> {
  const config = readLocalMediaRuntimeConfig();

  if (!config.enabled) {
    return {
      enabled: false,
      comfyui: { status: "disabled", baseUrl: config.comfyUiBaseUrl },
      ffmpeg: { status: "disabled", path: config.ffmpegPath },
    };
  }

  let comfyui: Record<string, unknown>;
  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(config.comfyUiBaseUrl + "/system_stats");
    if (!response.ok) {
      comfyui = {
        status: "fail",
        baseUrl: config.comfyUiBaseUrl,
        httpStatus: response.status,
        latencyMs: Date.now() - startedAt,
      };
    } else {
      const body = await response.json().catch(() => ({}));
      comfyui = {
        status: "ok",
        baseUrl: config.comfyUiBaseUrl,
        latencyMs: Date.now() - startedAt,
        system: body,
      };
    }
  } catch (error) {
    comfyui = {
      status: "fail",
      baseUrl: config.comfyUiBaseUrl,
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const ffmpeg = await checkFfmpeg(config.ffmpegPath);

  return {
    enabled: true,
    comfyui,
    ffmpeg: { ...ffmpeg, path: config.ffmpegPath },
  };
}

export async function submitComfyWorkflow(
  workflow: Record<string, unknown>,
  clientId?: string,
): Promise<Record<string, unknown>> {
  const config = readLocalMediaRuntimeConfig();
  if (!config.enabled) {
    throw new Error("Local media runtime is disabled.");
  }

  const response = await fetchWithTimeout(
    config.comfyUiBaseUrl + "/prompt",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: workflow,
        ...(clientId ? { client_id: clientId } : {}),
      }),
    },
    15_000,
  );

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `ComfyUI workflow submission failed with HTTP ${response.status}: ${JSON.stringify(body)}`,
    );
  }

  return body as Record<string, unknown>;
}

export async function getComfyWorkflowHistory(
  promptId: string,
): Promise<Record<string, unknown>> {
  const config = readLocalMediaRuntimeConfig();
  if (!config.enabled) {
    throw new Error("Local media runtime is disabled.");
  }

  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(promptId)) {
    throw new Error("Invalid ComfyUI prompt id.");
  }

  const response = await fetchWithTimeout(
    config.comfyUiBaseUrl + "/history/" + encodeURIComponent(promptId),
    {},
    10_000,
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `ComfyUI history lookup failed with HTTP ${response.status}.`,
    );
  }
  return body as Record<string, unknown>;
}
