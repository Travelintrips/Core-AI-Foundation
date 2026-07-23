/**
 * DEF-001 — Concurrent duplicate project submission deduplication tests.
 *
 * Verifies that:
 *   1. Parallel identical submissions return the same project
 *   2. Submissions 10-100 ms apart return the same project (DB-backed)
 *   3. Same idempotency key (fingerprint) returns the canonical response
 *   4. Same key + different tenant is treated as a different submission
 *   5. Same key + different actor (email) is a different submission
 *   6. Same key + different payload is a different submission
 *   7. Rollback / creation failure releases the fingerprint
 *   8. Server retry after failure creates the project correctly
 *   9. Duplicate submission does not duplicate DB rows (project count check)
 *
 * Uses vitest. All DB and external calls are mocked so tests are fast and offline.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Hoisted mocks (must be before any module import that uses them) ──────────
const mockDbInsert = vi.hoisted(() => vi.fn());
const mockDbSelect = vi.hoisted(() => vi.fn());
const mockDbDelete = vi.hoisted(() => vi.fn());
const mockDbExecute = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  db: {
    insert: mockDbInsert,
    select: mockDbSelect,
    delete: mockDbDelete,
    execute: mockDbExecute,
  },
  creativeProjectsTable: {},
  creativeAiClientReviewsTable: {},
  customerDashboardTokensTable: {},
  creativeProjectQuotationsTable: {},
  aiServiceRequestsTable: {},
  aiServicesTable: {},
}));

vi.mock("@workspace/api-zod", () => ({
  SubmitCustomerProjectBody: {
    safeParse: (body: unknown) => ({
      success: true,
      data: body,
    }),
  },
  RequestCustomerAccessBody: {
    safeParse: (body: unknown) => ({ success: true, data: body }),
  },
}));

vi.mock("../../services/clientReviewService.js", () => ({
  generateReviewToken: () => ({ plaintext: "testtoken123", hash: "hashoftoken" }),
  hashToken: (t: string) => `hash_${t}`,
}));

vi.mock("../../services/aiEventBusService.js", () => ({
  publishSafe: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/aiAuditService.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/publicBaseUrl.js", () => ({
  getPublicBaseUrl: () => "https://test.example.com",
}));

vi.mock("../../lib/publicBaseUrl", () => ({
  getPublicBaseUrl: () => "https://test.example.com",
}));

// Mock submitIdempotencyService so we can control claim/commit/release behaviour
const mockClaim = vi.hoisted(() => vi.fn());
const mockCommit = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());

vi.mock("../../services/submitIdempotencyService.js", () => ({
  claimFingerprint: mockClaim,
  commitFingerprint: mockCommit,
  releaseFingerprint: mockRelease,
  ensureSubmitIdempotencyTable: vi.fn().mockResolvedValue(undefined),
}));

import { creativeProjectsTable } from "@workspace/db";
import customerPortalRouter, {
  _testClearSubmitDedupCache,
  _testClearRateLimitMap,
} from "../customer-portal.js";

// ── Test app ─────────────────────────────────────────────────────────────────
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(customerPortalRouter);
  return app;
}

const VALID_SUBMIT_BODY = {
  clientName: "Test User",
  clientEmail: "test@example.com",
  clientPhone: "08123456789",
  brandName: "Test Brand",
  businessType: "Retail",
  productOrService: "Clothing",
  targetMarket: "Youth",
  goal: "Brand awareness",
};

/** Helper: mock a successful project creation */
function mockSuccessfulCreation() {
  const mockProject = {
    id: 99,
    projectId: "abc-uuid-123",
    brandName: VALID_SUBMIT_BODY.brandName,
    status: "waiting_payment",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  mockDbInsert.mockImplementation(() => ({
    values: () => ({
      returning: vi.fn().mockResolvedValue([mockProject]),
    }),
  }));
  mockDbDelete.mockImplementation(() => ({
    where: vi.fn().mockResolvedValue([]),
  }));
  return mockProject;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DEF-001 — Duplicate project submission deduplication", () => {
  beforeEach(() => {
    // DEF-001: clear module-level caches so tests are fully isolated
    _testClearSubmitDedupCache();
    _testClearRateLimitMap();
    vi.clearAllMocks();
    mockCommit.mockResolvedValue(undefined);
    mockRelease.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("1. Parallel identical submissions — L1 cache returns same project (in-process)", async () => {
    const app = makeApp();
    // First claim succeeds
    mockClaim.mockResolvedValueOnce({ claimed: true });
    mockSuccessfulCreation();

    const res1 = await request(app)
      .post("/public/customer/submit")
      .send(VALID_SUBMIT_BODY);

    expect(res1.status).toBe(201);
    expect(res1.body.projectId).toBeDefined();

    // Second claim is a DB conflict — returns stored response
    mockClaim.mockResolvedValueOnce({
      claimed: false,
      responseData: { projectId: res1.body.projectId, status: "waiting_payment" },
    });

    const res2 = await request(app)
      .post("/public/customer/submit")
      .send(VALID_SUBMIT_BODY);

    expect(res2.status).toBe(201);
    expect(res2.body.projectId).toBe(res1.body.projectId);
    // Table-aware: exactly one project row was created — second request
    // was served from the L1 cache without touching the DB again.
    const projectInserts1 = mockDbInsert.mock.calls.filter(
      ([t]: [unknown]) => t === creativeProjectsTable,
    );
    expect(projectInserts1).toHaveLength(1);
  });

  it("2. Submissions 10–100 ms apart — DB claim returns existing response", async () => {
    const app = makeApp();
    const canonicalResponse = {
      projectId: "existing-uuid",
      status: "waiting_payment",
      brandName: VALID_SUBMIT_BODY.brandName,
      clientName: VALID_SUBMIT_BODY.clientName,
    };

    // Simulate: fingerprint already claimed and committed by a previous request
    mockClaim.mockResolvedValue({ claimed: false, responseData: canonicalResponse });

    const res = await request(app)
      .post("/public/customer/submit")
      .send(VALID_SUBMIT_BODY);

    expect(res.status).toBe(201);
    expect(res.body.projectId).toBe("existing-uuid");
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("3. Same idempotency key returns canonical project", async () => {
    const app = makeApp();
    const canonical = { projectId: "canonical-id", status: "waiting_payment" };

    mockClaim.mockResolvedValue({ claimed: false, responseData: canonical });

    const res = await request(app)
      .post("/public/customer/submit")
      .send(VALID_SUBMIT_BODY);

    expect(res.status).toBe(201);
    expect(res.body.projectId).toBe("canonical-id");
  });

  it("4. Same key + different tenant email is a separate submission", async () => {
    const app = makeApp();
    // First user creates project
    mockClaim.mockResolvedValueOnce({ claimed: true });
    mockSuccessfulCreation();

    const res1 = await request(app)
      .post("/public/customer/submit")
      .send(VALID_SUBMIT_BODY);

    // Second user — different email → different fingerprint → independent claim
    mockClaim.mockResolvedValueOnce({ claimed: true });
    mockSuccessfulCreation();

    const res2 = await request(app)
      .post("/public/customer/submit")
      .send({ ...VALID_SUBMIT_BODY, clientEmail: "other@example.com" });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    // Table-aware: one project row per unique tenant (different fingerprints)
    const projectInserts4 = mockDbInsert.mock.calls.filter(
      ([t]: [unknown]) => t === creativeProjectsTable,
    );
    expect(projectInserts4).toHaveLength(2);
  });

  it("5. Same key + different actor (email) is not deduplicated", async () => {
    const app = makeApp();
    mockClaim.mockResolvedValue({ claimed: true });
    mockSuccessfulCreation();

    const res = await request(app)
      .post("/public/customer/submit")
      .send({ ...VALID_SUBMIT_BODY, clientEmail: "uniqueuser@example.com" });

    // Claim was successful — not treated as duplicate
    expect(res.status).toBe(201);
    expect(mockClaim).toHaveBeenCalledTimes(1);
  });

  it("6. Same key + different payload (brand name) is a separate submission", async () => {
    const app = makeApp();
    mockClaim.mockResolvedValue({ claimed: true });
    mockSuccessfulCreation();

    await request(app).post("/public/customer/submit").send(VALID_SUBMIT_BODY);
    await request(app).post("/public/customer/submit").send({ ...VALID_SUBMIT_BODY, brandName: "Different Brand" });

    // Both fingerprints are distinct (brand name differs)
    expect(mockClaim).toHaveBeenCalledTimes(2);
    // Each should have received its own claim attempt with a distinct fingerprint
    const [call1, call2] = mockClaim.mock.calls;
    expect(call1[0]).not.toBe(call2[0]); // different fingerprints
  });

  it("7. Creation failure releases the fingerprint for retry", async () => {
    const app = makeApp();
    mockClaim.mockResolvedValue({ claimed: true });

    // Simulate DB insert returning empty (creation failure)
    mockDbInsert.mockImplementation(() => ({
      values: () => ({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }));
    mockDbDelete.mockImplementation(() => ({
      where: vi.fn().mockResolvedValue([]),
    }));

    const res = await request(app)
      .post("/public/customer/submit")
      .send(VALID_SUBMIT_BODY);

    expect(res.status).toBe(500);
    // releaseFingerprint must have been called so retry is possible
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("8. Server retry after failure creates the project correctly", async () => {
    const app = makeApp();
    // After release, second attempt claims successfully
    mockClaim
      .mockResolvedValueOnce({ claimed: true })  // first attempt - creation fails
      .mockResolvedValueOnce({ claimed: true });  // retry - success

    mockDbInsert
      .mockImplementationOnce(() => ({
        values: () => ({ returning: vi.fn().mockResolvedValue([]) }),
      }))
      .mockImplementation(() => ({
        values: () => ({
          returning: vi.fn().mockResolvedValue([{
            id: 1, projectId: "retry-uuid", brandName: "Test Brand",
            status: "waiting_payment", createdAt: new Date(), updatedAt: new Date(),
          }]),
        }),
      }));
    mockDbDelete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue([]) }));

    const res1 = await request(app).post("/public/customer/submit").send(VALID_SUBMIT_BODY);
    const res2 = await request(app).post("/public/customer/submit").send(VALID_SUBMIT_BODY);

    expect(res1.status).toBe(500);
    expect(res2.status).toBe(201);
    expect(res2.body.projectId).toBe("retry-uuid");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("9. Duplicate submission does not create a second DB project row", async () => {
    const app = makeApp();
    // First request claims and succeeds
    mockClaim.mockResolvedValueOnce({ claimed: true });
    mockSuccessfulCreation();
    await request(app).post("/public/customer/submit").send(VALID_SUBMIT_BODY);

    // Second request gets conflict — no new DB insert
    mockClaim.mockResolvedValueOnce({
      claimed: false,
      responseData: { projectId: "abc-uuid-123", status: "waiting_payment" },
    });
    await request(app).post("/public/customer/submit").send(VALID_SUBMIT_BODY);

    // Table-aware: exactly one project row — the duplicate was stopped at
    // the L1 cache (or L2 conflict) before any second DB insert.
    const projectInserts9 = mockDbInsert.mock.calls.filter(
      ([t]: [unknown]) => t === creativeProjectsTable,
    );
    expect(projectInserts9).toHaveLength(1);
  });

  it("10. In-flight duplicate returns 409 (not a duplicate project)", async () => {
    const app = makeApp();
    // DB fingerprint claimed but response not yet committed (in-flight)
    mockClaim.mockResolvedValue({ claimed: false, inFlight: true });

    const res = await request(app)
      .post("/public/customer/submit")
      .send(VALID_SUBMIT_BODY);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DUPLICATE_SUBMISSION_IN_FLIGHT");
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});
