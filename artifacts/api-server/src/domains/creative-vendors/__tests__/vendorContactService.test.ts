/**
 * vendorContactService.test.ts — Team 22 unit tests
 *
 * Tests: contact request submission, terminal state guard,
 *        revealed contact on acceptance, rejection guard.
 *
 * Chain resolution strategy:
 *   Queries ending in .where()    → where resolves
 *   Queries ending in .limit()    → limit resolves  (getMyContactRequests)
 *   Mutations ending in .returning() → returning resolves
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockVendorDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../schema.js", () => ({
  vendorDb: mockVendorDb,
  vendorContactRequestsTable: {
    id: "id",
    vendorId: "vendor_id",
    requesterEmailHash: "requester_email_hash",
    status: "status",
    createdAt: "created_at",
  },
  vendorsTable: {
    id: "id",
    moderationStatus: "moderation_status",
    status: "status",
    whatsapp: "whatsapp",
    email: "email",
    websiteUrl: "website_url",
    totalContactRequests: "total_contact_requests",
    updatedAt: "updated_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ __eq: [col, val] })),
  and: vi.fn((...args) => ({ __and: args.filter(Boolean) })),
  desc: vi.fn((col) => ({ __desc: col })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => ({ __sql: strings.raw?.[0] })),
    { join: vi.fn(() => ({})) },
  ),
}));

// ── Chain factories ────────────────────────────────────────────────────────────

/** For queries whose last call is .where() — resolves directly */
function makeWhereChain(result: unknown[]) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockResolvedValue(result);
  return c;
}

/**
 * For getMyContactRequests: .from().innerJoin().where().orderBy().limit()
 * limit is the terminal
 */
function makeLimitChain(result: unknown[]) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.innerJoin = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue(result);
  return c;
}

/** For mutations ending in .returning() */
function makeInsertChain(result: unknown[]) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(result),
    }),
  };
}

/** For updates ending in .where() (fire-and-forget increment) */
function makeUpdateWhereChain() {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.update = vi.fn().mockReturnValue(c);
  c.set = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockResolvedValue([]);
  return c;
}

/** For updates with .returning() */
function makeUpdateReturningChain(result: unknown[]) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.update = vi.fn().mockReturnValue(c);
  c.set = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.returning = vi.fn().mockResolvedValue(result);
  return c;
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const MOCK_VENDOR_APPROVED = {
  id: 10, moderationStatus: "approved", status: "active",
  displayName: "Kreatif Studio", whatsapp: "+6281234567890",
  email: "vendor@example.com", websiteUrl: "https://kreatiifstudio.com",
};

const MOCK_CONTACT_REQUEST = {
  id: 1, vendorId: 10,
  requesterEmailHash: "abc123hash",
  requesterName: "Budi Santoso",
  projectDescription: "Butuh logo untuk toko kopi saya",
  budgetRange: "2jt - 5jt",
  preferredStartDate: "2026-08-01",
  status: "pending",
  vendorResponse: null, respondedAt: null,
  createdAt: new Date(), updatedAt: new Date(),
};

// ─────────────────────────────────────────────────────────────────────────────

describe("submitContactRequest", () => {
  it("creates a contact request for an approved vendor", async () => {
    // 1. select vendor → .where() resolves
    mockVendorDb.select.mockReturnValue(makeWhereChain([MOCK_VENDOR_APPROVED]));
    // 2. insert request → .values().returning() resolves
    mockVendorDb.insert.mockReturnValue(makeInsertChain([MOCK_CONTACT_REQUEST]));
    // 3. update increment → .set().where() resolves
    mockVendorDb.update.mockReturnValue(makeUpdateWhereChain());

    const { submitContactRequest } = await import("../vendorContactService.js");
    const result = await submitContactRequest(10, "abc123hash", {
      requesterName: "Budi Santoso",
      projectDescription: "Butuh logo untuk toko kopi saya",
    });

    expect(result.vendorId).toBe(10);
    expect(result.status).toBe("pending");
  });

  it("throws if vendor not found or not approved", async () => {
    // Empty result → vendor not found
    mockVendorDb.select.mockReturnValue(makeWhereChain([]));

    const { submitContactRequest } = await import("../vendorContactService.js");
    await expect(
      submitContactRequest(999, "abc123hash", { projectDescription: "test" }),
    ).rejects.toThrow("Vendor not found or not available");
  });
});

describe("updateContactRequestStatus — terminal state guard", () => {
  it("rejects updating an already-accepted request", async () => {
    const acceptedRequest = { ...MOCK_CONTACT_REQUEST, status: "accepted" };
    mockVendorDb.select.mockReturnValue(makeWhereChain([acceptedRequest]));

    const { updateContactRequestStatus } = await import("../vendorContactService.js");
    await expect(
      updateContactRequestStatus(1, "accepted"),
    ).rejects.toThrow(/terminal state/);
  });

  it("rejects updating an already-declined request", async () => {
    const declinedRequest = { ...MOCK_CONTACT_REQUEST, status: "declined" };
    mockVendorDb.select.mockReturnValue(makeWhereChain([declinedRequest]));

    const { updateContactRequestStatus } = await import("../vendorContactService.js");
    await expect(
      updateContactRequestStatus(1, "declined"),
    ).rejects.toThrow(/terminal state/);
  });

  it("returns null when contact request not found", async () => {
    mockVendorDb.select.mockReturnValue(makeWhereChain([]));

    const { updateContactRequestStatus } = await import("../vendorContactService.js");
    const result = await updateContactRequestStatus(999, "accepted");
    expect(result).toBeNull();
  });

  it("updates status and returns updated request on valid transition", async () => {
    const pendingRequest = { ...MOCK_CONTACT_REQUEST, status: "pending" };
    const acceptedRequest = { ...pendingRequest, status: "accepted", respondedAt: new Date() };
    // select existing → pending
    mockVendorDb.select.mockReturnValue(makeWhereChain([pendingRequest]));
    // update → returning
    mockVendorDb.update.mockReturnValue(makeUpdateReturningChain([acceptedRequest]));

    const { updateContactRequestStatus } = await import("../vendorContactService.js");
    const result = await updateContactRequestStatus(1, "accepted");
    expect(result?.status).toBe("accepted");
  });
});

describe("getMyContactRequests — revealed contact on acceptance", () => {
  it("reveals full contact info only for accepted requests", async () => {
    const rows = [
      {
        req: { ...MOCK_CONTACT_REQUEST, status: "accepted" },
        whatsapp: "+6281234567890",
        email: "vendor@example.com",
        websiteUrl: "https://kreatiifstudio.com",
      },
      {
        req: { ...MOCK_CONTACT_REQUEST, id: 2, status: "pending" },
        whatsapp: "+6281234567890",
        email: "vendor@example.com",
        websiteUrl: "https://kreatiifstudio.com",
      },
    ];
    // getMyContactRequests: .from().innerJoin().where().orderBy().limit() — limit is terminal
    mockVendorDb.select.mockReturnValue(makeLimitChain(rows));

    const { getMyContactRequests } = await import("../vendorContactService.js");
    const requests = await getMyContactRequests("abc123hash");

    // Accepted → contact revealed
    expect(requests[0]!.revealedContact).not.toBeNull();
    expect(requests[0]!.revealedContact?.whatsapp).toBe("+6281234567890");

    // Pending → contact NOT revealed
    expect(requests[1]!.revealedContact).toBeNull();
  });
});
