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
  parseCriticalApprovalCommand,
  requiresHumanCriticalApproval,
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
  it("requires a human only for destructive production database/security changes", () => {
    expect(requiresHumanCriticalApproval("PRODUCTION_DB_MIGRATION")).toBe(true);
    expect(requiresHumanCriticalApproval("DESTRUCTIVE_DB_CHANGE")).toBe(true);
    expect(requiresHumanCriticalApproval("SECURITY_CHANGE")).toBe(true);
  });

  it("auto-advances ordinary coding, merge, deploy, handoff, and restart actions", () => {
    expect(requiresHumanCriticalApproval("WORKSTREAM_AI_HANDOFF")).toBe(false);
    expect(requiresHumanCriticalApproval("MERGE_PR")).toBe(false);
    expect(requiresHumanCriticalApproval("PRODUCTION_DEPLOY")).toBe(false);
    expect(requiresHumanCriticalApproval("PRODUCTION_SERVICE_RESTART")).toBe(false);
  });
});
