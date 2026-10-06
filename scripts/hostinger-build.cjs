const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

function canExecute(command, env) {
  const result = spawnSync(command, ["--version"], { stdio: "inherit", env });
  return !result.error && (result.status ?? 1) === 0;
}

function readCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error || (result.status ?? 1) !== 0) return "";
  return String(result.stdout ?? "").trim();
}

function isCommitSha(value) {
  return /^[0-9a-f]{40}$/i.test(String(value ?? "").trim());
}

function resolveBuildCommitSha(env) {
  // Native Hostinger Git deployments may retain CST_BUILD_COMMIT_SHA from an
  // older release. The checked-out Git HEAD is the source of truth whenever
  // the repository metadata is available.
  const gitSha = readCommand("git", ["rev-parse", "HEAD"]);
  if (isCommitSha(gitSha)) return gitSha.toLowerCase();

  // Archive/CI builds may not include .git; accept well-known immutable CI
  // commit variables before falling back to the legacy Hostinger variable.
  for (const candidate of [
    env.GITHUB_SHA,
    env.CI_COMMIT_SHA,
    env.CST_BUILD_COMMIT_SHA,
  ]) {
    if (isCommitSha(candidate)) return String(candidate).trim().toLowerCase();
  }

  return "unknown";
}

function writeBuildMetadata(env) {
  const commitSha = resolveBuildCommitSha(env);
  const builtAt = new Date().toISOString();
  const root = process.cwd();
  const markerPath = path.join(root, ".cst-build-sha");
  const publicDir = path.join(root, "artifacts", "ai-platform", "public");
  const publicMetaPath = path.join(publicDir, "build-meta.json");

  fs.writeFileSync(markerPath, commitSha + "\n", { encoding: "utf8" });
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(
    publicMetaPath,
    JSON.stringify({ commitSha, builtAt }, null, 2) + "\n",
    { encoding: "utf8" },
  );

  env.CST_BUILD_COMMIT_SHA = commitSha;
  console.log(`[hostinger-build] Build commit: ${commitSha}`);
  console.log(`[hostinger-build] Frontend build metadata: ${publicMetaPath}`);
}

const env = { ...process.env };
writeBuildMetadata(env);
const pnpmStore = path.join(process.cwd(), "node_modules", ".pnpm");

if (process.platform === "linux" && fs.existsSync(pnpmStore)) {
  const entry = fs
    .readdirSync(pnpmStore)
    .filter((name) => name.startsWith("@esbuild+linux-x64@"))
    .sort()
    .pop();

  if (entry) {
    const source = path.join(
      pnpmStore,
      entry,
      "node_modules",
      "@esbuild",
      "linux-x64",
      "bin",
      "esbuild",
    );

    if (fs.existsSync(source)) {
      const cacheDir = path.join(os.homedir(), ".cache", "aifront-hostinger");
      fs.mkdirSync(cacheDir, { recursive: true });
      const target = path.join(cacheDir, `esbuild-${process.pid}`);

      fs.copyFileSync(source, target);
      fs.chmodSync(target, 0o755);

      if (!canExecute(target, env)) {
        throw new Error(
          `Hostinger esbuild executable is still blocked after copying to ${target}`,
        );
      }

      env.ESBUILD_BINARY_PATH = target;
      console.log(`[hostinger-build] Using executable esbuild: ${target}`);
    }
  }
}

run("pnpm", ["run", "build:workspace"], env);

const zerollmEnabled =
  String(env.ZEROLLM_ENABLED || "").toLowerCase() === "true";
const zerollmRequired =
  String(env.ZEROLLM_REQUIRED || "").toLowerCase() === "true";
const zerollmExplicitProvider =
  String(env.AI_CODING_PROVIDER || "").toLowerCase() === "zerollm";

if (zerollmEnabled || zerollmRequired || zerollmExplicitProvider) {
  run(
    process.execPath,
    [path.join(process.cwd(), "scripts", "zerollm-bootstrap.cjs")],
    env,
  );
} else {
  console.log(
    "[hostinger-build] ZeroLLM disabled; skipping optional Python bootstrap.",
  );
}
