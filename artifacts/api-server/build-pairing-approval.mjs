import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const sourceSha = process.env.PAIRING_APPROVAL_BUILD_SHA ?? "";
if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
  throw new Error("PAIRING_APPROVAL_BUILD_SHA must be the immutable overlay source SHA");
}
const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/pairingApprovalServer.ts"],
  outfile: "dist-pairing/pairing-approval.mjs",
  platform: "node",
  target: "node22",
  format: "esm",
  bundle: true,
  metafile: true,
  // Resolve these from this API workspace, never from a missing root tsx loader.
  // Bundle @workspace/db because its package exports TypeScript source.
  external: [
    "express", "cors", "cookie-parser", "helmet", "jsonwebtoken",
    "google-auth-library", "pg-native",
  ],
  banner: {
    js: "import { createRequire as __pairingRequire } from 'node:module'; globalThis.require = __pairingRequire(import.meta.url);",
  },
  logLevel: "warning",
});
const inputs = Object.keys(result.metafile.inputs).sort();
const applicationEntrypoints = new Set([
  path.resolve(root, "src/app.ts"),
  path.resolve(root, "src/index.ts"),
]);
const forbidden = inputs.filter((input) =>
  applicationEntrypoints.has(path.resolve(root, input)) ||
  /(?:^|\/)src\/services\/(?:jobDispatcherService|aiSchedulerService|localCodingAutonomousRepairService|codingOrchestratorService|aiTaskLedgerReconciliationService|devContinuityWatchService)\.ts$/.test(input));
if (forbidden.length) {
  throw new Error("Pairing-only build imported a forbidden application runtime");
}
await writeFile(path.join(root, "dist-pairing/build-inputs.json"), JSON.stringify({
  sourceSha,
  entrypoint: "src/pairingApprovalServer.ts",
  forbiddenRuntimeImports: [],
  inputs,
}, null, 2) + "\n");
console.log("PAIRING_APPROVAL_BUILD=PASS source=" + sourceSha + " inputs=" + inputs.length);
