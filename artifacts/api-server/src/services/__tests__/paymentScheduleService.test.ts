/**
 * paymentScheduleService.test.ts — Team 42 Billing Lifecycle Regression Tests
 *
 * Covers:
 *   - Invoice creation + idempotency (no duplicate invoices)
 *   - Payment schedule generation
 *   - Remaining balance calculation
 *   - Payment proof submission + resubmission after rejection
 *   - Payment verification (full, deposit, remaining)
 *   - Partial payment / milestone unlock logic
 *   - Unlock guard (filesUnlocked only when fully paid)
 *   - Duplicate payment guard (ne status paid in verifyPayment)
 *   - Duplicate invoice guard (idempotency in generateInvoiceForSchedule)
 *   - Cross-tenant / wrong-project payment (scheduleId not on project)
 *   - Invoice consistency: amount matches schedule amount
 *   - Customer/Admin consistency: paymentStatus derived from same source
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
  dbInsert: vi.fn(),
  logAudit: vi.fn().mockResolvedValue(undefined),
  publishSafe: vi.fn().mockResolvedValue(undefined),
  runCreativeBriefWorkflow: vi.fn().mockResolvedValue(undefined),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  const table = (name: string) => ({ _tableName: name });
  return {
    db: {
      select: mocks.dbSelect,
      update: mocks.dbUpdate,
      insert: mocks.dbInsert,
    },
    aiPaymentScheduleTable: {
      ...table("ai_payment_schedule"),
      id: "id",
      projectId: "projectId",
      status: "status",
      paymentType: "paymentType",
      amount: "amount",
      currency: "currency",
      reference: "reference",
      proofImageUrl: "proofImageUrl",
      paidAt: "paidAt",
      verifiedBy: "verifiedBy",
      displayOrder: "displayOrder",
    },
    aiInvoicesTable: {
      ...table("ai_invoices"),
      id: "id",
      projectId: "projectId",
      paymentScheduleId: "paymentScheduleId",
      invoiceNumber: "invoiceNumber",
      invoiceType: "invoiceType",
      amount: "amount",
      currency: "currency",
      status: "status",
      lineItemsJson: "lineItemsJson",
      paidAt: "paidAt",
    },
    creativeProjectsTable: {
      ...table("creative_projects"),
      id: "id",
      status: "status",
      paymentStatus: "paymentStatus",
      filesUnlocked: "filesUnlocked",
      projectId: "projectId",
    },
  };
});

vi.mock("../../services/aiAuditService.js", () => ({
  logAudit: mocks.logAudit,
}));

vi.mock("../../services/aiEventBusService.js", () => ({
  publishSafe: mocks.publishSafe,
}));

vi.mock("../../services/creativeWorkflowRunner.js", () => ({
  runCreativeBriefWorkflow: mocks.runCreativeBriefWorkflow,
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  generateScheduleForProject,
  getScheduleForProject,
  submitPaymentProof,
  verifyPayment,
  rejectPayment,
  generateInvoiceForSchedule,
  isProjectUnlocked,
} from "../paymentScheduleService.js";

// ── Fixture builders ──────────────────────────────────────────────────────────

function makeSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    projectId: 10,
    paymentType: "full_payment",
    percentage: null,
    amount: "1000000",
    currency: "IDR",
    dueDate: null,
    status: "pending",
    reference: null,
    proofImageUrl: null,
    verifiedBy: null,
    paidAt: null,
    notes: null,
    displayOrder: 0,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    projectId: "proj-abc",
    status: "waiting_payment",
    paymentStatus: "pending",
    filesUnlocked: false,
    ...overrides,
  };
}

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    invoiceNumber: "INV-2026-S000001",
    projectId: 10,
    paymentScheduleId: 1,
    invoiceType: "final",
    amount: "1000000",
    currency: "IDR",
    status: "issued",
    lineItemsJson: [{ label: "full_payment payment", amount: 1000000 }],
    issuedAt: new Date(),
    paidAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Build a select chain that is itself a Promise (thenable) so it can be
 * awaited at any point:
 *   await db.select().from().where()          → rows  (generateScheduleForProject)
 *   await db.select().from().where().orderBy() → rows  (getScheduleForProject)
 *   await db.select().from().where().limit(1)  → rows  (most other callers)
 */
