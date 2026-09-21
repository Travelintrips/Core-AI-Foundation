const { execFileSync } = require("node:child_process");
const path = require("node:path");

const ua = process.env.npm_config_user_agent || "";
if (ua.startsWith("pnpm/")) process.exit(0);

const prefix = path.join(process.env.HOME || process.cwd(), ".local");
console.log("[hostinger] npm bootstrap detected; installing pinned pnpm 10.28.1 to user prefix...");
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "install", "--global", "--prefix", prefix, "pnpm@10.28.1", "--no-audit", "--no-fund"
], { stdio: "inherit" });

const binDir = path.join(prefix, "bin");
process.env.PATH = binDir + path.delimiter + (process.env.PATH || "");
console.log("[hostinger] pnpm installed under user prefix:", prefix);
