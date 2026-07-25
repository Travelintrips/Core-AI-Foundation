import { aliasMatches, normalizeMaterialQuery, normalizeMaterialText } from "./materialAliases.js";

export interface NormalizedMaterialQuery {
  original: string;
  normalized: string;
  tokens: string[];
  aliases: string[];
}

export function normalizeQuery(value: string | null | undefined): NormalizedMaterialQuery {
  const original = (value ?? "").trim();
  const normalized = normalizeMaterialQuery(original);
  return {
    original,
    normalized,
    tokens: normalized ? normalized.split(" ") : [],
    aliases: aliasMatches(original),
  };
}

export function normalizeField(value: string | null | undefined): string {
  return normalizeMaterialText(value);
}