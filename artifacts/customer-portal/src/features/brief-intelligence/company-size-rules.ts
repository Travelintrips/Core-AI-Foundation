/**
 * Company-size rules (section 13) — boosts based on COMPANY_SIZE_OPTIONS
 * value, when provided (this field is always optional in the brief).
 */

import type { CategoryBoost } from "./types";

export const COMPANY_SIZE_RULES: Record<string, CategoryBoost[]> = {
  solo: [
    { category: "toneOfVoice", key: "Personal & autentik", label: "Personal & autentik", weight: 6 },
  ],
  startup: [
    { category: "personality", key: "agile", label: "Agile", weight: 6 },
    { category: "style", key: "modern", label: "Modern", weight: 5 },
  ],
  smb: [
    { category: "toneOfVoice", key: "Praktis & terpercaya", label: "Praktis & terpercaya", weight: 5 },
  ],
  mid: [
    { category: "style", key: "corporate", label: "Corporate", weight: 5 },
  ],
  enterprise: [
    { category: "style", key: "corporate", label: "Corporate", weight: 8 },
    { category: "personality", key: "berskala", label: "Berskala / established", weight: 8 },
  ],
};
