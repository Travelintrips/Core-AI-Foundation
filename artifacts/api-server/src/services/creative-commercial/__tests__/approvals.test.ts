/**
 * creative-commercial/__tests__/approvals.test.ts — Team 03
 *
 * Tests: approval creation, approval/rejection state transitions,
 * expiry guard, duplicate-reward prevention (can't approve twice).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.hoisted: must define before vi.mock factory runs ───────────────────────

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute: mockExecute },
  sql: new Proxy(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    { get: () => undefined },
  ),
}));

vi.mock("../../aiEventBusService.js", () => ({ publishSafe: vi.fn() }));

// ── Import after mock ─────────────────────────────────────────────────────────

import { createPendingApproval, approveApproval, rejectApproval, getApproval } from "../approvalService.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApprovalRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    customer_profile_id: 10,
    action_type: "issue_recovery_coupon",
    action_payload: { discountPercent: 10 },
    requested_by: "admin@test.com",
    status: "pending",
    approved_by: null,
    approved_at: null,
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeResult(rows: unknown[]) {
  return { rows };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createPendingApproval", () => {
  it("inserts and returns the new approval with pending status", async () => {
    mockExecute.mockResolvedValueOnce(makeResult([makeApprovalRow()]));

    const result = await createPendingApproval({
      customerProfileId: 10,
      actionType: "issue_recovery_coupon",
      actionPayload: { discountPercent: 10 },
      requestedBy: "admin@test.com",
    });

    expect(result.status).toBe("pending");
    expect(result.customerProfileId).toBe(10);
    expect(result.actionType).toBe("issue_recovery_coupon");
  });
});

describe("approveApproval", () => {
  it("transitions from pending to approved", async () => {
    // getApproval → SELECT
    mockExecute.mockResolvedValueOnce(makeResult([makeApprovalRow()]));
    // UPDATE to approved
    mockExecute.mockResolvedValueOnce(makeResult([makeApprovalRow({ status: "approved", approved_by: "manager@test.com" })]));

    const result = await approveApproval(1, "manager@test.com");
    expect(result.status).toBe("approved");
    expect(result.approvedBy).toBe("manager@test.com");
  });

  it("throws if approval is already approved (no duplicate reward)", async () => {
    // getApproval returns already-approved row
    mockExecute.mockResolvedValueOnce(
      makeResult([makeApprovalRow({ status: "approved", approved_by: "manager@test.com" })]),
    );

    await expect(approveApproval(1, "manager2@test.com")).rejects.toThrow(/already/i);
    // The UPDATE must NOT have been called — only 1 execute call total (SELECT)
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("throws if approval has expired", async () => {
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    // getApproval returns expired-but-still-pending row
    mockExecute.mockResolvedValueOnce(makeResult([makeApprovalRow({ expires_at: pastExpiry })]));
    // expireApproval UPDATE call
    mockExecute.mockResolvedValueOnce(makeResult([]));

    await expect(approveApproval(1, "manager@test.com")).rejects.toThrow(/expired/i);
  });

  it("throws if approval not found", async () => {
    mockExecute.mockResolvedValueOnce(makeResult([]));
    await expect(approveApproval(999, "manager@test.com")).rejects.toThrow(/not found/i);
  });
});

describe("rejectApproval", () => {
  it("transitions from pending to rejected", async () => {
    mockExecute.mockResolvedValueOnce(
      makeResult([makeApprovalRow({ status: "rejected", approved_by: "manager@test.com" })]),
    );

    const result = await rejectApproval(1, "manager@test.com", "price too high");
    expect(result.status).toBe("rejected");
  });

  it("throws if no pending approval found (already rejected/approved)", async () => {
    mockExecute.mockResolvedValueOnce(makeResult([])); // UPDATE returns 0 rows
    await expect(rejectApproval(1, "manager@test.com")).rejects.toThrow(/not found or not pending/i);
  });
});

describe("getApproval — auto-expiry", () => {
  it("auto-expires a pending approval past its expiry date on read", async () => {
    const pastExpiry = new Date(Date.now() - 100).toISOString();
    // SELECT returns expired-but-pending row
    mockExecute.mockResolvedValueOnce(makeResult([makeApprovalRow({ expires_at: pastExpiry })]));
    // UPDATE to expired
    mockExecute.mockResolvedValueOnce(makeResult([]));

    const result = await getApproval(1);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("expired");
  });
});
