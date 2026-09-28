
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
const DEFAULT_RECONNECT_MIN_MS = 2_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;
const MIN_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 300_000;
const DEFAULT_HEALTHCHECK_TIMEOUT_MS = 2_500;
const DEFAULT_MODEL = "qwen2.5-coder:7b";

export interface OllamaWorkerRuntimeConfig {
  enabled: boolean;
  workerName: string;
  nodeId: string;
  modelId: string;
  localBaseUrl: string;
  advertiseBaseUrl: string;
  apiKey: string;
  maxConcurrentJobs: number;
  powershellEnabled: boolean;
  heartbeatMs: number;
  reconnectMinMs: number;
  reconnectMaxMs: number;
  healthCheckTimeoutMs: number;
  clusterId: string;
  region: string;
  version: string;
}

interface RuntimeState {
  config: OllamaWorkerRuntimeConfig;
  workerId: number | null;
  heartbeatToken: string | null;
  startedAt: string;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
  consecutiveFailures: number;
  nextRetryAt: number;
  lastError: string | null;
}

let state: RuntimeState | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let heartbeatInFlight = false;

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

  const reconnectMinMs = boundedInt(
    env["OLLAMA_WORKER_RECONNECT_MIN_MS"],
    DEFAULT_RECONNECT_MIN_MS,
    MIN_RECONNECT_MS,
    MAX_RECONNECT_MS,
  );
  const reconnectMaxMs = Math.max(
    reconnectMinMs,
    boundedInt(
      env["OLLAMA_WORKER_RECONNECT_MAX_MS"],
      DEFAULT_RECONNECT_MAX_MS,
      MIN_RECONNECT_MS,
      MAX_RECONNECT_MS,
    ),
  );

  return {
    enabled: envTrue(env["OLLAMA_WORKER_RUNTIME_ENABLED"]),
    workerName,
    nodeId,
    modelId,
    localBaseUrl,
    advertiseBaseUrl,
    apiKey: (env["OLLAMA_WORKER_API_KEY"] ?? "").trim(),
    maxConcurrentJobs: boundedInt(
      env["OLLAMA_WORKER_MAX_CONCURRENCY"],
      2,
      1,
      32,
    ),
    powershellEnabled: envTrue(env["OLLAMA_WORKER_POWERSHELL_ENABLED"]),
    heartbeatMs: boundedInt(
      env["OLLAMA_WORKER_HEARTBEAT_MS"],
      DEFAULT_HEARTBEAT_MS,
      MIN_HEARTBEAT_MS,
      MAX_HEARTBEAT_MS,
    ),
    reconnectMinMs,
    reconnectMaxMs,
    healthCheckTimeoutMs: boundedInt(
      env["OLLAMA_WORKER_HEALTHCHECK_TIMEOUT_MS"],
      DEFAULT_HEALTHCHECK_TIMEOUT_MS,
      500,
      30_000,
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
      headers: {
        accept: "application/json",
        ...(config.apiKey ? { "x-api-key": config.apiKey } : {}),
      },
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

interface RuntimeRegistration {
  workerId: number;
  heartbeatToken: string;
}

export function calculateOllamaWorkerReconnectDelay(
  failures: number,
  minMs: number,
  maxMs: number,
): number {
  const exponent = Math.max(0, Math.min(12, failures - 1));
  return Math.min(maxMs, minMs * 2 ** exponent);
}

async function registerRuntime(
  config: OllamaWorkerRuntimeConfig,
): Promise<RuntimeRegistration> {
  await checkOllamaWorkerRuntimeHealth(
    config,
    config.healthCheckTimeoutMs,
  );

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
    powershellExecution: config.powershellEnabled,
  });

  if (!worker.heartbeatToken) {
    throw new Error(
      "Ollama worker registration did not return a heartbeat token.",
    );
  }

  return {
    workerId: worker.id,
    heartbeatToken: worker.heartbeatToken,
  };
}

function markConnected(registration: RuntimeRegistration): void {
  if (!state) return;
  const now = new Date().toISOString();
  state.workerId = registration.workerId;
  state.heartbeatToken = registration.heartbeatToken;
  state.connectedAt = now;
  state.lastHeartbeatAt = now;
  state.consecutiveFailures = 0;
  state.nextRetryAt = 0;
  state.lastError = null;
}

