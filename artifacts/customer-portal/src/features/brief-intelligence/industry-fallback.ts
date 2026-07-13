/**
 * Fallback matching for unknown/custom industries (section 20).
 *
 * Used only when the user typed free text into "Lainnya" instead of picking
 * a known INDUSTRY_OPTIONS value. Case-insensitive keyword/alias matching to
 * the nearest known industry key — never an LLM call. Confidence is always
 * lowered downstream when a fallback match is used (see engine.ts).
 */

import { INDUSTRY_PROFILES, getIndustryProfile } from "./industry-profiles";
import type { IndustryProfile } from "./types";

/** keyword (lowercase, substring-matched) → target industry key */
/**
 * Alias table for free-text industry matching.
 *
 * Ordering principle — specificity first:
 *   - Multi-concept phrases (e.g. "export import") must appear BEFORE
 *     single-concept aliases that share keywords (e.g. "logistics"), so the
 *     more specific match wins when both keywords are present.
 *   - Within a group, longer / more distinctive keywords come first.
 *
 * Example: "ekspor impor / logistik" — "ekspor" matches export_import (checked
 * first) rather than logistics, which is the correct more-specific resolution.
 */
const ALIASES: [string[], string][] = [
  [["coffee", "kopi", "cafe", "kafe"], "coffee_shop"],
  // export_import MUST come before logistics — "ekspor"/"impor" are more
  // specific identifiers for this business type than logistik/cargo.
  [["export", "import", "ekspor", "impor", "export import", "ekspor impor"], "export_import"],
  [["logistic", "logistik", "cargo", "kargo", "forwarding", "ekspedisi"], "logistics"],
  [["charcoal", "arang", "briket"], "charcoal"],
  [["restoran", "resto", "restaurant", "rumah makan"], "restaurant"],
  [["bakery", "roti", "kue"], "bakery"],
  [["hotel", "penginapan", "villa"], "hotel"],
  [["travel", "wisata", "tour", "trip"], "tourism"],
  [["hospital", "rumah sakit", "rs "], "hospital"],
  [["clinic", "klinik"], "clinic"],
  [["pharmacy", "apotek", "farmasi"], "pharmacy"],
  [["school", "sekolah"], "school"],
  [["university", "universitas", "kampus"], "university"],
  [["fintech", "keuangan digital", "pembayaran digital"], "fintech"],
  [["bank", "perbankan"], "banking"],
  [["insurance", "asuransi"], "insurance"],
  [["ai", "artificial intelligence", "kecerdasan buatan", "machine learning"], "ai"],
  [["software", "aplikasi", "app development", "saas"], "software"],
  [["startup", "rintisan"], "startup"],
  [["property", "properti", "perumahan"], "property"],
  [["real estate", "developer properti"], "real_estate"],
  [["architecture", "arsitek"], "architecture"],
  [["interior", "desain interior"], "interior"],
  [["law firm", "pengacara", "hukum", "advokat"], "law"],
  [["accounting", "akuntansi", "pembukuan"], "accounting"],
  [["consulting", "konsultan"], "consulting"],
  [["agency", "agensi kreatif"], "creative_agency"],
  [["marketing agency", "digital agency"], "marketing_agency"],
  [["fashion", "pakaian", "busana", "clothing"], "fashion"],
  [["beauty", "kecantikan", "skincare"], "beauty"],
  [["cosmetics", "kosmetik"], "cosmetics"],
  [["jewelry", "perhiasan", "emas"], "jewelry"],
  [["furniture", "mebel", "furnitur"], "furniture"],
  [["agriculture", "pertanian", "agribisnis"], "agriculture"],
  [["plantation", "perkebunan"], "plantation"],
  [["seafood", "hasil laut"], "seafood"],
  [["fishery", "perikanan", "nelayan"], "fishery"],
  [["mining", "tambang", "pertambangan"], "mining"],
  [["coal", "batu bara"], "coal"],
  [["palm oil", "kelapa sawit", "cpo"], "palm_oil"],
  [["coconut", "kelapa"], "coconut"],
  [["automotive", "otomotif"], "automotive"],
  [["car dealer", "dealer mobil", "showroom mobil"], "car_dealer"],
  [["motorcycle", "motor", "dealer motor"], "motorcycle"],
  [["gym", "fitness center", "pusat kebugaran"], "gym"],
  [["sport center", "lapangan olahraga"], "sport_center"],
  [["event organizer", "eo ", "penyelenggara acara"], "event_organizer"],
  [["wedding", "pernikahan", "wedding organizer"], "wedding"],
  [["photography", "fotografi", "fotografer"], "photography"],
  [["government", "pemerintah", "instansi", "dinas", "kementerian"], "government"],
  [["nonprofit", "ngo", "yayasan", "lsm"], "nonprofit"],
  [["ecommerce", "e-commerce", "toko online", "online shop"], "ecommerce"],
  [["marketplace", "lapak"], "marketplace"],
  [["retail", "toko ritel"], "retail"],
  [["trading", "perdagangan", "distributor besar"], "trading"],
  [["manufacturing", "manufaktur", "pabrik"], "manufacturing"],
  [["construction", "konstruksi", "kontraktor"], "construction"],
  [["media", "penyiaran", "broadcasting"], "media"],
  [["entertainment", "hiburan"], "entertainment"],
];

export interface FallbackMatchResult {
  matchedKey: string | null;
  profile: IndustryProfile | null;
  matchedVia: "alias" | "none";
}

/** Case-insensitive alias/keyword match for free-text industry input.
 *  Never calls an LLM; pure substring matching over a static table. */
export function resolveFallbackIndustry(freeText: string): FallbackMatchResult {
  const text = freeText.trim().toLowerCase();
  if (!text) return { matchedKey: null, profile: null, matchedVia: "none" };

  for (const [keywords, targetKey] of ALIASES) {
    if (keywords.some((kw) => text.includes(kw))) {
      return { matchedKey: targetKey, profile: getIndustryProfile(targetKey), matchedVia: "alias" };
    }
  }
  return { matchedKey: null, profile: null, matchedVia: "none" };
}

/** Generic, industry-agnostic profile used when even alias matching fails.
 *  Deliberately conservative/safe defaults — never fabricated per-request. */
export const GENERIC_FALLBACK_PROFILE: IndustryProfile = {
  key: "generic",
  label: "Industri Umum",
  categoryGroup: "Lainnya",
  styles: ["modern", "clean", "corporate"],
  colors: ["blue", "black", "white"],
  audiences: ["general", "b2c"],
  personalities: ["profesional", "dipercaya"],
  deliverables: ["Company profile dasar", "Konten media sosial umum"],
  toneOfVoice: ["Jelas & profesional"],
  photographyDirection: ["Foto produk/layanan dengan cahaya terang & natural"],
  visualDirection: ["Layout rapi dengan whitespace cukup"],
  contentDirection: ["Fokus pada kejelasan layanan/produk yang ditawarkan"],
  avoid: [],
  notes: "Profil generik — industri belum teridentifikasi secara spesifik, gunakan sebagai titik awal yang aman.",
};

export function listKnownIndustryKeys(): string[] {
  return Object.keys(INDUSTRY_PROFILES);
}
