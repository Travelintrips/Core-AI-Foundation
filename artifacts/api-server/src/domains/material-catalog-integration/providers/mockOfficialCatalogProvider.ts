/**
 * Material Catalog Integration — Phase 3 Foundation
 * ⚠️  MOCK / TEST PROVIDER ONLY — do not expose as a production provider.
 *
 * Deterministic fixture data. No network access. No credentials required.
 * Supports pagination and returns intentionally invalid records for testing.
 */

import type { MaterialCatalogProvider } from "../catalogProvider.js";
import type {
  CatalogFetchContext,
  CatalogProviderCapabilities,
  CatalogProviderValidationResult,
  ExternalCatalogItem,
  ExternalCatalogResult,
} from "../types.js";

// ── Fixture data ──────────────────────────────────────────────────────────────

/** Deterministic base date for all fixture items */
const BASE_DATE = new Date("2024-01-15T08:00:00.000Z");
const day = (n: number) => new Date(BASE_DATE.getTime() + n * 86_400_000);

const VALID_FIXTURES: ExternalCatalogItem[] = [
  // ── Flooring — Brand: Niro Granite ──────────────────────────────────────
  {
    externalId: "NG-FLR-001",
    providerId: "mock-official-catalog",
    sourceUrl: "https://catalog.nirogranite.com/products/NG-FLR-001",
    brand: "Niro Granite",
    productCode: "NG-FLR-001",
    productName: "Calacatta Gold Polished",
    category: "flooring",
    subcategory: "porcelain tile",
    materialType: "porcelain",
    description: "Premium large-format porcelain tile with gold veining.",
    color: ["white", "gold"],
    finish: ["polished"],
    texture: "smooth",
    priceTier: "premium",
    unit: "m²",
    dimensions: { width: 600, height: 600, thickness: 10, unit: "mm" },
    certifications: ["ISO 13006", "GREENGUARD"],
    country: "ID",
    locale: "id-ID",
    sourceUpdatedAt: day(0),
    thumbnailReference: {
      kind: "remote_url",
      url: "https://catalog.nirogranite.com/images/NG-FLR-001-thumb.jpg",
    },
  },
  {
    externalId: "NG-FLR-002",
    providerId: "mock-official-catalog",
    sourceUrl: "https://catalog.nirogranite.com/products/NG-FLR-002",
    brand: "Niro Granite",
    productCode: "NG-FLR-002",
    productName: "Pietra Grey Honed",
    category: "flooring",
    subcategory: "porcelain tile",
    materialType: "porcelain",
    description: "Grey stone-look porcelain with honed finish.",
    color: ["grey"],
    finish: ["honed"],
    priceTier: "standard",
    unit: "m²",
    dimensions: { width: 800, height: 800, thickness: 10, unit: "mm" },
    country: "ID",
    locale: "id-ID",
    sourceUpdatedAt: day(1),
  },
  {
    externalId: "NG-FLR-003",
    providerId: "mock-official-catalog",
    brand: "Niro Granite",
    productCode: "NG-FLR-003",
    productName: "Timber Oak Natural",
    category: "flooring",
    subcategory: "wood-look tile",
    materialType: "porcelain",
    color: ["brown", "beige"],
    finish: ["natural"],
    priceTier: "standard",
    unit: "m²",
    country: "ID",
    sourceUpdatedAt: day(2),
  },
  {
    externalId: "NG-FLR-004",
    providerId: "mock-official-catalog",
    brand: "Niro Granite",
    productCode: "NG-FLR-004",
    productName: "Nero Marquina Gloss",
    category: "flooring",
    subcategory: "porcelain tile",
    materialType: "porcelain",
    color: ["black", "white"],
    finish: ["gloss"],
    priceTier: "premium",
    unit: "m²",
    sourceUpdatedAt: day(3),
  },
  {
    externalId: "NG-FLR-005",
    providerId: "mock-official-catalog",
    brand: "Niro Granite",
    productCode: "NG-FLR-005",
    productName: "Travertine Beige Matt",
    category: "flooring",
    subcategory: "porcelain tile",
    materialType: "porcelain",
    color: ["beige", "cream"],
    finish: ["matte"],
    priceTier: "economy",
    unit: "m²",
    sourceUpdatedAt: day(4),
  },
  // ── Wall Tile — Brand: Niro Granite ─────────────────────────────────────
  {
    externalId: "NG-WLL-001",
    providerId: "mock-official-catalog",
    brand: "Niro Granite",
    productCode: "NG-WLL-001",
    productName: "Subway White Gloss",
    category: "wall tile",
    subcategory: "ceramic",
    materialType: "ceramic",
    color: ["white"],
    finish: ["gloss"],
    priceTier: "economy",
    unit: "m²",
    dimensions: { width: 75, height: 150, unit: "mm" },
    sourceUpdatedAt: day(5),
  },
  {
    externalId: "NG-WLL-002",
    providerId: "mock-official-catalog",
    brand: "Niro Granite",
    productCode: "NG-WLL-002",
    productName: "Zellige Emerald Handmade",
    category: "wall tile",
    subcategory: "ceramic",
    materialType: "ceramic",
    color: ["green"],
    finish: ["gloss"],
    texture: "handmade variation",
    priceTier: "luxury",
    unit: "m²",
    sourceUpdatedAt: day(6),
  },
  // ── Flooring — Brand: Essenzo ────────────────────────────────────────────
  {
    externalId: "ESZ-FLR-001",
    providerId: "mock-official-catalog",
    sourceUrl: "https://catalog.essenzo.id/products/ESZ-FLR-001",
    brand: "Essenzo",
    productCode: "ESZ-FLR-001",
    productName: "Onyx Black Polished",
    category: "flooring",
    subcategory: "natural stone",
    materialType: "marble",
    description: "Italian onyx marble slab, polished.",
    color: ["black"],
    finish: ["polished"],
    priceTier: "luxury",
    unit: "m²",
    certifications: ["CE Mark"],
    country: "IT",
    locale: "it-IT",
    sourceUpdatedAt: day(7),
    thumbnailReference: {
      kind: "remote_url",
      url: "https://catalog.essenzo.id/images/ESZ-FLR-001-thumb.jpg",
    },
    previewReferences: [
      { kind: "remote_url", url: "https://catalog.essenzo.id/images/ESZ-FLR-001-a.jpg" },
      { kind: "remote_url", url: "https://catalog.essenzo.id/images/ESZ-FLR-001-b.jpg" },
    ],
  },
  {
    externalId: "ESZ-FLR-002",
    providerId: "mock-official-catalog",
    brand: "Essenzo",
    productCode: "ESZ-FLR-002",
    productName: "Bianco Carrara Honed",
    category: "flooring",
    subcategory: "natural stone",
    materialType: "marble",
    color: ["white", "grey"],
    finish: ["honed"],
    priceTier: "luxury",
    unit: "m²",
    sourceUpdatedAt: day(8),
  },
  {
    externalId: "ESZ-FLR-003",
    providerId: "mock-official-catalog",
    brand: "Essenzo",
    productCode: "ESZ-FLR-003",
    productName: "Sandstone Matte Large",
    category: "flooring",
    subcategory: "natural stone",
    materialType: "sandstone",
    color: ["sand", "beige"],
    finish: ["matte"],
    priceTier: "standard",
    unit: "m²",
    sourceUpdatedAt: day(9),
  },
  // ── Wall Covering — Brand: Essenzo ───────────────────────────────────────
  {
    externalId: "ESZ-WCV-001",
    providerId: "mock-official-catalog",
    brand: "Essenzo",
    productCode: "ESZ-WCV-001",
    productName: "Venetian Plaster Classic",
    category: "wall covering",
    subcategory: "decorative plaster",
    materialType: "mineral plaster",
    color: ["off-white"],
    finish: ["polished"],
    priceTier: "premium",
    unit: "m²",
    sourceUpdatedAt: day(10),
  },
  {
    externalId: "ESZ-WCV-002",
    providerId: "mock-official-catalog",
    brand: "Essenzo",
    productCode: "ESZ-WCV-002",
    productName: "Microcement Grey Urban",
    category: "wall covering",
    subcategory: "microcement",
    materialType: "microcement",
    color: ["grey"],
    finish: ["matte"],
    texture: "fine grain",
    priceTier: "premium",
    unit: "m²",
    sourceUpdatedAt: day(11),
  },
  // ── Timber — Brand: Niro Granite ─────────────────────────────────────────
  {
    externalId: "NG-TMB-001",
    providerId: "mock-official-catalog",
    brand: "Niro Granite",
    productCode: "NG-TMB-001",
    productName: "Engineered Oak Brushed",
    category: "timber",
    subcategory: "engineered wood",
    materialType: "engineered hardwood",
    color: ["oak", "brown"],
    finish: ["brushed"],
    priceTier: "standard",
    unit: "m²",
    dimensions: { width: 190, thickness: 14, unit: "mm" },
    sourceUpdatedAt: day(12),
  },
  {
    externalId: "NG-TMB-002",
    providerId: "mock-official-catalog",
    brand: "Niro Granite",
    productCode: "NG-TMB-002",
    productName: "Solid Teak Smooth",
    category: "timber",
    subcategory: "solid wood",
    materialType: "teak",
    color: ["brown"],
    finish: ["natural"],
    priceTier: "premium",
    unit: "m²",
    certifications: ["FSC"],
    sourceUpdatedAt: day(13),
  },
  // ── Paint — Brand: Essenzo ───────────────────────────────────────────────
  {
    externalId: "ESZ-PNT-001",
    providerId: "mock-official-catalog",
    brand: "Essenzo",
    productCode: "ESZ-PNT-001",
    productName: "Mineral White Matte Interior",
    category: "paint",
    subcategory: "interior paint",
    materialType: "water-based paint",
    color: ["white"],
    finish: ["matte"],
    priceTier: "standard",
    unit: "L",
    technicalData: { coverage: "10-12 m²/L", dryTime: "60 min", coats: 2 },
    sourceUpdatedAt: day(14),
  },
  {
    externalId: "ESZ-PNT-002",
    providerId: "mock-official-catalog",
    brand: "Essenzo",
    productCode: "ESZ-PNT-002",
    productName: "Graphite Satin Finish",
    category: "paint",
    subcategory: "interior paint",
    materialType: "water-based paint",
    color: ["grey", "charcoal"],
    finish: ["satin"],
    priceTier: "standard",
    unit: "L",
    sourceUpdatedAt: day(15),
  },
  // ── Fabric — Brand: Essenzo ──────────────────────────────────────────────
  {
    externalId: "ESZ-FAB-001",
    providerId: "mock-official-catalog",
    brand: "Essenzo",
    productCode: "ESZ-FAB-001",
    productName: "Linen Natural Weave",
    category: "fabric",
    subcategory: "upholstery",
    materialType: "linen",
    color: ["natural", "beige"],
    finish: ["natural"],
    texture: "coarse weave",
    priceTier: "standard",
    unit: "lm",
    sourceUpdatedAt: day(16),
  },
  {
    externalId: "ESZ-FAB-002",
    providerId: "mock-official-catalog",
    brand: "Essenzo",
    productCode: "ESZ-FAB-002",
    productName: "Velvet Midnight Blue",
    category: "fabric",
    subcategory: "upholstery",
    materialType: "velvet",
    color: ["navy", "blue"],
    finish: ["velvet"],
    priceTier: "premium",
    unit: "lm",
    sourceUpdatedAt: day(17),
  },
  // ── Hardware — Brand: Niro Granite ───────────────────────────────────────
  {
    externalId: "NG-HW-001",
    providerId: "mock-official-catalog",
    brand: "Niro Granite",
    productCode: "NG-HW-001",
    productName: "Matte Black Door Handle Set",
    category: "hardware",
    subcategory: "door hardware",
    materialType: "stainless steel",
    color: ["black"],
    finish: ["matte"],
    priceTier: "standard",
    unit: "pcs",
    sourceUpdatedAt: day(18),
  },
  {
    externalId: "NG-HW-002",
    providerId: "mock-official-catalog",
    brand: "Niro Granite",
    productCode: "NG-HW-002",
    productName: "Brushed Gold Towel Rail 600mm",
    category: "hardware",
    subcategory: "bathroom accessories",
    materialType: "brass",
    color: ["gold"],
    finish: ["brushed"],
    priceTier: "premium",
    unit: "pcs",
    dimensions: { length: 600, unit: "mm" },
    sourceUpdatedAt: day(19),
  },
  {
    externalId: "NG-HW-003",
    providerId: "mock-official-catalog",
    brand: "Niro Granite",
    productCode: "NG-HW-003",
    productName: "Chrome Shower System",
    category: "hardware",
    subcategory: "bathroom fittings",
    materialType: "stainless steel",
    color: ["silver"],
    finish: ["polished"],
    priceTier: "standard",
    unit: "pcs",
    certifications: ["WELS"],
    sourceUpdatedAt: day(20),
  },
  // ── Lighting — Brand: Essenzo ────────────────────────────────────────────
  {
    externalId: "ESZ-LGT-001",
    providerId: "mock-official-catalog",
    brand: "Essenzo",
    productCode: "ESZ-LGT-001",
    productName: "Pendant Cone Matte Black",
    category: "lighting",
    subcategory: "pendant light",
    materialType: "powder-coated steel",
    color: ["black"],
    finish: ["matte"],
    priceTier: "standard",
    unit: "pcs",
    technicalData: { wattage: 40, socket: "E27", ipRating: "IP20" },
    sourceUpdatedAt: day(21),
  },
  {
    externalId: "ESZ-LGT-002",
    providerId: "mock-official-catalog",
    brand: "Essenzo",
    productCode: "ESZ-LGT-002",
    productName: "Track Light System 3-Circuit",
    category: "lighting",
    subcategory: "track lighting",
    materialType: "aluminium",
    color: ["white"],
    finish: ["matte"],
    priceTier: "standard",
    unit: "pcs",
    sourceUpdatedAt: day(22),
  },
];

