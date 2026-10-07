import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    execute: vi.fn(),
  },
}));
vi.mock("../aiAuditService.js", () => ({
  logAudit: vi.fn(async () => undefined),
}));
vi.mock("../codingWhatsappNotificationService.js", () => ({
  sendCodingApprovalRequest: vi.fn(),
  sendCodingApprovalResult: vi.fn(),
}));
vi.mock("../codingControlBridgeSchemaService.js", () => ({
  ensureCodingControlBridgeTables: vi.fn(async () => undefined),
}));

import {
  criticalApprovalExecutionMode,
  isHumanCriticalApprovalActionType,
  parseCriticalApprovalCommand,
} from "../codingCriticalApprovalService.js";

describe("critical coding approval command parser", () => {
  it.each([
    ["APPROVE AbCdEfGhIjKl", "APPROVE"],
    ["approve AbCdEfGhIjKl", "APPROVE"],
    ["SETUJUI AbCdEfGhIjKl", "APPROVE"],
    ["REJECT AbCdEfGhIjKl", "REJECT"],
    ["TOLAK AbCdEfGhIjKl", "REJECT"],
  ] as const)("parses %s", (text, decision) => {
    expect(parseCriticalApprovalCommand(text)).toEqual({
      decision,
      token: "AbCdEfGhIjKl",
    });
  });

  it.each([
    "APPROVE",
    "YES AbCdEfGhIjKl",
    "APPROVE short",
    "coding APPROVE AbCdEfGhIjKl",
    "APPROVE AbCdEfGhIjKl extra",
  ])("rejects malformed approval input: %s", (text) => {
    expect(parseCriticalApprovalCommand(text)).toBeNull();
  });
});


describe("critical coding approval policy", () => {
  it("reserves human approval for destructive database/security actions", () => {
    expect(isHumanCriticalApprovalActionType("PRODUCTION_DB_MIGRATION")).toBe(true);
    expect(isHumanCriticalApprovalActionType("DESTRUCTIVE_DB_CHANGE")).toBe(true);
    expect(isHumanCriticalApprovalActionType("SECURITY_CHANGE")).toBe(true);
    expect(isHumanCriticalApprovalActionType("MERGE_PR")).toBe(false);
    expect(isHumanCriticalApprovalActionType("PRODUCTION_DEPLOY")).toBe(false);
    expect(isHumanCriticalApprovalActionType("PRODUCTION_SERVICE_RESTART")).toBe(false);
    expect(isHumanCriticalApprovalActionType("WORKSTREAM_AI_HANDOFF")).toBe(false);
  });

  it("keeps true critical approvals authorization-only", () => {
    expect(criticalApprovalExecutionMode("PRODUCTION_DB_MIGRATION")).toBe("AUTHORIZATION_ONLY");
    expect(criticalApprovalExecutionMode("DESTRUCTIVE_DB_CHANGE")).toBe("AUTHORIZATION_ONLY");
    expect(criticalApprovalExecutionMode("SECURITY_CHANGE")).toBe("AUTHORIZATION_ONLY");
    expect(criticalApprovalExecutionMode("MERGE_PR")).toBe("IMMEDIATE_LEGACY_ADAPTER");
  });
});
