const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const requirements = path.join(root, "services", "zerollm", "requirements.txt");
const installEnabled =
  String(process.env.ZEROLLM_INSTALL_ENABLED ?? (process.env.CI ? "false" : "true"))
    .toLowerCase() !== "false";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(command + " " + args.join(" ") + " failed with exit " + result.status);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || (result.status ?? 1) !== 0) return null;
  return String(result.stdout || "").trim();
}

function findPython() {
  const candidates = [
    process.env.ZEROLLM_PYTHON,
    process.platform === "win32" ? "py" : "python3",
    "python",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const args = candidate === "py" ? ["-3", "--version"] : ["--version"];
    const version = capture(candidate, args);
    if (!version) continue;
    const match = version.match(/Python\s+(\d+)\.(\d+)/i);
    if (!match) continue;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (major > 3 || (major === 3 && minor >= 10)) {
      return { command: candidate, prefixArgs: candidate === "py" ? ["-3"] : [], version };
    }
  }
  return null;
}

const runtimeHome =
  process.env.ZEROLLM_HOME ||
  path.join(os.homedir(), ".cache", "core-ai", "zerollm");
const venvDir = path.join(runtimeHome, "venv");
const marker = path.join(runtimeHome, "requirements.sha256");
const venvPython = path.join(
  venvDir,
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);

if (!fs.existsSync(requirements)) {
  throw new Error("ZeroLLM requirements file not found: " + requirements);
}

const requirementHash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(requirements))
  .digest("hex");

if (!installEnabled) {
  console.log(
    "[zerollm-bootstrap] install skipped (ZEROLLM_INSTALL_ENABLED=false, requirements=" +
      requirementHash.slice(0, 12) +
      ")",
  );
  process.exit(0);
}

const python = findPython();
if (!python) {
  const required =
    String(process.env.ZEROLLM_REQUIRED || "").toLowerCase() === "true" ||
    String(process.env.AI_CODING_PROVIDER || "").toLowerCase() === "zerollm";
  const message = "Python >=3.10 is required for ZeroLLM but was not found on PATH.";
  if (required) throw new Error(message);
  console.warn("[zerollm-bootstrap] WARNING: " + message + " Skipping optional local runtime.");
  process.exit(0);
}

fs.mkdirSync(runtimeHome, { recursive: true });

const markerMatches =
  fs.existsSync(marker) &&
  fs.readFileSync(marker, "utf8").trim() === requirementHash &&
  fs.existsSync(venvPython);

if (markerMatches) {
  const importCheck = spawnSync(
    venvPython,
    ["-c", "import zerollm; print('zerollm-ok')"],
    { stdio: "ignore" },
  );
  if ((importCheck.status ?? 1) === 0) {
    console.log(
      "[zerollm-bootstrap] dependency cache valid (" +
        requirementHash.slice(0, 12) +
        "), no install needed",
    );
    process.exit(0);
  }
}

console.log("[zerollm-bootstrap] using " + python.version);
if (!fs.existsSync(venvPython)) {
  run(python.command, [...python.prefixArgs, "-m", "venv", venvDir]);
}

run(venvPython, [
  "-m",
  "pip",
  "install",
  "--disable-pip-version-check",
  "--no-input",
  "--requirement",
  requirements,
]);

fs.writeFileSync(marker, requirementHash + "\n");
console.log("[zerollm-bootstrap] installed zerollm-kit into " + venvDir);

const explicitProvider =
  String(process.env.AI_CODING_PROVIDER || "").toLowerCase() === "zerollm";
const enabled =
  String(process.env.ZEROLLM_ENABLED || "").toLowerCase() === "true" ||
  explicitProvider;
const preloadSetting = process.env.ZEROLLM_PRELOAD_MODEL;
const preload =
  preloadSetting == null
    ? explicitProvider
    : String(preloadSetting).toLowerCase() === "true";
if (enabled && preload) {
  const model =
    process.env.ZEROLLM_MODEL ||
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B";
  console.log("[zerollm-bootstrap] pre-downloading model " + model);
  run(venvPython, ["-m", "zerollm", "download", model], {
    env: { ...process.env, HF_HUB_DISABLE_TELEMETRY: "1" },
  });
}
