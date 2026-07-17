/**
 * vendorService.test.ts — Team 22 unit tests
 *
 * DOMAIN MAPPING REVIEW — Team 23 Audit Remediation
 * Updated to reflect: creative_vendors (master) → creative_vendor_profiles
 * (extension of marketplace_creators).
 *
 * Tests: public DTO builder, mask helpers, URL validation (SSRF),
 *        VENDOR_TYPES exhaustiveness, toPublicCard merged DTO.
 */
import { describe, it, expect, vi } from "vitest";

// ── vi.hoisted: declare mock db BEFORE vi.mock factory runs ───────────────────
const mockVendorDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../schema.js", () => ({
  vendorDb: mockVendorDb,
  // Extension table (replaces creative_vendors master)
  creativeVendorProfilesTable: {
    id: "id",
    creatorId: "creator_id",
    vendorType: "vendor_type",
    whatsapp: "whatsapp",
    instagramUrl: "instagram_url",
    city: "city",
    province: "province",
    country: "country",
    minPrice: "min_price",
    maxPrice: "max_price",
    priceCurrency: "price_currency",
    leadTimeDays: "lead_time_days",
    isAvailableNow: "is_available_now",
    isFeatured: "is_featured",
    moderationStatus: "moderation_status",
    moderationNote: "moderation_note",
    moderatedAt: "moderated_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  vendorServiceAreasTable: {
    profileId: "profile_id",
    province: "province",
    isRemote: "is_remote",
  },
  vendorCapabilitiesTable: { profileId: "profile_id" },
  vendorCertificationsTable: { profileId: "profile_id" },
  VENDOR_TYPES: [
    "graphic_designer", "printing", "interior_designer", "furniture",
    "lighting", "flooring", "curtain", "kitchen", "custom_furniture",
    "textile", "konveksi", "embroidery", "apparel_printing", "packaging",
    "product_mockup", "photographer", "videographer",
  ],
}));

vi.mock("@workspace/db", () => ({
  marketplaceCreatorsTable: {
    id: "id",
    creatorCode: "creator_code",
    displayName: "display_name",
    bio: "bio",
    avatarUrl: "avatar_url",
    websiteUrl: "website_url",
    email: "email",
    isVerified: "is_verified",
    isActive: "is_active",
    avgRating: "avg_rating",
    totalAssets: "total_assets",
    totalDownloads: "total_downloads",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  pool: {},
}));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn(() => mockVendorDb),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ __eq: [col, val] })),
  and: vi.fn((...args) => ({ __and: args.filter(Boolean) })),
  or: vi.fn((...args) => ({ __or: args })),
  ilike: vi.fn((col, val) => ({ __ilike: [col, val] })),
  desc: vi.fn((col) => ({ __desc: col })),
  asc: vi.fn((col) => ({ __asc: col })),
  inArray: vi.fn((col, vals) => ({ __inArray: [col, vals] })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => ({ __sql: strings.raw[0] })),
    { join: vi.fn(() => ({})) },
  ),
}));

// ── Import pure helpers AFTER mock declarations ────────────────────────────────
import { maskWhatsapp, maskEmail, toPublicCard, validateExternalUrl, VENDOR_TYPES } from "../vendorService.js";

// ── Shared fixtures ────────────────────────────────────────────────────────────

