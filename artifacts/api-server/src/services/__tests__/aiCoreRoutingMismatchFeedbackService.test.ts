import { describe, expect, it, vi } from "vitest";

const audit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../aiAuditService.js", () => ({ logAudit: audit }));

import { recordRoutingMismatchFeedback } from "../aiCoreRoutingMismatchFeedbackService.js";

describe("routing mismatch feedback", () => {
  it("records a fingerprint and correction without leaking user prompt", async () => {
    const secret = "sk-test-private-token";
    recordRoutingMismatchFeedback({
      message: "Cek dan perbaiki MCP " + secret,
      wrongRoute: "EXTERNAL_AGENT_STATUS",
      correctedRoute: "EXECUTION_ROUTER",
      ruleId: "inspect-repair-intent",
    });
    expect(audit).toHaveBeenCalledOnce();
    const payload = audit.mock.calls[0][0];
    expect(payload.action).toBe("ROUTING_MISMATCH_CORRECTED");
    expect(payload.details.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.details.autoDeployAuthorized).toBe(false);
    expect(payload.details.autoCodeChangeAuthorized).toBe(false);
    expect(JSON.stringify(payload)).not.toContain(secret);
  });
});
