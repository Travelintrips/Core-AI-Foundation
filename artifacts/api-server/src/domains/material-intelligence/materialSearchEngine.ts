import type { MaterialRecord } from "../material-library/types.js";
import { normalizeField, normalizeQuery } from "./materialNormalizer.js";
import type {
  MaterialSearchInput,
  MaterialSearchMode,
  MaterialScoreBreakdown,
  RankedMaterial,
} from "./types.js";

export interface SemanticMatcher {
  score(query: string, material: MaterialRecord): number;
}

export const providerIndependentSemanticMatcher: SemanticMatcher = {
  score: () => 0,
};

const WEIGHTS: Record<keyof Omit<MaterialScoreBreakdown, "total">, number> = {
  exact: 0.25,
  keyword: 0.18,
  alias: 0.12,
  category: 0.08,
  brand: 0.06,
  style: 0.05,
  component: 0.05,
  color: 0.05,
  finish: 0.04,
  material: 0.07,
  semantic: 0.05,
};

export function rankMaterials(
  materials: MaterialRecord[],
  input: MaterialSearchInput,
  semanticMatcher: SemanticMatcher = providerIndependentSemanticMatcher,
): RankedMaterial[] {
  const normalizedQuery = normalizeQuery(input.query);
  const mode = input.mode ?? "hybrid";
  return materials
    .filter((material) =>
      material.status === "active"
      && (!input.category || scoreOption(input.category, material.category) > 0)
      && (!input.brand || scoreOption(input.brand, material.brand) > 0)
      && (!input.priceTier || normalizeField(material.priceTier) === normalizeField(input.priceTier))
    )
    .map((material) => scoreMaterial(material, input, normalizedQuery, mode, semanticMatcher))
    .filter((item) => shouldInclude(item, normalizedQuery.normalized, mode))
    .sort((a, b) =>
      b.score.total - a.score.total
      || a.material.name.localeCompare(b.material.name)
      || a.material.id - b.material.id,
    );
}

export function scoreMaterial(
  material: MaterialRecord,
  input: MaterialSearchInput,
  normalizedQuery = normalizeQuery(input.query),
  mode: MaterialSearchMode = input.mode ?? "hybrid",
  semanticMatcher: SemanticMatcher = providerIndependentSemanticMatcher,
): RankedMaterial {
  const fields = [
    material.name,
    material.slug,
    material.materialCode,
    material.description,
    ...(material.searchKeywords ?? []),
    material.category,
    material.subcategory,
    material.brand,
    material.color,
    material.finish,
    material.texture,
    material.pattern,
    material.materialType,
  ].filter(Boolean).map((value) => normalizeField(value));
  const searchable = fields.join(" ");
  const name = normalizeField(material.name);
  const tokens = normalizedQuery.tokens;
  const matchedTokens = tokens.filter((token) => searchable.includes(token));
  const exact = normalizedQuery.normalized && (
    name === normalizedQuery.normalized
    || normalizeField(material.slug) === normalizedQuery.normalized
    || normalizeField(material.materialCode) === normalizedQuery.normalized
  ) ? 1 : 0;
  const keyword = tokens.length === 0 ? 0 : matchedTokens.length / tokens.length;
  const alias = normalizedQuery.aliases.some((aliasValue) => searchable.includes(normalizeField(aliasValue))) ? 1 : 0;
  const category = scoreOption(input.category, material.category);
  const brand = scoreOption(input.brand, material.brand);
  const style = scoreOption(input.style, [material.texture, material.pattern, material.finish].filter(Boolean).join(" "));
  const component = scoreOption(input.component, [material.materialType, material.subcategory].filter(Boolean).join(" "));
  const color = scoreOption(input.color, material.color);
  const finish = scoreOption(input.finish, material.finish);
  const materialScore = scoreOption(input.material, [material.materialType, material.name].filter(Boolean).join(" "));
  const semantic = semanticMatcher.score(normalizedQuery.normalized, material);
  const score: MaterialScoreBreakdown = {
    exact, keyword, alias, category, brand, style, component, color, finish,
    material: materialScore, semantic,
    total: Number((
      exact * WEIGHTS.exact
      + keyword * WEIGHTS.keyword
      + alias * WEIGHTS.alias
      + category * WEIGHTS.category
      + brand * WEIGHTS.brand
      + style * WEIGHTS.style
      + component * WEIGHTS.component
      + color * WEIGHTS.color
      + finish * WEIGHTS.finish
      + materialScore * WEIGHTS.material
      + semantic * WEIGHTS.semantic
    ).toFixed(6)),
  };
  const matchReasons: string[] = [];
  if (exact) matchReasons.push("exact match");
  if (keyword) matchReasons.push("keyword match");
  if (alias) matchReasons.push("alias match");
  if (category) matchReasons.push("category");
  if (brand) matchReasons.push("brand");
  if (style) matchReasons.push("style");
  if (component) matchReasons.push("component");
  if (color) matchReasons.push("color");
  if (finish) matchReasons.push("finish");
  if (materialScore) matchReasons.push("material type");
  if (semantic) matchReasons.push("semantic-ready");
  return { material, score, matchReasons };
}

function shouldInclude(item: RankedMaterial, query: string, mode: MaterialSearchMode): boolean {
  if (!query) return true;
  if (mode === "exact") return item.score.exact > 0;
  if (mode === "keyword") return item.score.keyword > 0;
  if (mode === "fuzzy") return fuzzyTokenScore(query, item.material) >= 0.45;
  return item.score.total > 0;
}

function scoreOption(value: string | undefined, candidate: string | null | undefined): number {
  const query = normalizeField(value);
  const target = normalizeField(candidate);
  if (!query || !target) return 0;
  if (query === target) return 1;
  if (target.includes(query) || query.includes(target)) return 0.75;
  return fuzzySimilarity(query, target);
}

function fuzzyTokenScore(query: string, material: MaterialRecord): number {
  const target = [
    material.name,
    material.slug,
    material.description,
    ...(material.searchKeywords ?? []),
  ].filter(Boolean).map((value) => normalizeField(value)).join(" ");
  const tokens = query.split(" ").filter(Boolean);
  if (!tokens.length) return 0;
  return tokens.reduce((sum, token) => {
    const candidates = target.split(" ");
    return sum + Math.max(...candidates.map((candidate) => fuzzySimilarity(token, candidate)), 0);
  }, 0) / tokens.length;
}

function fuzzySimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const distance = levenshtein(left, right);
  return Math.max(0, 1 - distance / Math.max(left.length, right.length));
}

function levenshtein(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = row[j];
      row[j] = left[i - 1] === right[j - 1]
        ? diagonal
        : 1 + Math.min(diagonal, above, row[j - 1]);
      diagonal = above;
    }
  }
  return row[right.length];
}