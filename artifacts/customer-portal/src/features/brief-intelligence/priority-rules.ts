/**
 * Priority rules (section 14) — boosts based on PRIORITY_OPTIONS value.
 */

import type { CategoryBoost } from "./types";

export const PRIORITY_RULES: Record<string, CategoryBoost[]> = {
  quality: [
    { category: "photographyDirection", key: "Kualitas produksi tinggi, minim kompromi", label: "Kualitas produksi tinggi", weight: 8 },
  ],
  speed: [
    { category: "deliverable", key: "Format siap pakai yang efisien produksi", label: "Format siap pakai & efisien produksi", weight: 6 },
  ],
  budget: [
    { category: "deliverable", key: "Deliverable inti yang esensial (hindari scope besar)", label: "Deliverable inti yang esensial", weight: 6 },
  ],
  balanced: [],
  unsure: [],
};
