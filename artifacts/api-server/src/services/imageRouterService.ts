import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger.js";
import {
  isSupabaseStorageAvailable,
  uploadToSupabase,
} from "../lib/supabaseStorage.js";
import { ensureGcpOllamaVmStarted } from "./gcpOllamaVmLifecycleService.js";

export interface ImageRouterConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  startupTimeoutMs: number;
}

export interface ImageRouterGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  filenamePrefix?: string;
  timeoutMs?: number;
  timeoutSeconds?: number;
}

export interface ImageRouterGenerationResult {
  imageUrl: string;
  provider: "gcp-comfyui";
  model: string;
  promptId: string;
  latencyMs: number;
  width: number;
  height: number;
  storagePath: string;
}

function envTrue(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value as number)));
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("AI image router URL must use HTTP or HTTPS.");
  }
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase());
  if (!loopback && parsed.protocol !== "https:") {
    throw new Error("Remote AI image router must use HTTPS.");
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export function readImageRouterConfig(env: NodeJS.ProcessEnv = process.env): ImageRouterConfig {
  const production = env["NODE_ENV"] === "production";
  const explicitEnabled = env["AI_IMAGE_ROUTER_ENABLED"] ?? env["AI_IMAGE_LOCAL_PRIMARY"];
  return {
    enabled: explicitEnabled == null ? production : envTrue(explicitEnabled),
    baseUrl: normalizeBaseUrl(
      env["AI_IMAGE_ROUTER_BASE_URL"] ||
        (production
          ? "https://ollama.cstlogistic.co.id/image-router"
          : "http://127.0.0.1:9191"),
    ),
    apiKey: (
      env["AI_IMAGE_ROUTER_TOKEN"] ||
      env["OLLAMA_WORKER_API_KEY"] ||
      ""
    ).trim(),
    startupTimeoutMs: clampInt(
      Number(env["AI_IMAGE_ROUTER_STARTUP_TIMEOUT_MS"]),
      180_000,
      30_000,
      300_000,
    ),
  };
}

function isLoopback(baseUrl: string): boolean {
  const host = new URL(baseUrl).hostname.toLowerCase();
  return ["127.0.0.1", "localhost", "::1"].includes(host);
}

function headers(config: ImageRouterConfig): Record<string, string> {
  return {
    accept: "application/json",
    ...(config.apiKey ? { "x-api-key": config.apiKey } : {}),
  };
}

async function routerFetch(
  config: ImageRouterConfig,
  path: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const merged = new Headers(init.headers);
  for (const [key, value] of Object.entries(headers(config))) {
    if (!merged.has(key)) merged.set(key, value);
  }
  return fetch(config.baseUrl + path, {
    ...init,
    headers: merged,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function waitForRouterReady(config: ImageRouterConfig): Promise<void> {
  if (!config.enabled) throw new Error("AI image router is disabled.");
  if (!isLoopback(config.baseUrl) && !config.apiKey) {
    throw new Error("AI image router API key is not configured.");
  }

  if (!isLoopback(config.baseUrl)) {
    await ensureGcpOllamaVmStarted().catch((error) => {
      logger.warn({ err: error }, "[image-router] GCP VM start request failed; probing existing VM state");
      return false;
    });
  }

  const deadline = Date.now() + config.startupTimeoutMs;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    try {
      const response = await routerFetch(config, "/health", {}, 5_000);
      if (response.ok) return;
      lastError = "HTTP " + response.status;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(
    `AI image router did not become ready within ${config.startupTimeoutMs}ms: ${lastError}`,
  );
}

function dimensionsForAspectRatio(
  aspectRatio: string | undefined,
  width: number | undefined,
  height: number | undefined,
): { width: number; height: number } {
  if (Number.isFinite(width) || Number.isFinite(height)) {
    return {
      width: clampInt(width, 1024, 512, 1024),
      height: clampInt(height, 1024, 512, 1024),
    };
  }
  const presets: Record<string, [number, number]> = {
    "1:1": [1024, 1024],
    "16:9": [1024, 576],
    "9:16": [576, 1024],
    "4:3": [1024, 768],
    "3:4": [768, 1024],
    "3:2": [1024, 704],
    "2:3": [704, 1024],
  };
  const selected = presets[(aspectRatio || "1:1").trim()] ?? presets["1:1"]!;
  return { width: selected[0], height: selected[1] };
}

function contentExtension(contentType: string): string {
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  throw new Error("Image router returned unsupported MIME type: " + mime);
}

export function isImageRouterConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const config = readImageRouterConfig(env);
    return config.enabled && (isLoopback(config.baseUrl) || Boolean(config.apiKey));
  } catch {
    return false;
  }
}

export async function generateImageViaRouter(
  input: ImageRouterGenerationRequest,
): Promise<ImageRouterGenerationResult> {
  const startedAt = Date.now();
  const config = readImageRouterConfig();
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Image prompt is required.");
  if (prompt.length > 4000) throw new Error("Image prompt is too long.");

  await waitForRouterReady(config);

  const { width, height } = dimensionsForAspectRatio(
    input.aspectRatio,
    input.width,
    input.height,
  );
  const requestedTimeoutMs = Number.isFinite(input.timeoutMs)
    ? input.timeoutMs
    : Number.isFinite(input.timeoutSeconds)
      ? (input.timeoutSeconds as number) * 1000
      : undefined;
  const timeoutMs = clampInt(requestedTimeoutMs, 420_000, 60_000, 600_000);

  const response = await routerFetch(
    config,
    "/generate",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        negativePrompt: input.negativePrompt,
        width,
        height,
        steps: clampInt(input.steps, 20, 4, 30),
        cfg: Number.isFinite(input.cfg) ? input.cfg : 7,
        seed: Number.isFinite(input.seed) ? input.seed : undefined,
        filenamePrefix: input.filenamePrefix || "ai-core",
        timeoutSeconds: Math.ceil(timeoutMs / 1000),
      }),
    },
    timeoutMs + 30_000,
  );

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || body["ok"] !== true) {
    throw new Error(
      `AI image gateway failed HTTP ${response.status}: ${String(body["error"] ?? "unknown error")}`,
    );
  }

  const imageBase64 =
    typeof body["imageBase64"] === "string" ? body["imageBase64"] : "";
  const contentType =
    typeof body["contentType"] === "string" ? body["contentType"] : "image/png";
  const model =
    typeof body["model"] === "string" ? body["model"] : "sd_xl_base_1.0.safetensors";
  const promptId =
    typeof body["promptId"] === "string" ? body["promptId"] : "";
  if (!imageBase64 || !promptId) {
    throw new Error("AI image gateway returned an incomplete render payload.");
  }

  const buffer = Buffer.from(imageBase64, "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > 50 * 1024 * 1024) {
    throw new Error("AI image gateway returned an invalid image size.");
  }
  if (!isSupabaseStorageAvailable()) {
    throw new Error("Supabase Storage is unavailable for image output.");
  }

  const ext = contentExtension(contentType);
  const now = new Date();
  const storagePath =
    `generated-images/${now.getUTCFullYear()}/` +
    `${String(now.getUTCMonth() + 1).padStart(2, "0")}/` +
    `${randomUUID()}.${ext}`;
  const imageUrl = await uploadToSupabase(storagePath, buffer, contentType);

  return {
    imageUrl,
    provider: "gcp-comfyui",
    model,
    promptId,
    latencyMs:
      typeof body["latencyMs"] === "number"
        ? body["latencyMs"]
        : Date.now() - startedAt,
    width,
    height,
    storagePath,
  };
}

export async function generateAndPersistImageViaRouter(
  input: ImageRouterGenerationRequest,
): Promise<ImageRouterGenerationResult> {
  return generateImageViaRouter(input);
}

export async function getImageRouterStatus(): Promise<Record<string, unknown>> {
  const config = readImageRouterConfig();
  const base = {
    enabled: config.enabled,
    configured: isImageRouterConfigured(),
    baseUrl: config.baseUrl,
    apiKeyConfigured: Boolean(config.apiKey),
  };

  if (!config.enabled) {
    return { ...base, status: "disabled" };
  }

  try {
    const response = await routerFetch(config, "/health", {}, 5_000);
    const health = await response.json().catch(() => ({}));
    return {
      ...base,
      status: response.ok ? "ok" : "offline",
      httpStatus: response.status,
      health,
    };
  } catch (error) {
    return {
      ...base,
      status: "offline",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function tryGenerateImageViaRouter(
  input: ImageRouterGenerationRequest,
): Promise<ImageRouterGenerationResult | null> {
  if (!isImageRouterConfigured()) return null;
  try {
    return await generateImageViaRouter(input);
  } catch (error) {
    logger.warn(
      { err: error },
      "[image-router] GCP render failed; falling back to external image provider",
    );
    return null;
  }
}
