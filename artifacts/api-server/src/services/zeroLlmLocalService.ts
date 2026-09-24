import { readFile, statfs } from "node:fs/promises";
import { join } from "node:path";
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


export interface ZeroLlmInstallStatus {
  state: string;
  installed: boolean;
  pythonAvailable: boolean;
  importOk: boolean;
  pythonVersion?: string;
  requirementsHashShort?: string;
  modelPreloaded?: boolean | null;
  model?: string;
  updatedAt?: string;
}

function zeroLlmRuntimeHome(env: NodeJS.ProcessEnv = process.env): string {
  return env["ZEROLLM_HOME"] || join(process.cwd(), ".runtime", "zerollm");
}

export async function readZeroLlmInstallStatus(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ZeroLlmInstallStatus | null> {
  const statusFile = join(zeroLlmRuntimeHome(env), "status.json");
  try {
    const parsed = JSON.parse(await readFile(statusFile, "utf8")) as Record<string, unknown>;
    return {
      state: typeof parsed.state === "string" ? parsed.state : "UNKNOWN",
      installed: parsed.installed === true,
      pythonAvailable: parsed.pythonAvailable === true,
      importOk: parsed.importOk === true,
      ...(typeof parsed.pythonVersion === "string"
        ? { pythonVersion: parsed.pythonVersion.slice(0, 80) }
        : {}),
      ...(typeof parsed.requirementsHashShort === "string"
        ? { requirementsHashShort: parsed.requirementsHashShort.slice(0, 16) }
        : {}),
      ...(typeof parsed.modelPreloaded === "boolean" || parsed.modelPreloaded === null
        ? { modelPreloaded: parsed.modelPreloaded as boolean | null }
        : {}),
      ...(typeof parsed.model === "string" ? { model: parsed.model.slice(0, 300) } : {}),
      ...(typeof parsed.updatedAt === "string"
        ? { updatedAt: parsed.updatedAt.slice(0, 64) }
        : {}),
    };
  } catch {
    return null;
  }
}

async function readCgroupNumber(path: string): Promise<number | null> {
  try {
    const raw = (await readFile(path, "utf8")).trim();
    if (!raw || raw === "max") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function getZeroLlmHostCapacity(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  memoryLimitMb: number | null;
  memoryCurrentMb: number | null;
  memoryAvailableMb: number | null;
  diskAvailableMb: number | null;
  capacity: "READY" | "INSUFFICIENT" | "UNKNOWN";
  recommendedMemoryAvailableMb: number;
  recommendedDiskAvailableMb: number;
}> {
  const limitBytes =
    (await readCgroupNumber("/sys/fs/cgroup/memory.max")) ??
    (await readCgroupNumber("/sys/fs/cgroup/memory/memory.limit_in_bytes"));
  const currentBytes =
    (await readCgroupNumber("/sys/fs/cgroup/memory.current")) ??
    (await readCgroupNumber("/sys/fs/cgroup/memory/memory.usage_in_bytes"));

  let diskAvailableMb: number | null = null;
  try {
    const stats = await statfs(zeroLlmRuntimeHome(env)).catch(() => statfs(process.cwd()));
    diskAvailableMb = Math.floor((Number(stats.bavail) * Number(stats.bsize)) / 1024 / 1024);
  } catch {
    diskAvailableMb = null;
  }

  const memoryLimitMb = limitBytes ? Math.floor(limitBytes / 1024 / 1024) : null;
  const memoryCurrentMb = currentBytes ? Math.floor(currentBytes / 1024 / 1024) : null;
  const memoryAvailableMb =
    memoryLimitMb != null && memoryCurrentMb != null
      ? Math.max(0, memoryLimitMb - memoryCurrentMb)
      : null;

  const recommendedMemoryAvailableMb = 4096;
  const recommendedDiskAvailableMb = 8192;
  const capacity =
    memoryAvailableMb == null || diskAvailableMb == null
      ? "UNKNOWN"
      : memoryAvailableMb >= recommendedMemoryAvailableMb &&
          diskAvailableMb >= recommendedDiskAvailableMb
        ? "READY"
        : "INSUFFICIENT";

  return {
    memoryLimitMb,
    memoryCurrentMb,
    memoryAvailableMb,
    diskAvailableMb,
    capacity,
    recommendedMemoryAvailableMb,
    recommendedDiskAvailableMb,
  };
}

export async function getZeroLlmReadinessSnapshot(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
  const config = readZeroLlmLocalConfig(env);
  const [install, capacity, health] = await Promise.all([
    readZeroLlmInstallStatus(env),
    getZeroLlmHostCapacity(env),
    config.enabled ? checkZeroLlmHealth(config) : Promise.resolve(null),
  ]);

  return {
    provider: "zerollm",
    enabled: config.enabled,
    required: config.required,
    model: config.model,
    loopbackOnly: true,
    install: install ?? {
      state: "STATUS_MISSING",
      installed: false,
      pythonAvailable: false,
      importOk: false,
    },
    capacity,
    health,
    safeToEnable:
      Boolean(install?.installed && install.importOk) &&
      capacity.capacity === "READY",
  };
}
