/**
 * creative-commercial/__tests__/approvals.test.ts — Team 03
 *
 * Audit remediation tests for the approval gate adapter:
 *
 *   - createPendingApproval: idempotent (same customer+actionType returns existing gate)
 *   - approveApproval: transitions pending→approved, publishes event
 *   - approveApproval: throws if already approved (no duplicate reward)
 *   - approveApproval: throws if gate not found
 *   - rejectApproval: transitions pending→rejected
 *   - rejectApproval: throws if gate already approved
 *   - rejectApproval: throws if gate not found
 *   - DB failure path: execute throws → error propagates
 *   - Reward idempotency: verifyGate is called exactly once per approve
 *
 * The adapter is backed by ai_commercial_gates (gate_type='admin_approval').
 * We mock db.execute, db.insert (for create), verifyGate, failGate from
 * commercialGateService.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.hoisted: must be defined before vi.mock factories run ──────────────────

const { mockExecute, mockInsert, mockVerifyGate, mockFailGate, mockPublishSafe } = vi.hoisted(() => ({
  mockExecute:    vi.fn(),
  mockInsert:     vi.fn(),
  mockVerifyGate: vi.fn(),
  mockFailGate:   vi.fn(),
  mockPublishSafe: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  // db.insert().values().returning() chain — only mockInsert controls the resolved value
  const insert = () => ({
    values: () => ({
      returning: () => mockInsert(),
    }),
  });

  return {
    db: { execute: mockExecute, insert },
    aiCommercialGatesTable: {},
    sql: new Proxy(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
      { get: () => () => ({}) },
    ),
  };
});

vi.mock("../../commercialGateService.js", () => ({
  verifyGate: mockVerifyGate,
  failGate:   mockFailGate,
}));

vi.mock("../../aiEventBusService.js", () => ({ publishSafe: mockPublishSafe }));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  createPendingApproval,
  approveApproval,
  rejectApproval,
  getApproval,
  listPendingApprovals,
} from "../approvalService.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOTES = JSON.stringify({
  actionType: "issue_recovery_coupon",
  actionPayload: { discountPercent: 10 },
  requestedBy: "admin@test.com",
  customerProfileId: 10,
  source: "creative-commercial",
});

function makeGateRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 1,
    gate_type: "admin_approval",
    status: "pending",
    notes: NOTES,
    verified_by: null,
    verified_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tenant_id: null,
    service_request_id: null,
    quotation_id: null,
    service_quotation_id: null,
    required_amount: null,
    verified_amount: null,
    reference_number: null,
    ...overrides,
  };
}

function execResult(rows: unknown[]) {
  return { rows };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── createPendingApproval ─────────────────────────────────────────────────────

describe("createPendingApproval", () => {
  it("creates a new gate when no existing pending gate", async () => {
    // idempotency SELECT → no rows
    mockExecute.mockResolvedValueOnce(execResult([]));
    // db.insert().values().returning() → new gate
    mockInsert.mockResolvedValueOnce([makeGateRow()]);

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

  it("returns existing pending gate instead of creating a duplicate (idempotency)", async () => {
    // idempotency SELECT → existing gate found
    mockExecute.mockResolvedValueOnce(execResult([makeGateRow({ id: 42 })]));
    // insert must NOT be called
    mockInsert.mockResolvedValueOnce(undefined);

    const result = await createPendingApproval({
      customerProfileId: 10,
      actionType: "issue_recovery_coupon",
      actionPayload: { discountPercent: 15 }, // different payload — should return old gate
      requestedBy: "admin2@test.com",
    });

    expect(result.id).toBe(42);
    expect(result.status).toBe("pending");
    // insert never called
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("throws on DB failure during idempotency check", async () => {
    mockExecute.mockRejectedValueOnce(new Error("DB connection lost"));
    await expect(
      createPendingApproval({
        customerProfileId: 10,
        actionType: "issue_recovery_coupon",
        actionPayload: {},
        requestedBy: "admin@test.com",
      }),
    ).rejects.toThrow("DB connection lost");
  });

  it("throws on DB failure during insert", async () => {
    mockExecute.mockResolvedValueOnce(execResult([])); // idempotency: no existing
    mockInsert.mockRejectedValueOnce(new Error("unique constraint"));
    await expect(
      createPendingApproval({
        customerProfileId: 10,
        actionType: "issue_recovery_coupon",
        actionPayload: {},
        requestedBy: "admin@test.com",
      }),
    ).rejects.toThrow();
  });
});

// ── approveApproval ───────────────────────────────────────────────────────────

describe("approveApproval", () => {
  it("transitions pending gate to approved and publishes event", async () => {
    // loadGate SELECT → pending gate
    mockExecute.mockResolvedValueOnce(execResult([makeGateRow()]));
    // verifyGate → verified gate
    mockVerifyGate.mockResolvedValueOnce(makeGateRow({ status: "verified", verified_by: "manager@test.com" }));

    const result = await approveApproval(1, "manager@test.com");

    expect(result.status).toBe("approved");
    expect(result.approvedBy).toBe("manager@test.com");
    expect(mockVerifyGate).toHaveBeenCalledTimes(1);
    expect(mockVerifyGate).toHaveBeenCalledWith(1, "manager@test.com");
    expect(mockPublishSafe).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "commercial.approval.granted",
      payload: expect.objectContaining({ customerProfileId: 10 }),
    }));
  });

  it("throws if gate is already approved — prevents duplicate reward issuance", async () => {
    // loadGate → verified (already approved)
    mockExecute.mockResolvedValueOnce(execResult([makeGateRow({ status: "verified" })]));

    await expect(approveApproval(1, "manager2@test.com")).rejects.toThrow(/already approved/i);
    // verifyGate must NOT be called — no re-approval at DB level
    expect(mockVerifyGate).not.toHaveBeenCalled();
    // No event published
    expect(mockPublishSafe).not.toHaveBeenCalled();
  });

  it("throws if gate is rejected", async () => {
    mockExecute.mockResolvedValueOnce(execResult([makeGateRow({ status: "failed" })]));
    await expect(approveApproval(1, "manager@test.com")).rejects.toThrow(/already rejected/i);
    expect(mockVerifyGate).not.toHaveBeenCalled();
  });

  it("throws if gate not found", async () => {
    mockExecute.mockResolvedValueOnce(execResult([]));
    await expect(approveApproval(999, "manager@test.com")).rejects.toThrow(/not found/i);
    expect(mockVerifyGate).not.toHaveBeenCalled();
  });

  it("does NOT call verifyGate more than once (reward issuance idempotency)", async () => {
    mockExecute.mockResolvedValue(execResult([makeGateRow()]));
    mockVerifyGate.mockResolvedValue(makeGateRow({ status: "verified", verified_by: "mgr" }));

    await approveApproval(1, "mgr");

    expect(mockVerifyGate).toHaveBeenCalledTimes(1);
  });

  it("propagates DB failure from verifyGate", async () => {
    mockExecute.mockResolvedValueOnce(execResult([makeGateRow()]));
    mockVerifyGate.mockRejectedValueOnce(new Error("DB timeout"));

    await expect(approveApproval(1, "manager@test.com")).rejects.toThrow("DB timeout");
  });
});

// ── rejectApproval ────────────────────────────────────────────────────────────

describe("rejectApproval", () => {
  it("transitions pending gate to rejected", async () => {
    mockExecute.mockResolvedValueOnce(execResult([makeGateRow()]));
    mockFailGate.mockResolvedValueOnce(makeGateRow({ status: "failed" }));

    const result = await rejectApproval(1, "manager@test.com", "price too high");

    expect(result.status).toBe("rejected");
    expect(mockFailGate).toHaveBeenCalledTimes(1);
    expect(mockFailGate).toHaveBeenCalledWith(1, "price too high");
  });

  it("throws if gate is already approved (cannot reject an approved gate)", async () => {
    mockExecute.mockResolvedValueOnce(execResult([makeGateRow({ status: "verified" })]));
    await expect(rejectApproval(1, "manager@test.com")).rejects.toThrow(/already approved/i);
    expect(mockFailGate).not.toHaveBeenCalled();
  });

  it("throws if gate not found", async () => {
    mockExecute.mockResolvedValueOnce(execResult([]));
    await expect(rejectApproval(999, "manager@test.com")).rejects.toThrow(/not found or not pending/i);
    expect(mockFailGate).not.toHaveBeenCalled();
  });

  it("propagates DB failure from failGate", async () => {
    mockExecute.mockResolvedValueOnce(execResult([makeGateRow()]));
    mockFailGate.mockRejectedValueOnce(new Error("DB error"));
    await expect(rejectApproval(1, "manager@test.com")).rejects.toThrow("DB error");
  });
});

// ── getApproval ───────────────────────────────────────────────────────────────

describe("getApproval", () => {
  it("returns mapped PendingApproval for found gate", async () => {
    mockExecute.mockResolvedValueOnce(execResult([makeGateRow({ id: 7 })]));
    const result = await getApproval(7);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(7);
    expect(result!.status).toBe("pending");
  });

  it("returns null when gate not found", async () => {
    mockExecute.mockResolvedValueOnce(execResult([]));
    const result = await getApproval(9999);
    expect(result).toBeNull();
  });

  it("maps verified → approved", async () => {
    mockExecute.mockResolvedValueOnce(execResult([makeGateRow({ status: "verified", verified_by: "mgr" })]));
    const result = await getApproval(1);
    expect(result!.status).toBe("approved");
    expect(result!.approvedBy).toBe("mgr");
  });

  it("maps failed → rejected", async () => {
    mockExecute.mockResolvedValueOnce(execResult([makeGateRow({ status: "failed" })]));
    const result = await getApproval(1);
    expect(result!.status).toBe("rejected");
  });
});

// ── listPendingApprovals ──────────────────────────────────────────────────────

describe("listPendingApprovals", () => {
  it("returns all pending gates when no customerProfileId filter", async () => {
    // data query + count query
    mockExecute
      .mockResolvedValueOnce(execResult([makeGateRow({ id: 1 }), makeGateRow({ id: 2 })]))
      .mockResolvedValueOnce(execResult([{ total: 2 }]));
    const result = await listPendingApprovals();
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it("returns filtered results when customerProfileId is provided", async () => {
    mockExecute
      .mockResolvedValueOnce(execResult([makeGateRow({ id: 5 })]))
      .mockResolvedValueOnce(execResult([{ total: 1 }]));
    const result = await listPendingApprovals(10);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.customerProfileId).toBe(10);
  });

  it("propagates DB errors", async () => {
    mockExecute.mockRejectedValueOnce(new Error("DB down"));
    await expect(listPendingApprovals()).rejects.toThrow("DB down");
  });

  // ── Pagination regression guard (P2 remediation) ────────────────────────────
  // These must break if MAX_LIMIT or pagination is removed from listPendingApprovals.

  it("returns pagination metadata — limit, offset, total", async () => {
    mockExecute
      .mockResolvedValueOnce(execResult([makeGateRow({ id: 1 })]))
      .mockResolvedValueOnce(execResult([{ total: 5 }]));
    const result = await listPendingApprovals(undefined, { limit: 1, offset: 0 });
    expect(result).toHaveProperty("limit");
    expect(result).toHaveProperty("offset");
    expect(result).toHaveProperty("total");
    expect(result.total).toBe(5);
  });

  it("clamps limit to MAX of 100 — unbounded queries are never allowed", async () => {
    mockExecute
      .mockResolvedValueOnce(execResult([]))
      .mockResolvedValueOnce(execResult([{ total: 0 }]));
    const result = await listPendingApprovals(undefined, { limit: 99999 });
    expect(result.limit).toBe(100);
  });

  it("clamps limit to minimum of 1", async () => {
    mockExecute
      .mockResolvedValueOnce(execResult([]))
      .mockResolvedValueOnce(execResult([{ total: 0 }]));
    const result = await listPendingApprovals(undefined, { limit: 0 });
    expect(result.limit).toBe(1);
  });

  it("defaults limit to 50 when not specified", async () => {
    mockExecute
      .mockResolvedValueOnce(execResult([]))
      .mockResolvedValueOnce(execResult([{ total: 0 }]));
    const result = await listPendingApprovals();
    expect(result.limit).toBe(50);
  });

  it("clamps negative offset to 0", async () => {
    mockExecute
      .mockResolvedValueOnce(execResult([]))
      .mockResolvedValueOnce(execResult([{ total: 0 }]));
    const result = await listPendingApprovals(undefined, { offset: -10 });
    expect(result.offset).toBe(0);
  });
});
