import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const cwd = process.cwd();
const pnpmExecPath = process.env.npm_execpath;

const buildCommand = pnpmExecPath
  ? {
      command: process.execPath,
      args: [pnpmExecPath, "run", "build"],
    }
  : process.platform === "win32"
    ? {
        command: process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/s", "/c", "pnpm run build"],
      }
    : {
        command: "pnpm",
        args: ["run", "build"],
      };

const build = spawnSync(buildCommand.command, buildCommand.args, {
  cwd,
  env: { ...process.env, NODE_ENV: "development" },
  stdio: "inherit",
  shell: false,
});

if (build.error) {
  console.error("[dev] Failed to start build:", build.error);
  process.exit(1);
}

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const envFile = resolve(cwd, "../../.env.development");
const args = [
  ...(existsSync(envFile) ? [`--env-file=${envFile}`] : []),
  "--enable-source-maps",
  "./dist/index.mjs",
];

const server = spawnSync(process.execPath, args, {
  cwd,
  env: { ...process.env, NODE_ENV: "development" },
  stdio: "inherit",
  shell: false,
});

if (server.error) {
  console.error("[dev] Failed to start API server:", server.error);
  process.exit(1);
}

process.exit(server.status ?? 0);
