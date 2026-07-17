/**
 * vendorPortfolioService.test.ts — Team 22 unit tests
 *
 * DOMAIN MAPPING REVIEW — Team 23 Audit Remediation
 * Status: BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING
 *
 * All functions in vendorPortfolioService are stubs that throw
 * VendorCanonicalMappingBlockedError. Tests verify:
 *   - Each stub throws with the correct error code
 *   - Error message references the canonical source (ai_service_portfolios)
 *   - Error.name is VendorCanonicalMappingBlockedError
 *
 * Canonical source: ai_service_portfolios
 * Architecture review required before implementation.
 */
import { describe, it, expect } from "vitest";
import {
  listVendorPortfolioPublic,
  listVendorPortfolioAdmin,
  addPortfolioItem,
  approvePortfolioItem,
  rejectPortfolioItem,
  VendorCanonicalMappingBlockedError,
} from "../vendorPortfolioService.js";

describe("vendorPortfolioService — BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING", () => {
  it("listVendorPortfolioPublic throws VendorCanonicalMappingBlockedError", async () => {
    await expect(listVendorPortfolioPublic(1)).rejects.toThrow(
      VendorCanonicalMappingBlockedError,
    );
  });

  it("listVendorPortfolioAdmin throws VendorCanonicalMappingBlockedError", async () => {
    await expect(listVendorPortfolioAdmin(1)).rejects.toThrow(
      VendorCanonicalMappingBlockedError,
    );
  });

  it("addPortfolioItem throws VendorCanonicalMappingBlockedError", async () => {
    await expect(addPortfolioItem(1, {})).rejects.toThrow(
      VendorCanonicalMappingBlockedError,
    );
  });

  it("approvePortfolioItem throws VendorCanonicalMappingBlockedError", async () => {
    await expect(approvePortfolioItem(1, 99)).rejects.toThrow(
      VendorCanonicalMappingBlockedError,
    );
  });

  it("rejectPortfolioItem throws VendorCanonicalMappingBlockedError", async () => {
    await expect(rejectPortfolioItem(1, 99, "quality")).rejects.toThrow(
      VendorCanonicalMappingBlockedError,
    );
  });

  it("error carries code BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING", async () => {
    try {
      await listVendorPortfolioPublic(1);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e instanceof VendorCanonicalMappingBlockedError).toBe(true);
      if (e instanceof VendorCanonicalMappingBlockedError) {
        expect(e.code).toBe("BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING");
        expect(e.domain).toBe("portfolio");
        expect(e.canonicalSource).toBe("ai_service_portfolios");
      }
    }
  });

  it("error message references ai_service_portfolios as canonical source", async () => {
    try {
      await listVendorPortfolioPublic(1);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e instanceof Error).toBe(true);
      expect((e as Error).message).toMatch(/ai_service_portfolios/);
    }
  });

  it("error name is VendorCanonicalMappingBlockedError", async () => {
    try {
      await listVendorPortfolioPublic(1);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as Error).name).toBe("VendorCanonicalMappingBlockedError");
    }
  });
});
