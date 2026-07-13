/**
 * Builds concise (2-3 reason) explanations for a recommendation, drawn only
 * from actual rule sources that contributed to it (section 29).
 */

import type { BriefRecommendation } from "./types";

const SOURCE_LABEL: Record<string, string> = {
  industry: "sesuai industri Anda",
  service: "relevan untuk layanan ini",
  goal: "mendukung tujuan project Anda",
  audience: "sesuai target audiens Anda",
  "company-size": "sesuai skala bisnis Anda",
  priority: "sesuai prioritas Anda",
  "existing-assets": "melengkapi aset yang sudah Anda miliki",
  fallback: "rekomendasi umum (industri belum spesifik)",
};

export function explainRecommendation(rec: BriefRecommendation): string[] {
  return rec.reasons.slice(0, 3).map((r) => r.text || SOURCE_LABEL[r.source] || "direkomendasikan oleh sistem");
}
