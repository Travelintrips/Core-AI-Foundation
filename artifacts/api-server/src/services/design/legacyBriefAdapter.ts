/**
 * legacyBriefAdapter.ts — Team 38: Design Migration
 *
 * Maps legacy brief data to CanonicalDesignBrief.
 *
 * Sources:
 *  - creative_projects direct fields (sourceType=direct / legacy)
 *  - ai_service_requests.brief_json (sourceType=service_catalog)
 *
 * Invariants:
 *  - Never fabricates values; missing fields stay undefined/null.
 *  - Inferred/defaulted fields are listed in inferredFields[].
 *  - Unmappable brief_json keys are captured in unmappableFields[].
 *  - Original IDs and timestamps are preserved.
 */

import type { CreativeProject } from "@workspace/db";
import type { CanonicalDesignBrief } from "./designMigrationTypes.js";

// ── Known canonical brief_json keys ─────────────────────────────────────────
// When brief_json contains a key not in this set it goes to unmappableFields.

const KNOWN_BRIEF_KEYS = new Set([
  "brandName",
  "brand_name",
  "businessType",
  "business_type",
  "targetMarket",
  "target_market",
  "productOrService",
  "product_or_service",
  "goal",
  "stylePreference",
  "style_preference",
  "colorPreference",
  "color_preference",
  "referenceLinks",
  "reference_links",
  "notes",
  "deadline",
]);

// ── Helper ───────────────────────────────────────────────────────────────────

function safeString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  return null;
}

function requiredString(
  v: unknown,
  fieldName: string,
  inferredFields: string[],
): string {
  const s = safeString(v);
  if (s) return s;
  inferredFields.push(fieldName);
  return "";
}

// ── Adapter ──────────────────────────────────────────────────────────────────

/**
 * Builds a CanonicalDesignBrief from a creative_projects row.
 *
 * For service_catalog projects the caller may optionally supply the
 * parsed brief_json from ai_service_requests; if absent the project's
 * direct fields are used as fallback.
 */
export function mapLegacyBrief(
  project: CreativeProject,
  briefJson: Record<string, unknown> | null = null,
  serviceRequestId: number | null = null,
): CanonicalDesignBrief {
  const inferredFields: string[] = [];
  const unmappableFields: Array<{ field: string; value: unknown; reason: string }> = [];
  const extendedFields: Record<string, unknown> = {};

  // ── Resolve brief_json overlay ─────────────────────────────────────────
  // brief_json values take precedence over project direct fields when present.

  const bj = briefJson ?? {};

  const brandName = requiredString(
    bj["brandName"] ?? bj["brand_name"] ?? project.brandName,
    "brandName",
    inferredFields,
  );
  const businessType = requiredString(
    bj["businessType"] ?? bj["business_type"] ?? project.businessType,
    "businessType",
    inferredFields,
  );
  const targetMarket = requiredString(
    bj["targetMarket"] ?? bj["target_market"] ?? project.targetMarket,
    "targetMarket",
    inferredFields,
  );
  const productOrService = requiredString(
    bj["productOrService"] ?? bj["product_or_service"] ?? project.productOrService,
    "productOrService",
    inferredFields,
  );
  const goal = requiredString(
    bj["goal"] ?? project.goal,
    "goal",
    inferredFields,
  );

  const stylePreference = safeString(
    bj["stylePreference"] ?? bj["style_preference"] ?? project.stylePreference,
  );
  const colorPreference = safeString(
    bj["colorPreference"] ?? bj["color_preference"] ?? project.colorPreference,
  );
  const referenceLinks = safeString(
    bj["referenceLinks"] ?? bj["reference_links"] ?? project.referenceLinks,
  );
  const notes = safeString(bj["notes"] ?? project.notes);
  const deadline = safeString(bj["deadline"] ?? project.deadline);

  // ── Capture unknown brief_json keys ────────────────────────────────────

  for (const [key, value] of Object.entries(bj)) {
    if (!KNOWN_BRIEF_KEYS.has(key)) {
      // Check if it's a structured field we should extend rather than flag
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        extendedFields[key] = value;
      } else if (Array.isArray(value)) {
        extendedFields[key] = value;
      } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        unmappableFields.push({
          field: key,
          value,
          reason: "No canonical mapping exists for this brief_json key",
        });
      }
    }
  }

  return {
    legacyServiceRequestId: serviceRequestId,
    brandName,
    businessType,
    targetMarket,
    productOrService,
    goal,
    stylePreference,
    colorPreference,
    referenceLinks,
    notes,
    deadline,
    extendedFields,
    inferredFields,
    unmappableFields,
  };
}
