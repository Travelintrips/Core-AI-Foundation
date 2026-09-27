import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
function loadEnvText(text: string): void {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  const instruction = process.argv.slice(2).join(" ").trim();
  if (!instruction) {
    throw new Error(
      'Usage: pnpm --filter @workspace/api-server run powershell:ollama -- "<instruction>"',
    );
  }

  const repoRoot = resolve(process.cwd(), "../..");
  const envFile = resolve(repoRoot, ".env.development");
  const envText = await readFile(envFile, "utf8").catch(() => "");
  if (envText) loadEnvText(envText);

  process.env.LOCAL_CODING_POWERSHELL_ROOT ||= repoRoot;
  process.env.OLLAMA_WORKER_POWERSHELL_ENABLED ||= "true";
  process.env.OLLAMA_WORKER_POWERSHELL_TRUSTED_MODE ||= "true";

  const { runDirectLocalOllamaPowerShellTask } = await import(
    "../services/localCodingDirectOllamaPowerShellService.js"
  );

  const result = await runDirectLocalOllamaPowerShellTask({
    instruction,
    requestedBy: "local-cli",
    timeoutMs: 180_000,
    env: process.env,
  });

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(
    "[powershell:ollama] " +
      (error instanceof Error ? error.stack || error.message : String(error)) +
      "\n",
  );
  process.exitCode = 1;
});