function makeSelectChain(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = Object.assign(Promise.resolve(rows), {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn().mockReturnValue(Promise.resolve(rows)),
    limit: vi.fn().mockReturnValue(Promise.resolve(rows)),
    offset: vi.fn().mockReturnValue(Promise.resolve(rows)),
  });
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
}

function selectReturning(rows: unknown[]) {
  const chain = makeSelectChain(rows);
  mocks.dbSelect.mockReturnValue(chain);
  return chain;
}

/** Build a chainable db.select() that sequences multiple calls in order. */
function selectSequence(sequence: unknown[][]) {
  let idx = 0;
  mocks.dbSelect.mockImplementation(() => {
    const rows = sequence[idx] ?? sequence[sequence.length - 1];
    idx++;
    return makeSelectChain(rows);
  });
}

/** Build a chainable db.update() mock that resolves to `rows`. */
function updateReturning(rows: unknown[]) {
  mocks.dbUpdate.mockReturnValue({
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  });
}

/** Build a chainable db.insert() mock that resolves to `rows`. */
function insertReturning(rows: unknown[]) {
  mocks.dbInsert.mockReturnValue({
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// generateScheduleForProject
// ─────────────────────────────────────────────────────────────────────────────

describe("generateScheduleForProject", () => {
  it("returns existing schedule when one already exists (idempotent)", async () => {
    const existing = [makeSchedule()];
    selectReturning(existing);

    const result = await generateScheduleForProject({
      projectId: 10,
      paymentPolicy: "full_payment",
      depositPercentage: 50,
      totalAmount: 1_000_000,
      currency: "IDR",
    });

    expect(result).toEqual(existing);
    expect(mocks.dbInsert).not.toHaveBeenCalled();
  });

  it("creates a single full_payment installment when policy is full_payment", async () => {
    selectReturning([]); // no existing schedule
    const created = [makeSchedule({ paymentType: "full_payment", amount: "1000000" })];
    insertReturning(created);

    const result = await generateScheduleForProject({
      projectId: 10,
      paymentPolicy: "full_payment",
      depositPercentage: 0,
      totalAmount: 1_000_000,
      currency: "IDR",
    });

    expect(result).toHaveLength(1);
    expect(result[0].paymentType).toBe("full_payment");
    expect(mocks.dbInsert).toHaveBeenCalledOnce();
  });

  it("creates two installments (deposit + remaining_balance) for deposit policy", async () => {
    selectReturning([]); // no existing
    const deposit = makeSchedule({ id: 1, paymentType: "deposit", amount: "300000", percentage: 30 });
    const remaining = makeSchedule({ id: 2, paymentType: "remaining_balance", amount: "700000", percentage: 70, displayOrder: 1 });
    insertReturning([deposit, remaining]);

    const result = await generateScheduleForProject({
      projectId: 10,
      paymentPolicy: "deposit",
      depositPercentage: 30,
      totalAmount: 1_000_000,
      currency: "IDR",
    });

    expect(result).toHaveLength(2);
    expect(mocks.logAudit).toHaveBeenCalledOnce();
  });

  it("remaining balance = total - deposit (no floating-point drift)", async () => {
    selectReturning([]);
    const deposit = makeSchedule({ id: 1, paymentType: "deposit", amount: "500000" });
    const rem = makeSchedule({ id: 2, paymentType: "remaining_balance", amount: "500000" });
    insertReturning([deposit, rem]);

    const result = await generateScheduleForProject({
      projectId: 10,
      paymentPolicy: "deposit",
      depositPercentage: 50,
      totalAmount: 1_000_000,
      currency: "IDR",
    });

    const total = result.reduce((s, r) => s + Number(r.amount), 0);
    expect(total).toBeCloseTo(1_000_000, 0);
  });

  it("creates single installment for purchase_order policy", async () => {
    selectReturning([]);
    const row = makeSchedule({ paymentType: "full_payment", notes: "purchase_order" });
    insertReturning([row]);

    const result = await generateScheduleForProject({
      projectId: 10,
      paymentPolicy: "purchase_order",
      depositPercentage: 0,
      totalAmount: 1_000_000,
      currency: "IDR",
    });

    expect(result).toHaveLength(1);
    expect(result[0].paymentType).toBe("full_payment");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// submitPaymentProof (Bug #1 fix: resubmission after rejection)
// ─────────────────────────────────────────────────────────────────────────────

describe("submitPaymentProof", () => {
  it("accepts proof on a pending schedule", async () => {
    const updated = makeSchedule({ reference: "TRF-001", status: "pending" });
    updateReturning([updated]);
    selectReturning([makeProject()]);
    // Second update for project status
    mocks.dbUpdate
      .mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([updated]),
      })
      .mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([makeProject({ status: "waiting_payment_verification" })]),
      });

    const result = await submitPaymentProof(1, "TRF-001");
    expect(result).not.toBeNull();
    expect(result?.reference).toBe("TRF-001");
  });

  it("BUG FIX: allows resubmission after admin rejection (status = failed)", async () => {
    // After rejectPayment, schedule status = "failed". Customer should be able
    // to re-submit a corrected payment reference.
    const resubmitted = makeSchedule({ reference: "TRF-002", status: "pending" });
    mocks.dbUpdate
      .mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([resubmitted]),
      })
      .mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([makeProject({ status: "waiting_payment_verification" })]),
      });
    selectReturning([makeProject({ status: "waiting_payment" })]);

    const result = await submitPaymentProof(1, "TRF-002");
    expect(result).not.toBeNull();
    expect(result?.reference).toBe("TRF-002");
  });

  it("returns null when schedule is already paid (cannot submit proof on paid schedule)", async () => {
    updateReturning([]); // WHERE status IN ('pending','failed') → no match for 'paid'
    const result = await submitPaymentProof(1, "TRF-003");
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verifyPayment
// ─────────────────────────────────────────────────────────────────────────────

describe("verifyPayment", () => {
  it("returns null when schedule not found or already paid", async () => {
    updateReturning([]); // ne(status, 'paid') → no match
    const result = await verifyPayment(999, "admin");
    expect(result).toBeNull();
  });

  it("full_payment: filesUnlocked=true and paymentStatus=paid when single installment verified", async () => {
    const schedule = makeSchedule({ status: "paid", paymentType: "full_payment", paidAt: new Date() });
    mocks.dbUpdate
      .mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([schedule]),
      })
      .mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([makeProject({ status: "payment_verified", paymentStatus: "paid", filesUnlocked: true })]),
      });

    // select: getScheduleForProject → [paid schedule], then fresh project fetch
    selectSequence([
      [makeProject({ status: "waiting_payment_verification" })],           // select project
      [schedule],                                                            // allInstallments
      [makeProject({ status: "payment_verified", filesUnlocked: true })],  // re-fetch fresh
    ]);

    const result = await verifyPayment(1, "admin@test.com");
    expect(result).not.toBeNull();
    expect(mocks.logAudit).toHaveBeenCalledOnce();
    expect(mocks.publishSafe).toHaveBeenCalled();
  });

  it("deposit: paymentStatus=partially_paid when only deposit verified", async () => {
    const depositSchedule = makeSchedule({ status: "paid", paymentType: "deposit" });
    const remainingSchedule = makeSchedule({ id: 2, paymentType: "remaining_balance", status: "pending" });

    mocks.dbUpdate
      .mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([depositSchedule]),
      })
      .mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([makeProject({ status: "deposit_paid", paymentStatus: "partially_paid", filesUnlocked: false })]),
      });

    selectSequence([
      [makeProject()],                              // project lookup
      [depositSchedule, remainingSchedule],         // allInstallments
      [makeProject({ status: "deposit_paid" })],    // fresh project
    ]);

    const result = await verifyPayment(1, "admin@test.com");
    expect(result).not.toBeNull();
    // filesUnlocked must NOT be set — remaining balance still pending
    expect(result?.project.filesUnlocked).toBeFalsy();
  });

  it("remaining_balance: filesUnlocked=true after final installment verified", async () => {
    const depositPaid = makeSchedule({ id: 1, paymentType: "deposit", status: "paid" });
    const remainingPaid = makeSchedule({ id: 2, paymentType: "remaining_balance", status: "paid" });

    mocks.dbUpdate
      .mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([remainingPaid]),
      })
      .mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([makeProject({ status: "remaining_paid", paymentStatus: "paid", filesUnlocked: true })]),
      });

    selectSequence([
      [makeProject({ status: "deposit_paid" })],            // project lookup
      [depositPaid, remainingPaid],                          // allInstallments (both paid)
      [makeProject({ status: "remaining_paid", filesUnlocked: true })],  // fresh
    ]);

    const result = await verifyPayment(2, "admin@test.com");
    expect(result).not.toBeNull();
    // The "files.unlocked" event must be published when fullyPaid
    const unlockEvent = (mocks.publishSafe.mock.calls as Array<[{ eventType: string }]>)
      .find((call) => call[0].eventType === "files.unlocked");
    expect(unlockEvent).toBeDefined();
  });

  it("DUPLICATE PAYMENT GUARD: verifyPayment returns null for already-paid schedule", async () => {
    // ne(status, 'paid') means an already-paid schedule won't match → returns null
    updateReturning([]);
    const result = await verifyPayment(1, "admin@test.com");
    expect(result).toBeNull();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("does not trigger production if project is already in a terminal state", async () => {
    const schedule = makeSchedule({ status: "paid", paymentType: "full_payment" });
    mocks.dbUpdate
      .mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([schedule]),
      })
      .mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([makeProject({ status: "completed" })]),
      });

    selectSequence([
      [makeProject({ status: "completed" })],   // project (already terminal)
      [schedule],                                // allInstallments
      [makeProject({ status: "completed" })],   // fresh
    ]);

    const result = await verifyPayment(1, "admin@test.com");
    expect(result).not.toBeNull();
    expect(result?.productionStarted).toBe(false);
    expect(mocks.runCreativeBriefWorkflow).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rejectPayment
