
import { hostname } from "node:os";
import { DEFAULT_LEASE_TTL_MS } from "./workerClusterService.js";
import {
  heartbeatOllamaWorker,
  normalizeOllamaWorkerEndpoint,
  registerOllamaWorker,
  shutdownOllamaWorker,
} from "./ollamaWorkerRegistryService.js";
import { logger } from "../lib/logger.js";

const DEFAULT_HEARTBEAT_MS = 10_000;
const MIN_HEARTBEAT_MS = 2_000;
const MAX_HEARTBEAT_MS = 60_000;
const DEFAULT_MODEL = "qwen2.5-coder:7b";

export interface OllamaWorkerRuntimeConfig {
  enabled: boolean;
  workerName: string;
  nodeId: string;
  modelId: string;
  localBaseUrl: string;
  advertiseBaseUrl: string;
  maxConcurrentJobs: number;
  heartbeatMs: number;
  clusterId: string;
  region: string;
  version: string;
}

interface RuntimeState {
  config: OllamaWorkerRuntimeConfig;
  workerId: number;
  heartbeatToken: string;
  startedAt: string;
}

let state: RuntimeState | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

function envTrue(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function boundedInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeNodeToken(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "local";
}

export function readOllamaWorkerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): OllamaWorkerRuntimeConfig {
  const nodeId = safeNodeToken(env["OLLAMA_WORKER_NODE_ID"] || hostname());
  const workerName = (
    env["OLLAMA_WORKER_NAME"] || "ollama-" + nodeId
  ).trim();
  const modelId = (
    env["OLLAMA_WORKER_MODEL"] ||
    env["OLLAMA_MODEL"] ||
    DEFAULT_MODEL
  ).trim();

  const localBaseUrl = normalizeOllamaWorkerEndpoint(
    env["OLLAMA_WORKER_LOCAL_URL"] ||
      env["OLLAMA_BASE_URL"] ||
      "http://127.0.0.1:11434/v1",
    {
      ...env,
      OLLAMA_WORKER_ALLOWED_HOSTS: [
        env["OLLAMA_WORKER_ALLOWED_HOSTS"],
        "localhost",
      ]
        .filter(Boolean)
        .join(","),
    },
  );

  const advertiseBaseUrl = normalizeOllamaWorkerEndpoint(
    env["OLLAMA_WORKER_ADVERTISE_URL"] || localBaseUrl,
    env,
  );

  if (!workerName || workerName.length > 160 || /[\r\n\0]/.test(workerName)) {
    throw new Error("OLLAMA_WORKER_NAME is invalid.");
  }

  if (!modelId || modelId.length > 300 || /[\r\n\0]/.test(modelId)) {
    throw new Error("OLLAMA_WORKER_MODEL is invalid.");
  }

  return {
    enabled: envTrue(env["OLLAMA_WORKER_RUNTIME_ENABLED"]),
    workerName,
    nodeId,
    modelId,
    localBaseUrl,
    advertiseBaseUrl,
    maxConcurrentJobs: boundedInt(
      env["OLLAMA_WORKER_MAX_CONCURRENCY"],
      2,
      1,
      32,
    ),
    heartbeatMs: boundedInt(
      env["OLLAMA_WORKER_HEARTBEAT_MS"],
      DEFAULT_HEARTBEAT_MS,
      MIN_HEARTBEAT_MS,
      MAX_HEARTBEAT_MS,
    ),
    clusterId: (env["OLLAMA_WORKER_CLUSTER_ID"] || "ollama").trim(),
    region: (env["OLLAMA_WORKER_REGION"] || "local").trim(),
    version: (env["OLLAMA_WORKER_VERSION"] || "1.0.0").trim(),
  };
}

export async function checkOllamaWorkerRuntimeHealth(
  config: OllamaWorkerRuntimeConfig,
  timeoutMs = 2_500,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    const response = await fetch(config.localBaseUrl + "/models", {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        "Ollama worker health check failed with HTTP " + response.status + ".",
      );
    }

    const body = (await response.json()) as {
      data?: Array<{ id?: unknown }>;
    };

    const available = Array.isArray(body.data)
      ? body.data.some((item) => item && item.id === config.modelId)
      : false;

    if (!available) {
      throw new Error(
        "Ollama model '" + config.modelId + "' is not available on this worker.",
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

async function registerRuntime(
  config: OllamaWorkerRuntimeConfig,
): Promise<RuntimeState> {
  await checkOllamaWorkerRuntimeHealth(config);

  const worker = await registerOllamaWorker({
    workerName: config.workerName,
    nodeId: config.nodeId,
    endpointUrl: config.advertiseBaseUrl,
    modelId: config.modelId,
    clusterId: config.clusterId,
    region: config.region,
    version: config.version,
    maxConcurrentJobs: config.maxConcurrentJobs,
    leaseOwner: "ollama-runtime:" + config.nodeId,
    leaseTtlMs: DEFAULT_LEASE_TTL_MS,
  });

  if (!worker.heartbeatToken) {
    throw new Error(
      "Ollama worker registration did not return a heartbeat token.",
    );
  }

  return {
    config,
    workerId: worker.id,
    heartbeatToken: worker.heartbeatToken,
    startedAt: new Date().toISOString(),
  };
}

async function heartbeatTick(): Promise<void> {
  if (!state) return;

  const renewed = await heartbeatOllamaWorker(
    state.workerId,
    state.heartbeatToken,
    DEFAULT_LEASE_TTL_MS,
  );

  if (renewed) return;

  logger.warn(
    { workerId: state.workerId },
    "[ollama-worker] Lease renewal failed; re-registering runtime",
  );

  state = await registerRuntime(state.config);
}

export async function startOllamaWorkerRuntime(
  config = readOllamaWorkerRuntimeConfig(),
): Promise<Record<string, unknown>> {
  if (!config.enabled) {
    return { enabled: false, running: false };
  }

  if (state) {
    return getOllamaWorkerRuntimeStatus();
  }

  state = await registerRuntime(config);

  heartbeatTimer = setInterval(() => {
    void heartbeatTick().catch((error) => {
      logger.error(
        { err: error },
        "[ollama-worker] Heartbeat failed",
      );
    });
  }, config.heartbeatMs);

  heartbeatTimer.unref?.();

  logger.info(
    {
      workerId: state.workerId,
      workerName: config.workerName,
      modelId: config.modelId,
      advertiseBaseUrl: config.advertiseBaseUrl,
      maxConcurrentJobs: config.maxConcurrentJobs,
    },
    "[ollama-worker] Runtime started",
  );

  return getOllamaWorkerRuntimeStatus();
}

export function getOllamaWorkerRuntimeStatus(): Record<string, unknown> {
  if (!state) {
    return { enabled: false, running: false };
  }

  return {
    enabled: true,
    running: true,
    workerId: state.workerId,
    workerName: state.config.workerName,
    nodeId: state.config.nodeId,
    modelId: state.config.modelId,
    localBaseUrl: state.config.localBaseUrl,
    advertiseBaseUrl: state.config.advertiseBaseUrl,
    maxConcurrentJobs: state.config.maxConcurrentJobs,
    heartbeatMs: state.config.heartbeatMs,
    startedAt: state.startedAt,
  };
}

export async function shutdownOllamaWorkerRuntime(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  const current = state;
  state = null;
  if (!current) return;

  await shutdownOllamaWorker(
    current.workerId,
    current.heartbeatToken,
  ).catch(() => undefined);

  logger.info(
    { workerId: current.workerId },
    "[ollama-worker] Runtime stopped",
  );
}
