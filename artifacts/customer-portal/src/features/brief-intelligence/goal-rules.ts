/**
 * Goal rules (section 11) — boosts specific recommendation categories/keys
 * based on GOAL_OPTIONS values already selected by the user.
 */

import type { CategoryBoost } from "./types";

/** goal key (GOAL_OPTIONS value) → list of category/key boosts */
export const GOAL_RULES: Record<string, CategoryBoost[]> = {
  brand_awareness: [
    { category: "style", key: "bold", label: "Bold", weight: 12 },
    { category: "contentDirection", key: "Konsistensi visual di semua channel untuk mengunci recall", label: "Konsistensi visual multi-channel", weight: 15 },
  ],
  sales: [
    { category: "deliverable", key: "Konten promosi & CTA jelas", label: "Konten promosi & CTA jelas", weight: 15 },
    { category: "toneOfVoice", key: "Persuasif", label: "Persuasif", weight: 10 },
  ],
  leads: [
    { category: "deliverable", key: "Landing page / lead magnet visual", label: "Landing page / lead magnet visual", weight: 15 },
    { category: "contentDirection", key: "Ajakan bertindak (CTA) yang jelas di setiap materi", label: "CTA jelas di setiap materi", weight: 12 },
  ],
  new_product: [
    { category: "deliverable", key: "Konten peluncuran produk", label: "Konten peluncuran produk", weight: 15 },
    { category: "photographyDirection", key: "Hero shot produk baru", label: "Hero shot produk baru", weight: 10 },
  ],
  rebranding: [
    { category: "personality", key: "segar", label: "Segar", weight: 12 },
    { category: "contentDirection", key: "Cerita transformasi/perubahan brand", label: "Cerita transformasi brand", weight: 12 },
  ],
  professional: [
    { category: "style", key: "corporate", label: "Corporate", weight: 12 },
    { category: "personality", key: "profesional", label: "Profesional", weight: 12 },
  ],
  trust: [
    { category: "personality", key: "terpercaya", label: "Terpercaya", weight: 15 },
    { category: "contentDirection", key: "Testimoni & bukti sosial", label: "Testimoni & bukti sosial", weight: 12 },
  ],
  engagement: [
    { category: "contentDirection", key: "Konten interaktif & relatable", label: "Konten interaktif & relatable", weight: 15 },
    { category: "toneOfVoice", key: "Santai & relatable", label: "Santai & relatable", weight: 10 },
  ],
  conversion: [
    { category: "deliverable", key: "Visual landing page dengan CTA kuat", label: "Visual landing page dengan CTA kuat", weight: 15 },
  ],
  investor: [
    { category: "audience", key: "investor", label: "Investor", weight: 18 },
    { category: "contentDirection", key: "Traksi & data sebagai bukti", label: "Traksi & data sebagai bukti", weight: 15 },
  ],
  distributor: [
    { category: "audience", key: "distributor", label: "Distributor", weight: 18 },
    { category: "deliverable", key: "Katalog & term kemitraan", label: "Katalog & term kemitraan", weight: 12 },
  ],
  international: [
    { category: "audience", key: "international", label: "International buyer", weight: 15 },
    { category: "contentDirection", key: "Materi bilingual (ID/EN)", label: "Materi bilingual", weight: 15 },
  ],
  promo_material: [
    { category: "deliverable", key: "Materi promosi siap pakai", label: "Materi promosi siap pakai", weight: 12 },
  ],
  brand_identity: [
    { category: "personality", key: "khas", label: "Khas / distinctive", weight: 12 },
    { category: "visualDirection", key: "Sistem identitas visual yang konsisten", label: "Sistem identitas visual konsisten", weight: 15 },
  ],
};
