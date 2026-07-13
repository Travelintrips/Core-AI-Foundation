/**
 * Audience rules (section 12) — boosts based on AUDIENCE_OPTIONS values
 * already selected by the user.
 */

import type { CategoryBoost } from "./types";

export const AUDIENCE_RULES: Record<string, CategoryBoost[]> = {
  b2b: [
    { category: "style", key: "corporate", label: "Corporate", weight: 10 },
    { category: "toneOfVoice", key: "Formal & berbasis data", label: "Formal & berbasis data", weight: 10 },
  ],
  b2c: [
    { category: "toneOfVoice", key: "Ramah & personal", label: "Ramah & personal", weight: 8 },
  ],
  corporate: [
    { category: "style", key: "corporate", label: "Corporate", weight: 10 },
  ],
  umkm: [
    { category: "toneOfVoice", key: "Praktis & mudah dipahami", label: "Praktis & mudah dipahami", weight: 8 },
  ],
  startup: [
    { category: "personality", key: "agile", label: "Agile", weight: 10 },
  ],
  investor: [
    { category: "contentDirection", key: "Data & traksi sebagai bukti", label: "Data & traksi sebagai bukti", weight: 15 },
    { category: "toneOfVoice", key: "Confident & berbasis fakta", label: "Confident & berbasis fakta", weight: 10 },
  ],
  government: [
    { category: "style", key: "clean", label: "Clean", weight: 10 },
    { category: "toneOfVoice", key: "Formal & netral", label: "Formal & netral", weight: 12 },
  ],
  distributor: [
    { category: "deliverable", key: "Katalog & term kemitraan", label: "Katalog & term kemitraan", weight: 10 },
  ],
  reseller: [
    { category: "deliverable", key: "Materi promosi siap pakai untuk reseller", label: "Materi promosi siap pakai untuk reseller", weight: 10 },
  ],
  retail_cust: [
    { category: "photographyDirection", key: "Foto produk siap pakai untuk display", label: "Foto produk siap display", weight: 8 },
  ],
  professional: [
    { category: "style", key: "elegant", label: "Elegant", weight: 8 },
  ],
  student: [
    { category: "style", key: "playful", label: "Playful", weight: 10 },
    { category: "toneOfVoice", key: "Ramah & mudah diakses", label: "Ramah & mudah diakses", weight: 8 },
  ],
  family: [
    { category: "toneOfVoice", key: "Hangat & inklusif", label: "Hangat & inklusif", weight: 8 },
  ],
  youth: [
    { category: "style", key: "bold", label: "Bold", weight: 8 },
    { category: "contentDirection", key: "Format pendek & visual dinamis (Reels/TikTok)", label: "Format pendek & dinamis", weight: 10 },
  ],
  premium: [
    { category: "style", key: "luxury", label: "Luxury", weight: 12 },
    { category: "photographyDirection", key: "Kualitas produksi premium/high-end", label: "Kualitas produksi premium", weight: 10 },
  ],
  local: [
    { category: "toneOfVoice", key: "Personal & dekat dengan komunitas lokal", label: "Personal & dekat komunitas lokal", weight: 8 },
  ],
  international: [
    { category: "contentDirection", key: "Materi bilingual (ID/EN)", label: "Materi bilingual", weight: 15 },
    { category: "style", key: "corporate", label: "Corporate", weight: 8 },
  ],
  general: [],
};
