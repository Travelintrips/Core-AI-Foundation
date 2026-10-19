/**
 * Explicitly enabled pairing-approval host. Identity configuration belongs to
 * deployment; a shared production identity store must never be labelled DEV.
 * This entrypoint does not import app.ts, index.ts or background runtimes.
 */
import { readFileSync } from "node:fs";
import { bootstrapGcpSecrets } from "./lib/gcpSecretsBootstrap.js";

if (process.env["PAIRING_APPROVAL_ENABLED"] !== "true") {
  throw new Error("Pairing approval runtime requires explicit enablement");
}
const identityEnvironment = process.env["PAIRING_APPROVAL_IDENTITY_ENV"];
if (identityEnvironment !== "development" && identityEnvironment !== "production") {
  throw new Error("PAIRING_APPROVAL_IDENTITY_ENV must be explicit");
}
function assertIdentityEnvironment(): void {
  if (process.env["APP_ENV"] !== identityEnvironment ||
      process.env["NODE_ENV"] !== identityEnvironment) {
    throw new Error("Pairing identity environment does not match APP_ENV/NODE_ENV");
  }
}
assertIdentityEnvironment();
const configuredOrigin = process.env["AI_CORE_PUBLIC_BASE_URL"]?.replace(/\/$/, "");
if (!configuredOrigin) throw new Error("AI_CORE_PUBLIC_BASE_URL must be explicit");
const issuer = new URL(configuredOrigin);
if (issuer.protocol !== "https:" || issuer.origin !== configuredOrigin) {
  throw new Error("Pairing approval requires an explicit HTTPS issuer origin");
}
const buildSha = process.env["PAIRING_APPROVAL_BUILD_SHA"] ?? "";
if (!/^[0-9a-f]{40}$/.test(buildSha)) {
  throw new Error("PAIRING_APPROVAL_BUILD_SHA must identify the immutable overlay source");
}
const port = Number(process.env["PORT"] ?? "3000");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error("Invalid pairing approval port");
}

// Preserve the existing bootstrap mechanism; no secret file is invented or
// copied, and no database is imported until deployment configuration is loaded.
if (!process.env["GCP_SECRET_MANAGER_BOOTSTRAP_JSON"] &&
    process.env["GCP_SECRET_MANAGER_BOOTSTRAP_FILE"]) {
  process.env["GCP_SECRET_MANAGER_BOOTSTRAP_JSON"] =
    readFileSync(process.env["GCP_SECRET_MANAGER_BOOTSTRAP_FILE"], "utf8");
}
await bootstrapGcpSecrets();
assertIdentityEnvironment();
if (process.env["AI_CORE_PUBLIC_BASE_URL"]?.replace(/\/$/, "") !== configuredOrigin) {
  throw new Error("Pairing issuer changed during secret bootstrap");
}
if (!process.env["SESSION_SECRET"]?.trim()) {
  throw new Error("Pairing approval requires the configured identity session secret");
}

const { createPairingApprovalApp } = await import("./pairingApprovalApp.js");
const { default: oauthRouter } = await import("./routes/ai-core-mcp-oauth.js");
const { pool } = await import("@workspace/db");
const app = createPairingApprovalApp({
  oauthRouter,
  publicOrigin: configuredOrigin,
  identityEnvironment,
  buildSha,
});
const server = app.listen(port, () => console.log(JSON.stringify({
  code: "PAIRING_APPROVAL_LISTENING",
  port,
  identityEnvironment,
  scope: "PAIRING_APPROVAL_ONLY",
  backgroundControllers: false,
  buildSha,
})));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close(() => {
    void pool.end().then(() => process.exit(0), () => process.exit(1));
  }));
}
