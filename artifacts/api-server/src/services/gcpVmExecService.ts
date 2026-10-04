export type GcpVmExecRequest = {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  requestedBy?: string;
};

export type GcpVmExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_COMMAND_LENGTH = 8_000;

function vmExecConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    endpoint: (env["GCP_VM_EXEC_ENDPOINT"] ?? "").trim().replace(/\/$/, ""),
    token: (env["GCP_VM_EXEC_TOKEN"] ?? "").trim(),
    instance: (env["GCP_OLLAMA_VM_INSTANCE"] ?? "").trim(),
  };
}

export function isGcpVmExecConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = vmExecConfig(env);
  return Boolean(value.endpoint && value.token && value.instance);
}

export async function executeGcpVmCommand(
  input: GcpVmExecRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GcpVmExecResult> {
  const cfg = vmExecConfig(env);
  if (!cfg.endpoint || !cfg.token || !cfg.instance) {
    throw new Error("GCP VM exec plane is not fully configured.");
  }

  const command = input.command.trim();
  if (!command || command.length > MAX_COMMAND_LENGTH) {
    throw new Error("GCP_VM_EXEC command is empty or too long.");
  }

  const timeoutMs = Math.min(
    Math.max(Number(input.timeoutMs ?? DEFAULT_TIMEOUT_MS), 1_000),
    MAX_TIMEOUT_MS,
  );

  const response = await fetch(cfg.endpoint + "/v1/exec", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + cfg.token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      instance: cfg.instance,
      command,
      cwd: input.cwd,
      timeoutMs,
    }),
    signal: AbortSignal.timeout(timeoutMs + 5_000),
  });

  const text = await response.text();
  let payload: Partial<GcpVmExecResult> & { error?: string };
  try {
    payload = text ? JSON.parse(text) as typeof payload : {};
  } catch {
    throw new Error("GCP VM exec agent returned invalid JSON.");
  }

  if (!response.ok) {
    throw new Error(payload.error || "GCP VM exec request failed.");
  }
  if (typeof payload.exitCode !== "number") {
    throw new Error("GCP VM exec response is missing exitCode.");
  }

  return {
    exitCode: payload.exitCode,
    stdout: String(payload.stdout ?? ""),
    stderr: String(payload.stderr ?? ""),
    durationMs: payload.durationMs,
  };
}
