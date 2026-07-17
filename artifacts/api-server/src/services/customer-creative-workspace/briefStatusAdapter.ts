/**
 * briefStatusAdapter.ts — Customer-safe brief status read model.
 *
 * Reads briefJson from ai_service_requests and maps it to structured
 * BriefField DTOs. Never exposes internal IDs, pricing, or AI model data.
 * IDOR: caller must pass in a project already verified to belong to clientEmail.
 */
import type { BriefField, BriefStatus } from "./types.js";

/** Well-known brief field definitions with display labels and required flags. */
const BRIEF_FIELD_DEFS: { key: string; label: string; required: boolean }[] = [
  { key: "brandName",        label: "Nama Brand",             required: true },
  { key: "companyName",      label: "Nama Perusahaan",        required: false },
  { key: "targetMarket",     label: "Target Pasar",           required: true },
  { key: "productOrService", label: "Produk / Layanan",       required: true },
  { key: "goal",             label: "Tujuan Proyek",          required: true },
  { key: "stylePreference",  label: "Preferensi Gaya",        required: false },
  { key: "colorPreference",  label: "Preferensi Warna",       required: false },
  { key: "industryType",     label: "Industri",               required: false },
  { key: "businessType",     label: "Tipe Bisnis",            required: false },
  { key: "tagline",          label: "Tagline / Slogan",       required: false },
  { key: "competitors",      label: "Kompetitor",             required: false },
  { key: "uniqueValue",      label: "Nilai Unik (USP)",       required: false },
  { key: "additionalNotes",  label: "Catatan Tambahan",       required: false },
  { key: "deadline",         label: "Deadline",               required: false },
  // Company Profile fields
  { key: "cpCompanyHistory",     label: "Sejarah Perusahaan",    required: false },
  { key: "cpVisionMission",      label: "Visi & Misi",           required: false },
  { key: "cpOrganizationChart",  label: "Struktur Organisasi",   required: false },
  { key: "cpContactInfo",        label: "Informasi Kontak",      required: false },
];

function coerceToString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val.trim() || null;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) return val.join(", ") || null;
  if (typeof val === "object") return JSON.stringify(val);
  return null;
}

/**
 * Build a BriefStatus from raw data already loaded by the caller.
 * The caller must have already verified project ownership via IDOR guard.
 */
export function buildBriefStatus(params: {
  projectNumber: string;
  serviceType: string | null;
  briefJson: unknown;
  submittedAt: string | null;
  updatedAt: string | null;
}): BriefStatus {
  const { projectNumber, serviceType, briefJson, submittedAt, updatedAt } = params;

  const brief = (typeof briefJson === "object" && briefJson !== null)
    ? briefJson as Record<string, unknown>
    : {};

  // Map well-known fields
  const fields: BriefField[] = BRIEF_FIELD_DEFS.map((def) => {
    const raw = brief[def.key];
    const value = coerceToString(raw);
    return { key: def.key, label: def.label, value, filled: value !== null, required: def.required };
  });

  // Also capture any extra keys not in the standard list as generic fields
  const knownKeys = new Set(BRIEF_FIELD_DEFS.map((d) => d.key));
  for (const [key, val] of Object.entries(brief)) {
    if (!knownKeys.has(key)) {
      const value = coerceToString(val);
      if (value) {
        fields.push({ key, label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), value, filled: true, required: false });
      }
    }
  }

  const filledRequired = fields.filter((f) => f.required && f.filled).length;
  const totalRequired = fields.filter((f) => f.required).length;
  const filledOptional = fields.filter((f) => !f.required && f.filled).length;
  const totalOptional = fields.filter((f) => !f.required).length;

  // Weight: required fields = 70%, optional = 30%
  const requiredScore = totalRequired > 0 ? (filledRequired / totalRequired) * 70 : 70;
  const optionalScore = totalOptional > 0 ? (filledOptional / totalOptional) * 30 : 30;
  const briefCompletionPercent = Math.round(requiredScore + optionalScore);

  // Generate human-readable summary
  const brandName = coerceToString(brief["brandName"]);
  const goal = coerceToString(brief["goal"]);
  const targetMarket = coerceToString(brief["targetMarket"]);
  let summary: string | null = null;
  if (brandName && goal) {
    summary = `${brandName}${targetMarket ? ` menargetkan ${targetMarket}` : ""}. Tujuan: ${goal}.`;
  }

  return {
    projectNumber,
    serviceType,
    briefCompletionPercent,
    fields: fields.filter((f) => f.filled || f.required), // only show filled + required
    summary,
    submittedAt,
    lastUpdatedAt: updatedAt,
  };
}
