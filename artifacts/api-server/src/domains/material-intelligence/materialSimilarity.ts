import type { MaterialRecord } from "../material-library/types.js";
import type { SimilarMaterial } from "./types.js";
import { normalizeField } from "./materialNormalizer.js";

const SIMILARITY_WEIGHTS = [
  ["category", 0.2],
  ["subcategory", 0.15],
  ["finish", 0.12],
  ["color", 0.12],
  ["texture", 0.12],
  ["priceTier", 0.1],
  ["brand", 0.09],
  ["materialType", 0.1],
] as const;

export function similarityScore(source: MaterialRecord, candidate: MaterialRecord): {
  score: number;
  reasons: string[];
} {
  let score = 0;
  const reasons: string[] = [];
  for (const [field, weight] of SIMILARITY_WEIGHTS) {
    const sourceValue = normalizeField(source[field]);
    const candidateValue = normalizeField(candidate[field]);
    if (!sourceValue || !candidateValue) continue;
    if (sourceValue === candidateValue) {
      score += weight;
      reasons.push(field);
    } else if (sourceValue.includes(candidateValue) || candidateValue.includes(sourceValue)) {
      score += weight * 0.6;
      reasons.push(`${field} related`);
    }
  }
  return { score: Number(score.toFixed(6)), reasons };
}

export function rankSimilarMaterials(
  source: MaterialRecord,
  materials: MaterialRecord[],
  limit = 12,
): SimilarMaterial[] {
  return materials
    .filter((material) => material.id !== source.id && material.status === "active")
    .map((material) => {
      const result = similarityScore(source, material);
      return { material, similarityScore: result.score, matchReasons: result.reasons };
    })
    .filter((item) => item.similarityScore > 0)
    .sort((a, b) =>
      b.similarityScore - a.similarityScore
      || a.material.name.localeCompare(b.material.name)
      || a.material.id - b.material.id,
    )
    .slice(0, Math.max(1, Math.min(50, limit)));
}