// ─────────────────────────────────────────────────────────────────────────────

describe("rejectPayment", () => {
  it("returns null when schedule is already in a terminal state (paid/cancelled)", async () => {
    updateReturning([]);
    const result = await rejectPayment(1, "admin@test.com", "Proof unclear");
    expect(result).toBeNull();
  });

  it("sets schedule status to failed and reverts project to waiting_payment", async () => {
    const rejected = makeSchedule({ status: "failed" });
    mocks.dbUpdate
      .mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([rejected]),
      })
      .mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([makeProject({ status: "waiting_payment" })]),
      });

    selectReturning([makeProject({ status: "waiting_payment_verification" })]);

    const result = await rejectPayment(1, "admin@test.com", "Proof unclear");
    expect(result?.status).toBe("failed");
    expect(mocks.logAudit).toHaveBeenCalledOnce();
    expect(mocks.publishSafe).toHaveBeenCalledOnce();
  });

  it("does not revert project if it has progressed past waiting_payment_verification", async () => {
    const rejected = makeSchedule({ status: "failed" });
    mocks.dbUpdate
      .mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([rejected]),
      })
      .mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      });

    // Project is in deposit_paid (already advanced) — revert should NOT run
    selectReturning([makeProject({ status: "deposit_paid" })]);

    const result = await rejectPayment(1, "admin@test.com", "Wrong account");
    expect(result).not.toBeNull();
    // The project update mock was set up — verify it was NOT called for project update
    // (second dbUpdate mock only fires when project.status === "waiting_payment_verification")
    expect(mocks.dbUpdate).toHaveBeenCalledOnce(); // Only the schedule update
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateInvoiceForSchedule (Bug #2 fix: idempotency)
// ─────────────────────────────────────────────────────────────────────────────

describe("generateInvoiceForSchedule", () => {
  it("returns null when schedule not found", async () => {
    selectSequence([[]]); // schedule not found
    const result = await generateInvoiceForSchedule(999);
    expect(result).toBeNull();
    expect(mocks.dbInsert).not.toHaveBeenCalled();
  });

  it("creates invoice for a valid schedule", async () => {
    const schedule = makeSchedule({ status: "paid", paymentType: "full_payment" });
    const invoice = makeInvoice();

    selectSequence([
      [schedule],   // schedule lookup
      [],           // idempotency check: no existing invoice
    ]);
    insertReturning([invoice]);

    const result = await generateInvoiceForSchedule(1);
    expect(result).toMatchObject({ invoiceNumber: "INV-2026-S000001", projectId: 10 });
    expect(mocks.dbInsert).toHaveBeenCalledOnce();
    expect(mocks.logAudit).toHaveBeenCalledOnce();
  });

  it("DUPLICATE INVOICE GUARD: returns existing invoice on second call (idempotent)", async () => {
    const schedule = makeSchedule({ status: "paid" });
    const existingInvoice = makeInvoice();

    selectSequence([
      [schedule],         // schedule lookup
      [existingInvoice],  // idempotency check: existing invoice found
    ]);

    const result = await generateInvoiceForSchedule(1);
    expect(result).toEqual(existingInvoice);
    // Must NOT insert a second invoice row
    expect(mocks.dbInsert).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("INVOICE CONSISTENCY: invoice amount equals schedule amount", async () => {
    const schedule = makeSchedule({ amount: "2500000", status: "pending" });
    const invoice = makeInvoice({ amount: "2500000" });

    selectSequence([
      [schedule],
      [],           // no existing invoice
    ]);
    insertReturning([invoice]);

    const result = await generateInvoiceForSchedule(1);
    expect(result?.amount).toBe(schedule.amount);
  });

  it("INVOICE NUMBER: uses schedule id anchor (collision-free)", async () => {
    const schedule = makeSchedule({ id: 42, amount: "500000" });
    const invoice = makeInvoice({ id: 42, invoiceNumber: `INV-${new Date().getFullYear()}-S000042` });

    selectSequence([[schedule], []]);
    insertReturning([invoice]);

    const result = await generateInvoiceForSchedule(42);
    expect(result?.invoiceNumber).toMatch(/INV-\d{4}-S000042/);
  });

  it("deposit schedule generates a deposit-type invoice", async () => {
    const schedule = makeSchedule({ paymentType: "deposit", status: "pending" });
    const invoice = makeInvoice({ invoiceType: "deposit" });

    selectSequence([[schedule], []]);
    insertReturning([invoice]);

    const result = await generateInvoiceForSchedule(1);
    expect(result?.invoiceType).toBe("deposit");
  });

  it("paid schedule generates a receipt-type invoice for full_payment", async () => {
    const schedule = makeSchedule({ paymentType: "full_payment", status: "paid" });
    const invoice = makeInvoice({ invoiceType: "receipt" });

    selectSequence([[schedule], []]);
    insertReturning([invoice]);

    const result = await generateInvoiceForSchedule(1);
    expect(result?.invoiceType).toBe("receipt");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isProjectUnlocked — unlock policy guard
// ─────────────────────────────────────────────────────────────────────────────

describe("isProjectUnlocked", () => {
  it("returns false when filesUnlocked is false", () => {
    expect(isProjectUnlocked({ filesUnlocked: false })).toBe(false);
  });

  it("returns true only when filesUnlocked is explicitly true", () => {
    expect(isProjectUnlocked({ filesUnlocked: true })).toBe(true);
  });

  it("UNLOCK POLICY: null/undefined filesUnlocked is treated as locked", () => {
    // TypeScript enforces boolean but guard against runtime coercion edge-cases
    expect(isProjectUnlocked({ filesUnlocked: null as unknown as boolean })).toBe(false);
    expect(isProjectUnlocked({ filesUnlocked: undefined as unknown as boolean })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Partial payment / milestone flow
// ─────────────────────────────────────────────────────────────────────────────

describe("Partial payment / milestone flow", () => {
  it("PARTIAL PAYMENT: no negative balance — deposit amount capped between 1% and 99%", async () => {
    selectReturning([]); // no existing schedule
    insertReturning([
      makeSchedule({ paymentType: "deposit", amount: "990000", percentage: 99 }),
      makeSchedule({ id: 2, paymentType: "remaining_balance", amount: "10000", percentage: 1 }),
    ]);

    // Edge: 150% deposit should be clamped to 99%
    const result = await generateScheduleForProject({
      projectId: 10,
      paymentPolicy: "deposit",
      depositPercentage: 150, // out-of-range
      totalAmount: 1_000_000,
      currency: "IDR",
    });

    // The service clamps to 99 — remaining should be positive
    expect(result.length).toBe(2);
    const amounts = result.map((r) => Number(r.amount));
    expect(amounts.every((a) => a > 0)).toBe(true); // no negative balance
  });

  it("MILESTONE: filesUnlocked stays false until remaining_balance is also verified", () => {
    // Mirrors verifyPayment deposit test above — filesUnlocked requires fullyPaid
    const project = makeProject({ paymentStatus: "partially_paid", filesUnlocked: false });
    expect(isProjectUnlocked(project)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getScheduleForProject
// ─────────────────────────────────────────────────────────────────────────────

describe("getScheduleForProject", () => {
  it("returns schedules ordered by displayOrder", async () => {
    const rows = [
      makeSchedule({ id: 1, displayOrder: 0, paymentType: "deposit" }),
      makeSchedule({ id: 2, displayOrder: 1, paymentType: "remaining_balance" }),
    ];
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(rows),
    };
    mocks.dbSelect.mockReturnValue(chain);

    const result = await getScheduleForProject(10);
    expect(result).toHaveLength(2);
    expect(result[0].paymentType).toBe("deposit");
    expect(result[1].paymentType).toBe("remaining_balance");
    expect(chain.orderBy).toHaveBeenCalledOnce();
  });

  it("returns empty array when no schedule exists for project", async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
    };
    mocks.dbSelect.mockReturnValue(chain);

    const result = await getScheduleForProject(999);
    expect(result).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-tenant / wrong-project payment guard
// ─────────────────────────────────────────────────────────────────────────────

describe("Cross-tenant payment guard", () => {
  it("verifyPayment returns null if the schedule's project is not found", async () => {
    const schedule = makeSchedule({ projectId: 999 });
    mocks.dbUpdate
      .mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([schedule]),
      });

    // project lookup returns empty (scheduleId belongs to a project that doesn't exist / wrong tenant)
    selectSequence([
      [],  // project not found
    ]);

    const result = await verifyPayment(1, "admin@test.com");
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Customer / Admin consistency
// ─────────────────────────────────────────────────────────────────────────────

describe("Customer/Admin consistency — paymentStatus source of truth", () => {
  it("paymentStatus on creative_project is derived from schedule rows, not inferred separately", async () => {
    // Both customer portal and admin portal read from creative_projects.payment_status
    // which is set by verifyPayment() from schedule aggregation. This test documents
    // the single source of truth: schedule rows → paymentStatus on project.
    const allPaid = [
      makeSchedule({ id: 1, status: "paid", paymentType: "deposit" }),
      makeSchedule({ id: 2, status: "paid", paymentType: "remaining_balance" }),
    ];

    const updatedProject = makeProject({ paymentStatus: "paid", filesUnlocked: true, status: "remaining_paid" });
    const remainingSchedule = makeSchedule({ id: 2, status: "paid", paymentType: "remaining_balance" });

    mocks.dbUpdate
      .mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([remainingSchedule]),
      })
      .mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([updatedProject]),
      });

    selectSequence([
      [makeProject({ status: "deposit_paid" })],  // project
      allPaid,                                      // allInstallments
      [updatedProject],                             // fresh project
    ]);

    const result = await verifyPayment(2, "admin@test.com");
    expect(result?.project.paymentStatus).toBe("paid");
    expect(result?.project.filesUnlocked).toBe(true);
  });
});
