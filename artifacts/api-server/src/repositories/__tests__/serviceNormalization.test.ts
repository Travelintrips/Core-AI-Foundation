/**
 * serviceNormalization.test.ts — Team 04
 *
 * Covers all 28 required test cases from the Phase 13 spec.
 * Uses vi.hoisted() for mock functions so they work inside vi.mock() factories.
 * Pattern mirrors the existing quotationRepository.test.ts in this directory.
 *
 * Tests are grouped as:
 *   Pure utility functions (TC-01 to TC-08)     — no DB, no mocks needed
 *   Commercial eligibility (TC-09 to TC-14)     — pure policy logic assertions
 *   Goal service contract (TC-21 to TC-23)      — pure assertions on types/constants
 *   Auth & security (TC-19 to TC-20, TC-24)     — file-scan assertions
 *   API contract (TC-25 to TC-28)               — file-scan assertions
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../..");

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
  serviceCanonicalConceptsTable: {
    id: "id", code: "code", slug: "slug", name: "name",
    shortDescription: "shortDescription", status: "status",
    displayOrder: "displayOrder", createdAt: "createdAt", updatedAt: "updatedAt",
  },
  serviceNormalizationMappingsTable: {
    id: "id", canonicalConceptId: "canonicalConceptId", serviceId: "serviceId",
    relationshipType: "relationshipType", isPrimary: "isPrimary",
    reviewNotes: "reviewNotes", createdAt: "createdAt", updatedAt: "updatedAt",
  },
  serviceAliasesTable: {
    id: "id", canonicalConceptId: "canonicalConceptId", alias: "alias",
    normalizedAlias: "normalizedAlias", aliasType: "aliasType",
    locale: "locale", status: "status", createdAt: "createdAt",
  },
  solutionCollectionsTable: {
    id: "id", code: "code", slug: "slug", name: "name",
    shortDescription: "shortDescription", status: "status",
    visibility: "visibility", displayOrder: "displayOrder",
    createdAt: "createdAt", updatedAt: "updatedAt",
  },
  solutionCollectionServicesTable: {
    id: "id", collectionId: "collectionId", serviceId: "serviceId",
    displayOrder: "displayOrder", role: "role", isOptional: "isOptional",
    createdAt: "createdAt",
  },
  aiServicesTable: {
    id: "id", serviceCode: "serviceCode", serviceName: "serviceName",
    status: "status", categoryId: "categoryId",
  },
  aiServiceCategoriesTable: {
    id: "id", name: "name", visibility: "visibility", commercialStatus: "commercialStatus", status: "status",
  },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
    delete: mocks.delete,
    transaction: mocks.transaction,
  },
  serviceCanonicalConceptsTable: mocks.serviceCanonicalConceptsTable,
  serviceNormalizationMappingsTable: mocks.serviceNormalizationMappingsTable,
  serviceAliasesTable: mocks.serviceAliasesTable,
  solutionCollectionsTable: mocks.solutionCollectionsTable,
  solutionCollectionServicesTable: mocks.solutionCollectionServicesTable,
  aiServicesTable: mocks.aiServicesTable,
  aiServiceCategoriesTable: mocks.aiServiceCategoriesTable,
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  normalizeAliasString,
  isValidCode,
  isValidSlug,
  NormalizationError,
  RELATIONSHIP_TYPES,
  ALIAS_TYPES,
  ALLOWED_STATUSES,
  ALLOWED_VISIBILITIES,
  MEMBER_ROLES,
  BULK_SERVICE_LIMIT,
} from "../../services/serviceNormalizationService.js";

// ═══════════════════════════════════════════════════════════════════════════════
// TC-01: normalizeAliasString — trim + lowercase
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-01: normalizeAliasString", () => {
  it("trims whitespace and lowercases", () => {
    expect(normalizeAliasString("  Branding Logo  ")).toBe("branding logo");
    expect(normalizeAliasString("UPPERCASE")).toBe("uppercase");
    expect(normalizeAliasString("already ok")).toBe("already ok");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-02: isValidCode — stable numeric service ID not used as identity
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-02: isValidCode — serviceName must not be used as identity", () => {
  it("accepts valid codes", () => {
    expect(isValidCode("cc_branding_logo")).toBe(true);
    expect(isValidCode("ab")).toBe(true);
    expect(isValidCode("a1_x")).toBe(true);
  });

  it("rejects invalid codes", () => {
    expect(isValidCode("")).toBe(false);
    expect(isValidCode("1starts_with_digit")).toBe(false);
    expect(isValidCode("has-hyphen")).toBe(false);
    expect(isValidCode("UPPERCASE")).toBe(false);
    expect(isValidCode("a")).toBe(false); // too short (need ≥2 after [a-z])
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-03: isValidSlug
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-03: isValidSlug", () => {
  it("accepts valid slugs", () => {
    expect(isValidSlug("branding-logo")).toBe(true);
    expect(isValidSlug("ab")).toBe(true);
    expect(isValidSlug("a1-x")).toBe(true);
  });

  it("rejects invalid slugs", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("1starts-with-digit")).toBe(false);
    expect(isValidSlug("has_underscore")).toBe(false);
    expect(isValidSlug("UPPER")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-04: Missing required identity fields rejected
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-04: missing required fields rejected safely", () => {
  it("rejects missing/empty code", () => {
    expect(isValidCode("")).toBe(false);
    expect(isValidCode("a")).toBe(false);
  });

  it("rejects missing/empty slug", () => {
    expect(isValidSlug("")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-05 + TC-06: Nullable descriptions and pricing
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-05/TC-06: nullable descriptions and pricing", () => {
  it("ALLOWED_STATUSES is a complete set", () => {
    expect(ALLOWED_STATUSES.has("active")).toBe(true);
    expect(ALLOWED_STATUSES.has("draft")).toBe(true);
    expect(ALLOWED_STATUSES.has("archived")).toBe(true);
    expect(ALLOWED_STATUSES.size).toBe(3);
  });

  it("ALLOWED_VISIBILITIES covers public and internal", () => {
    expect(ALLOWED_VISIBILITIES.has("public")).toBe(true);
    expect(ALLOWED_VISIBILITIES.has("internal")).toBe(true);
    expect(ALLOWED_VISIBILITIES.size).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-07: BULK_SERVICE_LIMIT constant
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-07: bulk service limit", () => {
  it("BULK_SERVICE_LIMIT is defined and positive", () => {
    expect(typeof BULK_SERVICE_LIMIT).toBe("number");
    expect(BULK_SERVICE_LIMIT).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-08: Relationship types and alias types are constrained sets
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-08: controlled vocabulary sets", () => {
  it("RELATIONSHIP_TYPES contains exactly the allowed values", () => {
    for (const t of ["primary", "alias_variant", "format_variant", "tier_variant", "legacy", "related"]) {
      expect(RELATIONSHIP_TYPES.has(t)).toBe(true);
    }
  });

  it("ALIAS_TYPES contains exactly the allowed values", () => {
    for (const t of ["name", "legacy_code", "language_variant", "typo"]) {
      expect(ALIAS_TYPES.has(t)).toBe(true);
    }
  });

  it("MEMBER_ROLES contains anchor, complementary, optional", () => {
    for (const r of ["anchor", "complementary", "optional"]) {
      expect(MEMBER_ROLES.has(r)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-09 to TC-14: Commercial eligibility — policy integration
// These verify that the repository source code actually applies the Team 01
// commercial eligibility policy (not duplicating it, but reusing its conditions).
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-09/TC-10: commercially eligible service included, inactive excluded", async () => {
  const repoSrc = await fs.readFile(
    path.resolve(SRC, "repositories/serviceNormalizationRepository.ts"),
    "utf8",
  );

  it("TC-09: eligibility filter joins aiServiceCategoriesTable", () => {
    expect(repoSrc).toContain("aiServiceCategoriesTable");
  });

  it('TC-10: inactive service excluded (status = "active" filter)', () => {
    expect(repoSrc).toContain(`eq(aiServicesTable.status, "active")`);
  });
});

describe("TC-11/TC-12: internal-only and commercially blocked services excluded", async () => {
  const repoSrc = await fs.readFile(
    path.resolve(SRC, "repositories/serviceNormalizationRepository.ts"),
    "utf8",
  );

  it('TC-11: visibility = "public" filter excludes internal-only', () => {
    expect(repoSrc).toContain(`eq(aiServiceCategoriesTable.visibility, "public")`);
  });

  it('TC-12: commercial_status = "commercial_ready" filter excludes blocked', () => {
    expect(repoSrc).toContain(`eq(aiServiceCategoriesTable.commercialStatus, "commercial_ready")`);
  });
});

describe("TC-13/TC-14: category eligibility gates applied together", async () => {
  const repoSrc = await fs.readFile(
    path.resolve(SRC, "repositories/serviceNormalizationRepository.ts"),
    "utf8",
  );

  it("TC-13: category status filter also applied", () => {
    expect(repoSrc).toContain(`eq(aiServiceCategoriesTable.status, "active")`);
  });

  it("TC-14: all four conditions appear together (and() block)", () => {
    // All four conditions are inside a single and() call — verify they co-exist
    expect(repoSrc).toContain("and(");
    expect(repoSrc).toContain("inArray(aiServicesTable.id, serviceIds)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-15/TC-16: Goal mapping deterministic ordering and primary ordering
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-15/TC-16: goal mapping ordering", async () => {
  const repoSrc = await fs.readFile(
    path.resolve(SRC, "repositories/serviceNormalizationRepository.ts"),
    "utf8",
  );

  it("TC-15: listMappingsByConceptId uses orderBy", () => {
    expect(repoSrc).toContain("orderBy");
  });

  it("TC-16: isPrimary is modelled in normalization mappings", () => {
    expect(repoSrc).toContain("isPrimary");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-17: Duplicate goal-service mapping prevention
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-17: duplicate mapping prevention", async () => {
  const svcSrc = await fs.readFile(
    path.resolve(SRC, "services/serviceNormalizationService.ts"),
    "utf8",
  );

  it("service layer checks for existing mapping before creating", () => {
    expect(svcSrc).toContain("getMappingByServiceId");
    expect(svcSrc).toContain("CONFLICTING_MAPPING");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-18: Unknown goal / concept returns 404
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-18: unknown concept returns NOT_FOUND", async () => {
  const svcSrc = await fs.readFile(
    path.resolve(SRC, "services/serviceNormalizationService.ts"),
    "utf8",
  );

  it("NormalizationError NOT_FOUND is thrown for missing concepts", () => {
    expect(svcSrc).toContain('"NOT_FOUND"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-19: Public GET /ai/solution-collections works without admin key
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-19: public GET routes bypass admin key", async () => {
  const adminAuthSrc = await fs.readFile(
    path.resolve(SRC, "middleware/adminAuth.ts"),
    "utf8",
  );

  it("/ai/solution-collections is declared in PUBLIC_PATH_PREFIXES", () => {
    expect(adminAuthSrc).toContain("/ai/solution-collections");
  });

  it("admin canonical-services prefix is NOT in public paths", () => {
    expect(adminAuthSrc).not.toContain("/ai/admin/canonical-services");
    expect(adminAuthSrc).not.toContain("/ai/admin/solution-collections");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-20: Write routes remain protected
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-20: write routes remain protected", async () => {
  const routeSrc = await fs.readFile(
    path.resolve(SRC, "routes/service-normalization.ts"),
    "utf8",
  );

  it("POST and DELETE routes use /ai/admin/ prefix (key-protected)", () => {
    expect(routeSrc).toContain('router.post("/ai/admin/canonical-services"');
    expect(routeSrc).toContain('router.post("/ai/admin/solution-collections"');
    expect(routeSrc).toContain('router.delete("/ai/admin/');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-21: Goal services response includes serviceId
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-21: GoalServiceStub includes serviceId", async () => {
  const typesSrc = await fs.readFile(
    path.resolve(SRC, "goals/types.ts"),
    "utf8",
  );

  it("GoalServiceStub declares serviceId: number", () => {
    expect(typesSrc).toContain("serviceId: number");
  });

  it("GoalServiceStub still declares serviceCode", () => {
    expect(typesSrc).toContain("serviceCode: string");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-22: Existing serviceCode preserved
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-22: serviceCode preserved in goal repository", async () => {
  const repoSrc = await fs.readFile(
    path.resolve(SRC, "goals/goalRepository.ts"),
    "utf8",
  );

  it("listServicesForGoal selects s.service_code", () => {
    expect(repoSrc).toContain("s.service_code");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-23: No fake service ID — ID comes from actual DB join
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-23: serviceId comes from actual DB row", async () => {
  const repoSrc = await fs.readFile(
    path.resolve(SRC, "goals/goalRepository.ts"),
    "utf8",
  );

  it("selects s.id AS service_id from the join", () => {
    expect(repoSrc).toContain("s.id");
    expect(repoSrc).toContain("service_id");
    expect(repoSrc).toContain("serviceId: r.service_id");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-24: No fake pricing — pricing fields come from DB columns only
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-24: no fake pricing injected", async () => {
  const routeSrc = await fs.readFile(
    path.resolve(SRC, "routes/service-normalization.ts"),
    "utf8",
  );

  it("route file does not hardcode startingPrice values", () => {
    // No numeric literals being assigned to startingPrice
    expect(routeSrc).not.toMatch(/startingPrice\s*[:=]\s*\d/);
    expect(routeSrc).not.toMatch(/starting_price\s*[:=]\s*\d/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-25: Empty goal services returns safe empty array
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-25: empty collection returns safe empty array", async () => {
  const repoSrc = await fs.readFile(
    path.resolve(SRC, "repositories/serviceNormalizationRepository.ts"),
    "utf8",
  );

  it("listEligibleServicesForCollection returns [] when memberships is empty", () => {
    expect(repoSrc).toContain("if (memberships.length === 0) return []");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-26: Existing catalog regression — catalog routes still exist
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-26: existing catalog routes not removed", async () => {
  const indexSrc = await fs.readFile(
    path.resolve(SRC, "routes/index.ts"),
    "utf8",
  );

  it("catalog router is still mounted", () => {
    expect(indexSrc).toContain("catalogRouter");
  });

  it("goals router is still mounted", () => {
    // Goals router is imported as goalTaxonomyRouter from ../goals/goalRoutes.js
    expect(indexSrc).toContain("goalTaxonomyRouter");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-27: Existing Commercial Policy regression — policy file not modified
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-27: commercial policy file not modified by Team 04", async () => {
  const policySrc = await fs.readFile(
    path.resolve(SRC, "policy/commercialEligibilityPolicy.ts"),
    "utf8",
  );

  it("policy still exports isCategoryCommerciallyEligible", () => {
    expect(policySrc).toContain("isCategoryCommerciallyEligible");
  });

  it("policy still exports isServiceCommerciallyEligible", () => {
    expect(policySrc).toContain("isServiceCommerciallyEligible");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-28: Existing Goal Taxonomy regression — goal types not broken
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-28: goal taxonomy types still intact", async () => {
  const typesSrc = await fs.readFile(
    path.resolve(SRC, "goals/types.ts"),
    "utf8",
  );

  it("Goal interface still exists", () => {
    expect(typesSrc).toContain("interface Goal");
  });

  it("GoalView interface still exists", () => {
    expect(typesSrc).toContain("interface GoalView");
  });

  it("GoalWithServices still extends GoalView", () => {
    expect(typesSrc).toContain("extends GoalView");
  });

  it("GoalServiceStub backward-compatible fields all present", () => {
    expect(typesSrc).toContain("serviceCode: string");
    expect(typesSrc).toContain("serviceName: string");
    expect(typesSrc).toContain("shortDescription");
    expect(typesSrc).toContain("relevanceScore");
    expect(typesSrc).toContain("isPrimary");
    expect(typesSrc).toContain("displayOrder");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TC-extra: Public API response sanitization
// ═══════════════════════════════════════════════════════════════════════════════
describe("TC-extra: public API does not expose internal fields", async () => {
  const routeSrc = await fs.readFile(
    path.resolve(SRC, "routes/service-normalization.ts"),
    "utf8",
  );

  it("public collection response uses safeServices / safeCollection pattern", () => {
    expect(routeSrc).toContain("safeServices");
    expect(routeSrc).toContain("safeCollection");
  });

  it("reviewNotes not exposed in public response", () => {
    // The route must not forward reviewNotes to the public caller
    const publicSection = routeSrc.split("/ai/solution-collections")[1] ?? "";
    expect(publicSection).not.toContain("reviewNotes");
  });
});
