// DEV-only DELL agent presence and SSE readiness probe.
// Does not claim or execute jobs until a separate attested executor is installed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const clientId = "openclaw-dell-chatgpt-wake-dev";
const file = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "AI-Core", "dell-chatgpt-wake-dev.env");
const settings = Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).filter(line => line.trim() && !line.startsWith("#")).map(line => {
  const index = line.indexOf("=");
  if (index <= 0) throw new Error("Invalid credential configuration");
  return [line.slice(0, index), line.slice(index + 1).trim().replace(/^["']|["']$/g, "")];
}));
if (settings.AI_CORE_OPENCLAW_CLIENT_ID !== clientId ||
    settings.AI_CORE_BASE_URL?.replace(/\/$/, "") !== "https://dev.cstlogistic.co.id/api" ||
    !settings.AI_CORE_SCOPED_AGENT_TOKEN) throw new Error("Dedicated DEV configuration invalid");
const base = settings.AI_CORE_BASE_URL.replace(/\/$/, "");
const headers = { "x-ai-agent-token": settings.AI_CORE_SCOPED_AGENT_TOKEN };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function heartbeat() {
  const response = await fetch(base + "/ai/agent-runtime/presence/" + clientId + "/heartbeat", {
    method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ health: "healthy", version: "dell-wake-presence-1", details: { mode: "presence-only", executionEnabled: false } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Heartbeat HTTP " + response.status);
  console.log("HEARTBEAT_PASS " + new Date().toISOString());
}
async function stream() {
  const response = await fetch(base + "/ai/agent-runtime/work/stream?clientId=" + encodeURIComponent(clientId), {
    headers: { ...headers, accept: "text/event-stream" }, signal: AbortSignal.timeout(295000),
  });
  if (!response.ok || !response.body) throw new Error("SSE HTTP " + response.status);
  console.log("SSE_CONNECTED");
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    const data = decoder.decode(chunk);
    if (data.includes("event: ready")) console.log("SSE_READY");
    if (data.includes("event: work_available")) console.log("WORK_AVAILABLE_NOT_CLAIMED");
  }
}
await heartbeat();
while (true) {
  try {
    await Promise.race([
      stream(),
      (async () => { for (let i = 0; i < 4; i++) { await pause(60000); await heartbeat(); } })(),
    ]);
  } catch (error) {
    console.error("DEV_RECONNECT", error.message);
  }
  await pause(5000);
}
