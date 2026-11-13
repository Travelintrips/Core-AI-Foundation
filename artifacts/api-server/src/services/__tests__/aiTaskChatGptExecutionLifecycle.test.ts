import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../../routes/coding-control-bridge.ts", import.meta.url), "utf8");
const wake = readFileSync(new URL("../devChatGptWakeService.ts", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../localCodingControlBridgeService.ts", import.meta.url), "utf8");

describe("AI Task GPT02 execution lifecycle linkage", () => {
  it("creates an execution identity before queueing the browser wake", () => {
    const prepare = route.indexOf("prepareAiTaskChatGptExecution({");
    const queue = route.indexOf("queueDevBrowserWake({", prepare);
    expect(prepare).toBeGreaterThan(-1);
    expect(queue).toBeGreaterThan(prepare);
    expect(route).toContain("ai-task-chatgpt-dispatch:");
    expect(route).toContain("pg_advisory_xact_lock");
    expect(route).toContain("AI_TASK_EXECUTION_SOURCE_NOT_FOUND");
    expect(route).toContain("AI_TASK_EXECUTION_TERMINAL_REVIEW_REQUIRED");
    expect(route).toContain("AI_TASK_EXECUTION_ACTIVE");
    expect(route).toContain('current["idempotency_key"] !== idempotencyKey && status !== "prepared"');
    expect(route).toContain("executionJobId:execution.executionId");
    expect(route).toContain("markAiTaskChatGptExecutionDispatchFailed");
    expect(route).toContain("productionAllowed',false");
  });

  it("carries executionJobId in the signed wake metadata and rejects terminal duplicate reuse", () => {
    expect(wake).toContain("executionJobId?: string");
    expect(wake).toContain("UUID.test(input.executionJobId)");
    expect(wake).toContain("{ executionJobId: input.executionJobId }");
    expect(wake).toContain('const activeStatus = command.status === undefined ||');
    expect(wake).toContain('["RECEIVED","PENDING","QUEUED","PROCESSING"].includes(command.status)');
    expect(wake).toContain('metadata["executionJobId"] !== input.executionJobId');
  });

  it("updates the same execution row from callback to attestation verification", () => {
    expect(bridge).toContain('const executionJobId = typeof commandMetadata["executionJobId"]');
    expect(bridge).toContain("callback_verified = TRUE");
    expect(bridge).toContain("attestation_verified = CASE WHEN");
    expect(bridge).toContain('const executionStatus = verifiedStatus === "FAILED" ? "failed" : "verifying"');
    expect(bridge).toContain("execution.command_id = acknowledged.command_id");
  });

  it("marks final ACK only for an attested completed callback", () => {
    expect(bridge).toContain("acknowledged.kind = 'COMPLETED'");
    expect(bridge).toContain("execution.callback_verified IS TRUE");
    expect(bridge).toContain("execution.attestation_verified IS TRUE");
    expect(bridge).toContain("final_ack_verified = TRUE");
    expect(bridge).toContain("status = 'completed'");
  });
});
