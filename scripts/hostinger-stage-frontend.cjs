const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "artifacts", "ai-platform", "dist", "public");
const target = path.join(root, "artifacts", "api-server", "dist", "public");
if (!fs.existsSync(source)) throw new Error(`Frontend build output not found: ${source}`);
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
console.log("[hostinger] frontend staged into API deployment output");
