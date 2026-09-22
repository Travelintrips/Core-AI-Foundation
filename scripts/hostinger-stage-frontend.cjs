const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
// AI Front is the public customer-facing site. Keep the internal ai-platform
// opt-in only so a missing Hostinger env var can never expose the staff login
// as the production landing page.
const rawFrontend = process.env.HOSTINGER_FRONTEND?.trim();
if (!rawFrontend) {
  throw new Error(
    'HOSTINGER_FRONTEND is required on Hostinger. Set "ai-platform" for aicore.cstlogistic.co.id and "customer-portal" for aifront.cstlogistic.co.id.',
  );
}
const frontend = rawFrontend;
const allowed = new Set(["customer-portal", "ai-platform"]);
if (!allowed.has(frontend)) {
  throw new Error(`Invalid HOSTINGER_FRONTEND "${frontend}". Expected customer-portal or ai-platform.`);
}
const source = path.join(root, "artifacts", frontend, "dist", "public");
const target = path.join(root, "artifacts", "api-server", "dist", "public");
if (!fs.existsSync(source)) throw new Error(`Frontend build output not found: ${source}`);
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
console.log(`[hostinger] ${frontend} frontend staged into API deployment output`);
