const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ua = process.env.npm_config_user_agent || "";
if (ua.startsWith("pnpm/")) process.exit(0);

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(manifest.packageManager || "");
if (!match) throw new Error("[hostinger-bootstrap] packageManager must pin pnpm version");
const version = match[1];
const prefix = path.join(process.env.HOME || process.cwd(), ".local");
const pnpmBinary = path.join(prefix, "bin", process.platform === "win32" ? "pnpm.cmd" : "pnpm");

function run(label, command, args, env = process.env) {
  console.log("[hostinger-bootstrap] " + label);
  const result = spawnSync(command, args, {
    cwd: root, env, stdio: "inherit", timeout: 240000,
  });
  if (result.error) {
    console.error("[hostinger-bootstrap] " + label + " failed: " + result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error("[hostinger-bootstrap] " + label + " exit=" + result.status + " signal=" + (result.signal || "none"));
    process.exit(result.status || 1);
  }
}
function isPinnedPnpm(command) {
  const r = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 10000 });
  return !r.error && r.status === 0 && r.stdout.trim() === version;
}
console.log("[hostinger-bootstrap] node=" + process.version + " expected pnpm=" + version);
let command = pnpmBinary;
if (!fs.existsSync(pnpmBinary) || !isPinnedPnpm(pnpmBinary)) {
  // Reuse an already-provisioned matching pnpm on PATH, avoiding unnecessary
  // npm global install during Hostinger's time-constrained build.
  if (isPinnedPnpm(process.platform === "win32" ? "pnpm.cmd" : "pnpm")) {
    command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    console.log("[hostinger-bootstrap] using preinstalled pinned pnpm");
  } else {
    run("install pinned pnpm to user prefix", process.platform === "win32" ? "npm.cmd" : "npm",
      ["install", "--global", "--prefix", prefix, "pnpm@" + version, "--no-audit", "--no-fund"]);
    if (!fs.existsSync(pnpmBinary)) {
      console.error("[hostinger-bootstrap] missing pnpm binary: " + pnpmBinary);
      process.exit(1);
    }
  }
}
const env = { ...process.env, PATH: path.dirname(command === pnpmBinary ? pnpmBinary : process.cwd()) +
  path.delimiter + (process.env.PATH || "") };
run("install workspace with frozen lockfile", command, ["install", "--frozen-lockfile"], env);
console.log("[hostinger-bootstrap] WORKSPACE_DEPENDENCIES_INSTALLED");