function markFailure(error: unknown): void {
  if (!state) return;
  state.consecutiveFailures += 1;
  state.workerId = null;
  state.heartbeatToken = null;
  state.lastError =
    error instanceof Error ? error.message : "Unknown Ollama worker runtime error.";
  const delay = calculateOllamaWorkerReconnectDelay(
    state.consecutiveFailures,
    state.config.reconnectMinMs,
    state.config.reconnectMaxMs,
  );
  state.nextRetryAt = Date.now() + delay;
}

async function heartbeatTick(): Promise<void> {
  if (!state || heartbeatInFlight || Date.now() < state.nextRetryAt) return;

  heartbeatInFlight = true;
  try {
    if (state.workerId != null && state.heartbeatToken) {
      const renewed = await heartbeatOllamaWorker(
        state.workerId,
        state.heartbeatToken,
        DEFAULT_LEASE_TTL_MS,
      );

      if (renewed) {
        state.lastHeartbeatAt = new Date().toISOString();
        state.consecutiveFailures = 0;
        state.nextRetryAt = 0;
        state.lastError = null;
        return;
      }

      logger.warn(
        { workerId: state.workerId },
        "[ollama-worker] Lease renewal failed; reconnecting runtime",
      );
    }

    const registration = await registerRuntime(state.config);
    markConnected(registration);

    logger.info(
      { workerId: registration.workerId },
      "[ollama-worker] Runtime connected",
    );
  } catch (error) {
    markFailure(error);
    logger.warn(
      {
        err: error,
        consecutiveFailures: state?.consecutiveFailures,
        nextRetryAt: state?.nextRetryAt
          ? new Date(state.nextRetryAt).toISOString()
          : null,
      },
      "[ollama-worker] Runtime disconnected; automatic reconnect scheduled",
    );
  } finally {
    heartbeatInFlight = false;
  }
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

  state = {
    config,
    workerId: null,
    heartbeatToken: null,
    startedAt: new Date().toISOString(),
    connectedAt: null,
    lastHeartbeatAt: null,
    consecutiveFailures: 0,
    nextRetryAt: 0,
    lastError: null,
  };

  await heartbeatTick();

  heartbeatTimer = setInterval(() => {
    void heartbeatTick();
  }, config.heartbeatMs);

  heartbeatTimer.unref?.();

  logger.info(
    {
      workerId: state.workerId,
      connected: state.workerId != null,
      workerName: config.workerName,
      modelId: config.modelId,
      advertiseBaseUrl: config.advertiseBaseUrl,
      maxConcurrentJobs: config.maxConcurrentJobs,
      powershellEnabled: config.powershellEnabled,
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
    connected: state.workerId != null,
    workerName: state.config.workerName,
    nodeId: state.config.nodeId,
    modelId: state.config.modelId,
    localBaseUrl: state.config.localBaseUrl,
    advertiseBaseUrl: state.config.advertiseBaseUrl,
    apiKeyConfigured: Boolean(state.config.apiKey),
    maxConcurrentJobs: state.config.maxConcurrentJobs,
    powershellEnabled: state.config.powershellEnabled,
    heartbeatMs: state.config.heartbeatMs,
    reconnectMinMs: state.config.reconnectMinMs,
    reconnectMaxMs: state.config.reconnectMaxMs,
    healthCheckTimeoutMs: state.config.healthCheckTimeoutMs,
    consecutiveFailures: state.consecutiveFailures,
    connectedAt: state.connectedAt,
    lastHeartbeatAt: state.lastHeartbeatAt,
    nextRetryAt:
      state.nextRetryAt > 0
        ? new Date(state.nextRetryAt).toISOString()
        : null,
    lastError: state.lastError,
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

  if (current.workerId != null && current.heartbeatToken) {
    await shutdownOllamaWorker(
      current.workerId,
      current.heartbeatToken,
    ).catch(() => undefined);
  }

  logger.info(
    { workerId: current.workerId },
    "[ollama-worker] Runtime stopped",
  );
}