const MOCK_CREATOR = {
  id: 10,
  creatorCode: "CRE-001",
  displayName: "Kreatif Studio",
  bio: "Spesialis logo dan brand identity",
  avatarUrl: "https://cdn.example.com/avatar.png",
  websiteUrl: "https://kreatiifstudio.com",
  email: "vendor@example.com",
  isVerified: true,
  isActive: true,
  avgRating: "4.80",
  totalAssets: 5,
  totalDownloads: 120,
  metadata: {},
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

const MOCK_PROFILE = {
  id: 1,
  creatorId: 10,
  vendorType: "graphic_designer",
  whatsapp: "+6281234567890",
  instagramUrl: "https://instagram.com/kreatifstudio",
  city: "Jakarta Selatan",
  province: "DKI Jakarta",
  country: "ID",
  minPrice: 500000,
  maxPrice: 5000000,
  priceCurrency: "IDR",
  leadTimeDays: 5,
  isAvailableNow: true,
  isFeatured: false,
  moderationStatus: "approved",
  moderationNote: null,
  moderatedAt: null,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

// ─────────────────────────────────────────────────────────────────────────────

describe("maskWhatsapp", () => {
  it("masks digits after first 5 characters", () => {
    expect(maskWhatsapp("+6281234567890")).toBe("+6281*****");
  });
  it("returns null for undefined", () => {
    expect(maskWhatsapp(undefined)).toBeNull();
  });
  it("returns null for null", () => {
    expect(maskWhatsapp(null)).toBeNull();
  });
  it("returns null for empty string", () => {
    expect(maskWhatsapp("")).toBeNull();
  });
});

describe("maskEmail", () => {
  it("masks local part after first 3 chars", () => {
    expect(maskEmail("vendor@example.com")).toBe("ven***@example.com");
  });
  it("returns null for undefined", () => {
    expect(maskEmail(undefined)).toBeNull();
  });
  it("returns null for null", () => {
    expect(maskEmail(null)).toBeNull();
  });
  it("returns null for string without @", () => {
    expect(maskEmail("nodomain")).toBeNull();
  });
});

describe("toPublicCard — merged creator + profile DTO", () => {
  it("merges creator identity with profile extension", () => {
    const card = toPublicCard(MOCK_CREATOR, MOCK_PROFILE);
    expect(card.id).toBe(10);                    // from creator
    expect(card.profileId).toBe(1);              // from profile
    expect(card.creatorCode).toBe("CRE-001");    // from creator
    expect(card.displayName).toBe("Kreatif Studio");
    expect(card.isVerified).toBe(true);          // from creator
    expect(card.avgRating).toBe("4.80");         // from creator
  });

  it("exposes extension fields (vendorType, location, operations)", () => {
    const card = toPublicCard(MOCK_CREATOR, MOCK_PROFILE);
    expect(card.vendorType).toBe("graphic_designer");
    expect(card.city).toBe("Jakarta Selatan");
    expect(card.province).toBe("DKI Jakarta");
    expect(card.leadTimeDays).toBe(5);
    expect(card.isAvailableNow).toBe(true);
    expect(card.isFeatured).toBe(false);
    expect(card.moderationStatus).toBe("approved");
  });

  it("masks whatsapp in public DTO", () => {
    const card = toPublicCard(MOCK_CREATOR, MOCK_PROFILE);
    expect(card.contactWhatsapp).toBe("+6281*****");
  });

  it("passes through websiteUrl from creator", () => {
    const card = toPublicCard(MOCK_CREATOR, MOCK_PROFILE);
    expect(card.websiteUrl).toBe("https://kreatiifstudio.com");
  });

  it("exposes instagramUrl from profile extension", () => {
    const card = toPublicCard(MOCK_CREATOR, MOCK_PROFILE);
    expect(card.instagramUrl).toBe("https://instagram.com/kreatifstudio");
  });

  it("exposes display-only pricing fields from profile", () => {
    const card = toPublicCard(MOCK_CREATOR, MOCK_PROFILE);
    expect(card.minPrice).toBe(500000);
    expect(card.maxPrice).toBe(5000000);
    expect(card.priceCurrency).toBe("IDR");
  });

  it("moderationNote is NOT included in public card", () => {
    const card = toPublicCard(MOCK_CREATOR, MOCK_PROFILE);
    expect(card).not.toHaveProperty("moderationNote");
  });
});

describe("validateExternalUrl — SSRF guard", () => {
  it("accepts valid https external URL", () => {
    expect(validateExternalUrl("https://example.com/path")).toBe("https://example.com/path");
  });
  it("accepts valid http external URL", () => {
    expect(validateExternalUrl("http://example.com")).toBe("http://example.com");
  });
  it("returns undefined for null", () => {
    expect(validateExternalUrl(null)).toBeUndefined();
  });
  it("returns undefined for empty string", () => {
    expect(validateExternalUrl("")).toBeUndefined();
  });

  // SSRF guards
  it("blocks localhost", () => {
    expect(() => validateExternalUrl("http://localhost/path")).toThrow(/private/i);
  });
  it("blocks 127.x.x.x", () => {
    expect(() => validateExternalUrl("http://127.0.0.1/")).toThrow(/private/i);
  });
  it("blocks 10.x.x.x", () => {
    expect(() => validateExternalUrl("http://10.0.0.1/")).toThrow(/private/i);
  });
  it("blocks 172.16.x.x", () => {
    expect(() => validateExternalUrl("http://172.16.0.1/")).toThrow(/private/i);
  });
  it("blocks 192.168.x.x", () => {
    expect(() => validateExternalUrl("http://192.168.1.1/")).toThrow(/private/i);
  });
  it("blocks 169.254.x.x (APIPA)", () => {
    expect(() => validateExternalUrl("http://169.254.169.254/")).toThrow(/private/i);
  });
  it("blocks raw IPv4 literal", () => {
    expect(() => validateExternalUrl("http://1.2.3.4/")).toThrow(/IP/i);
  });
  it("blocks non-http/https protocol", () => {
    expect(() => validateExternalUrl("ftp://example.com/")).toThrow(/http/i);
  });
  it("throws on malformed URL", () => {
    expect(() => validateExternalUrl("not-a-url")).toThrow(/Invalid URL/i);
  });
});

describe("VENDOR_TYPES — exhaustiveness", () => {
  const EXPECTED = [
    "graphic_designer", "printing", "interior_designer", "furniture",
    "lighting", "flooring", "curtain", "kitchen", "custom_furniture",
    "textile", "konveksi", "embroidery", "apparel_printing", "packaging",
    "product_mockup", "photographer", "videographer",
  ];
  it("contains all 17 expected vendor types", () => {
    expect(VENDOR_TYPES).toHaveLength(17);
    for (const t of EXPECTED) {
      expect(VENDOR_TYPES).toContain(t);
    }
  });
  it("includes creative categories: graphic, interior, textile/fashion, material", () => {
    expect(VENDOR_TYPES).toContain("graphic_designer");
    expect(VENDOR_TYPES).toContain("interior_designer");
    expect(VENDOR_TYPES).toContain("textile");
    expect(VENDOR_TYPES).toContain("konveksi");
    expect(VENDOR_TYPES).toContain("furniture");
  });
});
