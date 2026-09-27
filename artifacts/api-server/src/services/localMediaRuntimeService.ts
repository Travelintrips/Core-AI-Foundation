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


export interface LocalImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  checkpoint?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  filenamePrefix?: string;
}

export interface LocalImageGenerationQueuedResult {
  promptId: string;
  number?: number;
  nodeErrors?: unknown;
}

export interface LocalImageOutputDescriptor {
  filename: string;
  subfolder: string;
  type: string;
  viewUrl: string;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value as number)));
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value as number));
}

function cleanPrompt(value: string, field: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${field} must not be empty.`);
  if (text.length > 4000) throw new Error(`${field} is too long.`);
  return text;
}

function cleanCheckpoint(value: string | undefined): string {
  const checkpoint = (value || "v1-5-pruned-emaonly.safetensors").trim();
  if (!/^[a-zA-Z0-9._ -]{1,180}$/.test(checkpoint) || checkpoint.includes("..")) {
    throw new Error("Invalid checkpoint name.");
  }
  return checkpoint;
}

export function buildSd15ImageWorkflow(
  request: LocalImageGenerationRequest,
): Record<string, unknown> {
  const prompt = cleanPrompt(request.prompt, "prompt");
  const negativePrompt = request.negativePrompt?.trim() ||
    "blurry, low quality, distorted, deformed, artifacts";
  const checkpoint = cleanCheckpoint(request.checkpoint);
  const width = clampInteger(request.width, 512, 256, 768);
  const height = clampInteger(request.height, 512, 256, 768);
  const steps = clampInteger(request.steps, 12, 4, 30);
  const cfg = clampNumber(request.cfg, 6.5, 1, 15);
  const seed = clampInteger(request.seed, Math.floor(Math.random() * 2_147_483_647), 0, 2_147_483_647);
  const filenamePrefix = (request.filenamePrefix || "core-ai-local")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 80) || "core-ai-local";

  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: checkpoint },
    },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["1", 1] },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { text: negativePrompt, clip: ["1", 1] },
    },
    "4": {
      class_type: "EmptyLatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1.0,
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
      },
    },
    "6": {
      class_type: "VAEDecode",
      inputs: { samples: ["5", 0], vae: ["1", 2] },
    },
    "7": {
      class_type: "SaveImage",
      inputs: { filename_prefix: filenamePrefix, images: ["6", 0] },
    },
  };
}

export async function queueLocalImageGeneration(
  request: LocalImageGenerationRequest,
): Promise<LocalImageGenerationQueuedResult> {
  const workflow = buildSd15ImageWorkflow(request);
  const queued = await submitComfyWorkflow(workflow, "core-ai-local-image");
  const promptId = typeof queued["prompt_id"] === "string" ? queued["prompt_id"] : "";

  if (!promptId) {
    throw new Error("ComfyUI did not return a prompt_id.");
  }

  return {
    promptId,
    number: typeof queued["number"] === "number" ? queued["number"] : undefined,
    nodeErrors: queued["node_errors"],
  };
}

export function extractLocalImageOutputs(
  promptId: string,
  history: Record<string, unknown>,
): LocalImageOutputDescriptor[] {
  const entry = history[promptId];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];

  const outputs = (entry as Record<string, unknown>)["outputs"];
  if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) return [];

  const config = readLocalMediaRuntimeConfig();
  const found: LocalImageOutputDescriptor[] = [];

  for (const value of Object.values(outputs as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const images = (value as Record<string, unknown>)["images"];
    if (!Array.isArray(images)) continue;

    for (const image of images) {
      if (!image || typeof image !== "object" || Array.isArray(image)) continue;
      const item = image as Record<string, unknown>;
      const filename = typeof item["filename"] === "string" ? item["filename"] : "";
      const subfolder = typeof item["subfolder"] === "string" ? item["subfolder"] : "";
      const type = typeof item["type"] === "string" ? item["type"] : "output";
      if (!filename) continue;

      const params = new URLSearchParams({ filename, subfolder, type });
      found.push({
        filename,
        subfolder,
        type,
        viewUrl: `${config.comfyUiBaseUrl}/view?${params.toString()}`,
      });
    }
  }

  return found;
}

export async function waitForLocalImageGeneration(
  promptId: string,
  options?: { timeoutMs?: number; pollMs?: number },
): Promise<{
  promptId: string;
  status: "completed" | "timeout";
  outputs: LocalImageOutputDescriptor[];
}> {
  const timeoutMs = clampInteger(options?.timeoutMs, 180_000, 5_000, 600_000);
  const pollMs = clampInteger(options?.pollMs, 1_500, 250, 10_000);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const history = await getComfyWorkflowHistory(promptId);
    const outputs = extractLocalImageOutputs(promptId, history);
    if (outputs.length > 0) {
      return { promptId, status: "completed", outputs };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return { promptId, status: "timeout", outputs: [] };
}
