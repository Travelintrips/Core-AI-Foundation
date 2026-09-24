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

const env = { ...process.env };
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
run(process.execPath, [path.join(process.cwd(), "scripts", "zerollm-bootstrap.cjs")], env);
