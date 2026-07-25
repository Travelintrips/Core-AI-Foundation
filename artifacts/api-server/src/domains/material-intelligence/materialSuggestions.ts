import type { MaterialRecord } from "../material-library/types.js";
import { getAliasSuggestions } from "./materialAliases.js";
import { normalizeField } from "./materialNormalizer.js";
import type { MaterialSuggestion } from "./types.js";

export function buildMaterialSuggestions(
  materials: MaterialRecord[],
  query: string,
  popularSearches: string[] = [],
  limit = 10,
): MaterialSuggestion[] {
  const normalizedQuery = normalizeField(query);
  const candidates = new Map<string, MaterialSuggestion>();
  const add = (value: string | null | undefined, type: MaterialSuggestion["type"], baseScore: number): void => {
    const normalized = normalizeField(value);
    if (!normalized || (normalizedQuery && !normalized.includes(normalizedQuery))) return;
    const existing = candidates.get(normalized);
    if (!existing || existing.score < baseScore) {
      candidates.set(normalized, { value: value!.trim(), type, score: baseScore });
    }
  };

  for (const material of materials) {
    add(material.name, "material", 1);
    add(material.brand, "brand", 0.9);
    add(material.category, "category", 0.85);
    add(material.subcategory, "subcategory", 0.8);
  }
  for (const alias of getAliasSuggestions()) {
    add(alias.value, "alias", 0.7);
    add(alias.canonical, "alias", 0.65);
  }
  for (const popular of popularSearches) add(popular, "popular", 0.95);

  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value))
    .slice(0, Math.max(1, Math.min(50, limit)));
}