/** Intentionally invalid records for testing validation rejection */
const INVALID_FIXTURES: Array<Record<string, unknown>> = [
  {
    // Missing required externalId
    providerId: "mock-official-catalog",
    productName: "Invalid Item No ID",
    category: "flooring",
  },
  {
    // Missing required productName
    externalId: "INV-002",
    providerId: "mock-official-catalog",
    category: "flooring",
  },
  {
    // Invalid sourceUrl scheme (will be caught by normalizer)
    externalId: "INV-003",
    providerId: "mock-official-catalog",
    productName: "Item With Bad URL",
    sourceUrl: "ftp://badscheme.example.com/item",
    category: "flooring",
  },
];

const ALL_FIXTURES = [
  ...VALID_FIXTURES,
  ...(INVALID_FIXTURES as unknown as ExternalCatalogItem[]),
];

// ── Provider implementation ───────────────────────────────────────────────────

/**
 * Mock catalog provider — test/fixture use only.
 * Returns deterministic, paginated fixture data. No network calls.
 */
export const mockOfficialCatalogProvider: MaterialCatalogProvider = {
  providerId: "mock-official-catalog",
  displayName: "Mock Official Catalog Provider (Test Only)",
  sourceType: "manual_fixture",

  getCapabilities(): CatalogProviderCapabilities {
    return {
      supportedBrands: ["Niro Granite", "Essenzo"],
      supportedCountries: ["ID", "IT"],
      supportsPagination: true,
      supportsFiltering: true,
      maxItemsPerFetch: 50,
      requiresCredentials: false,
    };
  },

  async validateConfig(config: unknown): Promise<CatalogProviderValidationResult> {
    // Mock provider requires no credentials
    if (config !== null && config !== undefined && typeof config === "object") {
      return { valid: true, errors: [] };
    }
    if (config === null || config === undefined) {
      return { valid: true, errors: [] };
    }
    return { valid: false, errors: ["Config must be an object or null"] };
  },

  async fetchCatalog(context: CatalogFetchContext): Promise<ExternalCatalogResult> {
    // Simulate abort signal support
    if (context.abortSignal?.aborted) {
      throw new Error("Fetch aborted");
    }

    const limit = context.limit ?? 10;
    let offset = 0;

    if (context.cursor) {
      const parsed = parseInt(context.cursor, 10);
      if (!Number.isNaN(parsed)) offset = parsed;
    }

    let items = ALL_FIXTURES;

    // Optional brand filter
    if (context.brand) {
      const brandLower = context.brand.toLowerCase();
      items = items.filter(
        (item) =>
          item.brand?.toLowerCase().includes(brandLower) ?? false,
      );
    }

    const slice = items.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    const nextCursor = nextOffset < items.length ? String(nextOffset) : undefined;

    return {
      items: slice,
      nextCursor,
      totalAvailable: items.length,
      sourceMetadata: {
        provider: "mock-official-catalog",
        fixtureVersion: "1.0.0",
        isTestData: true,
      },
      fetchedAt: new Date("2024-06-01T12:00:00.000Z"), // deterministic
    };
  },
};
