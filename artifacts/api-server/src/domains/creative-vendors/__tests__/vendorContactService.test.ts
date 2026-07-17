/**
 * vendorContactService.test.ts — Team 22 unit tests
 *
 * DOMAIN MAPPING REVIEW — Team 23 Audit Remediation
 * Status: BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING
 *
 * All functions in vendorContactService are stubs that throw
 * VendorContactBlockedError. Tests verify:
 *   - Each stub throws with the correct error code
 *   - Error message references the canonical options
 *   - Error.name is VendorContactBlockedError
 *
 * Pending canonical source: ai_quotations extension, ai_vendor_inquiries
 *   new table, or quotation+discriminator pattern.
 * Architecture review required before implementation.
 */
import { describe, it, expect } from "vitest";
import {
  submitContactRequest,
  getMyContactRequests,
  listContactRequestsAdmin,
  updateContactRequestStatus,
  VendorContactBlockedError,
} from "../vendorContactService.js";

describe("vendorContactService — BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING", () => {
  it("submitContactRequest throws VendorContactBlockedError", async () => {
    await expect(submitContactRequest(1, {})).rejects.toThrow(VendorContactBlockedError);
  });

  it("getMyContactRequests throws VendorContactBlockedError", async () => {
    await expect(getMyContactRequests("hashedEmail")).rejects.toThrow(VendorContactBlockedError);
  });

  it("listContactRequestsAdmin throws VendorContactBlockedError", async () => {
    await expect(listContactRequestsAdmin()).rejects.toThrow(VendorContactBlockedError);
  });

  it("updateContactRequestStatus throws VendorContactBlockedError", async () => {
    await expect(updateContactRequestStatus(1, "accepted")).rejects.toThrow(
      VendorContactBlockedError,
    );
  });

  it("error carries code BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING", async () => {
    try {
      await submitContactRequest(1, {});
      expect.fail("should have thrown");
    } catch (e) {
      expect(e instanceof VendorContactBlockedError).toBe(true);
      if (e instanceof VendorContactBlockedError) {
        expect(e.code).toBe("BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING");
        expect(e.domain).toBe("contact_requests");
        // Must list at least two architecture options
        expect(e.options.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("error message references canonical options (ai_quotations / ai_vendor_inquiries)", async () => {
    try {
      await submitContactRequest(1, {});
      expect.fail("should have thrown");
    } catch (e) {
      expect(e instanceof Error).toBe(true);
      const msg = (e as Error).message;
      expect(msg).toMatch(/ai_quotations/);
      expect(msg).toMatch(/ai_vendor_inquiries/);
    }
  });

  it("error name is VendorContactBlockedError", async () => {
    try {
      await submitContactRequest(1, {});
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as Error).name).toBe("VendorContactBlockedError");
    }
  });
});
