const { execFileSync } = require("node:child_process");

const ua = process.env.npm_config_user_agent || "";
if (ua.startsWith("pnpm/")) process.exit(0);

console.log("[hostinger] npm bootstrap detected; installing pinned pnpm 10.28.1...");
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", [
  "install", "--global", "pnpm@10.28.1", "--no-audit", "--no-fund"
], { stdio: "inherit" });
console.log("[hostinger] pnpm 10.28.1 ready");
