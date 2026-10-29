import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const service = readFileSync(new URL("../localCodingControlBridgeService.ts", import.meta.url), "utf8");
const terminal = service.slice(service.indexOf("export async function completeCodingBridgeCommand"), service.indexOf("export async function getCodingBridgeCommandExecutionState"));
const route = readFileSync(new URL("../../routes/coding-control-bridge.ts", import.meta.url), "utf8");

describe("GPT02 terminal persistence regression guards", () => {
  it("persists terminal command, task and response inside the same transaction", () => {
    expect(terminal).toContain("const persisted = await db.transaction(async (tx) => {");
    expect(terminal).toContain("await tx.execute(sql`");
    expect(terminal).toContain("await tx.insert(aiCodingBridgeResponsesTable)");
    expect(terminal).not.toContain("await appendCodingBridgeResponse(");
  });
  it("fans out only after durable commit and skips a rejected claim", () => {
    expect(terminal.indexOf("if (!persisted) return null;")).toBeGreaterThan(terminal.indexOf("await tx.insert(aiCodingBridgeResponsesTable)"));
    expect(terminal.indexOf("fanoutCodingBridgeResponse(response,")).toBeGreaterThan(terminal.indexOf("if (!persisted) return null;"));
    expect(terminal).toContain("metadata_json ->> 'claimToken' = ${input.claimToken}::text");
  });
  it("requires authenticated GPT02 dispatch and correlation-scoped timeline", () => {
    expect(route).toContain('router.post("/ai/coding/bridge/ai-task-chatgpt-dispatch"');
    expect(route).toContain('router.get("/ai/coding/bridge/ai-task-chatgpt-timeline"');
    expect(route).toContain("authorizedAiTaskBridge(req)");
    expect(route).toContain('metadata["correlationId"]!==parsed.data.correlationId');
  });
});
