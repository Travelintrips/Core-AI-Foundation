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
