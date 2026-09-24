const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const nodeEntry = path.join(root, "artifacts", "api-server", "dist", "index.mjs");
const enabled = String(process.env.ZEROLLM_ENABLED || "").toLowerCase() === "true";
const explicitLocalProvider =
  String(process.env.AI_CODING_PROVIDER || "").toLowerCase() === "zerollm";
const required =
  String(process.env.ZEROLLM_REQUIRED || "").toLowerCase() === "true" ||
  explicitLocalProvider;

const runtimeHome =
  process.env.ZEROLLM_HOME ||
  path.join(os.homedir(), ".cache", "core-ai", "zerollm");
const venvPython = path.join(
  runtimeHome,
  "venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const sidecarScript = path.join(root, "services", "zerollm", "server.py");
const port = String(process.env.ZEROLLM_PORT || "8765");
const baseUrl = "http://127.0.0.1:" + port + "/v1";

function runBootstrap() {
  const result = spawnSync(process.execPath, [
    path.join(root, "scripts", "zerollm-bootstrap.cjs"),
  ], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error("ZeroLLM bootstrap failed with exit " + result.status);
  }
}

let sidecar = null;
let api = null;
let stopping = false;

function terminate(code = 0) {
  if (stopping) return;
  stopping = true;
  if (api && !api.killed) api.kill("SIGTERM");
  if (sidecar && !sidecar.killed) sidecar.kill("SIGTERM");
  setTimeout(() => process.exit(code), 250).unref();
}

process.on("SIGTERM", () => terminate(0));
process.on("SIGINT", () => terminate(0));

try {
  if (enabled || explicitLocalProvider) {
    runBootstrap();
    if (!fs.existsSync(venvPython)) {
      throw new Error("ZeroLLM virtualenv Python not found: " + venvPython);
    }

    sidecar = spawn(venvPython, [sidecarScript], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        ZEROLLM_HOST: "127.0.0.1",
        ZEROLLM_PORT: port,
        ZEROLLM_RUNTIME_OFFLINE:
          process.env.ZEROLLM_RUNTIME_OFFLINE || "true",
      },
    });

    sidecar.on("exit", (code, signal) => {
      console.error(
        "[hostinger-start] ZeroLLM sidecar exited code=" +
          code +
          " signal=" +
          (signal || "none"),
      );
      if (required) terminate(code || 1);
    });

    process.env.ZEROLLM_BASE_URL = process.env.ZEROLLM_BASE_URL || baseUrl;
    console.log(
      "[hostinger-start] ZeroLLM sidecar enabled at " + process.env.ZEROLLM_BASE_URL,
    );
  }

  api = spawn(process.execPath, ["--enable-source-maps", nodeEntry], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });

  api.on("exit", (code, signal) => {
    console.log(
      "[hostinger-start] API exited code=" +
        code +
        " signal=" +
        (signal || "none"),
    );
    terminate(code || 0);
  });
} catch (error) {
  console.error(
    "[hostinger-start] startup failed: " +
      (error instanceof Error ? error.message : String(error)),
  );
  terminate(1);
}
