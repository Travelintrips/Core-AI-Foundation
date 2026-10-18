/**
 * Dedicated V2 gateway. OAuth keeps its existing identity store, while EVERY
 * operational tool is forwarded to DEV. Do not launch index.ts or app.ts here:
 * a gateway must never start production task/worker/recovery schedulers.
 */
import { readFileSync } from "node:fs";
import { bootstrapGcpSecrets } from "./lib/gcpSecretsBootstrap.js";

if (process.env["AI_CORE_MCP_TARGET_ENV"] !== "DEV") throw new Error("DEV gateway requires an explicit DEV target");
if (!process.env["GCP_SECRET_MANAGER_BOOTSTRAP_JSON"] && process.env["GCP_SECRET_MANAGER_BOOTSTRAP_FILE"]) {
  process.env["GCP_SECRET_MANAGER_BOOTSTRAP_JSON"] = readFileSync(process.env["GCP_SECRET_MANAGER_BOOTSTRAP_FILE"], "utf8");
}
await bootstrapGcpSecrets();
const { default: express } = await import("express");
const { default: helmet } = await import("helmet");
const { createDevOnlyMcpGateway, devOnlyRelayConfiguration } = await import("./middleware/devOnlyMcpGateway.js");
const { default: discoveryRouter } = await import("./routes/ai-core-mcp.js");
const { globalLimiter, mcpLimiter } = await import("./middleware/rateLimiter.js");
devOnlyRelayConfiguration();
const port = Number(process.env["PORT"] ?? "3000");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid gateway port");
const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.get("/api/healthz", (_req, res) => res.json({
  status: "ok", service: "dev-only-mcp-gateway", executionEnvironment: "DEV",
  routePolicy: "DEV_ONLY_NO_PROD_FALLBACK", backgroundControllers: false,
  buildSha: process.env["DEV_GATEWAY_BUILD_SHA"] ?? null,
}));
app.use("/api", globalLimiter, mcpLimiter, createDevOnlyMcpGateway(), discoveryRouter);
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
const server = app.listen(port, () => console.log(JSON.stringify({
  code: "DEV_ONLY_MCP_LISTENING", port, executionEnvironment: "DEV", backgroundControllers: false,
})));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
