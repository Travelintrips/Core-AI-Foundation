const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ua = process.env.npm_config_user_agent || "";
if (ua.startsWith("pnpm/")) process.exit(0);

const prefix = path.join(process.env.HOME || process.cwd(), ".local");
console.log("[hostinger] npm bootstrap detected; installing pinned pnpm 10.28.1 to user prefix...");
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "install", "--global", "--prefix", prefix, "pnpm@10.28.1", "--no-audit", "--no-fund"
], { stdio: "inherit" });

const pnpm = path.join(prefix, "bin", process.platform === "win32" ? "pnpm.cmd" : "pnpm");
if (!fs.existsSync(pnpm)) throw new Error(`pnpm bootstrap failed: ${pnpm} not found`);

console.log("[hostinger] installing full pnpm workspace dependencies...");
execFileSync(pnpm, ["install", "--frozen-lockfile"], {
  stdio: "inherit",
  env: { ...process.env, PATH: path.dirname(pnpm) + path.delimiter + (process.env.PATH || "") }
});
console.log("[hostinger] full workspace dependencies installed");
