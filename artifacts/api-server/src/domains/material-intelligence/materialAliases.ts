export const MATERIAL_ALIASES: Record<string, string> = {
  marmer: "marble",
  travertine: "travertine",
  "kayu jati": "teak",
  jati: "teak",
  granit: "granite",
  doff: "matte",
  matt: "matte",
  glossy: "gloss",
  mengkilap: "gloss",
  keramik: "ceramic",
  ubin: "tile",
  vinyl: "vinyl plank",
  hpl: "high pressure laminate",
  "high pressure laminate": "high pressure laminate",
  kayu: "wood",
  batu: "stone",
  lantai: "floor",
  dinding: "wall",
  plafon: "ceiling",
  kain: "fabric",
};

const ALIAS_KEYS = Object.keys(MATERIAL_ALIASES).sort((a, b) => b.length - a.length);

export function normalizeMaterialText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeMaterialQuery(value: string | null | undefined): string {
  let normalized = normalizeMaterialText(value);
  for (const alias of ALIAS_KEYS) {
    const aliasText = normalizeMaterialText(alias);
    normalized = normalized.replace(
      new RegExp(`(^|\\s)${escapeRegExp(aliasText)}(?=\\s|$)`, "g"),
      `$1${MATERIAL_ALIASES[alias]}`,
    );
  }
  return normalizeMaterialText(normalized);
}

export function aliasMatches(value: string | null | undefined): string[] {
  const normalized = normalizeMaterialText(value);
  return ALIAS_KEYS.filter((alias) => {
    const aliasText = normalizeMaterialText(alias);
    return normalized === aliasText
      || new RegExp(`(^|\\s)${escapeRegExp(aliasText)}(?=\\s|$)`).test(normalized);
  }).map((alias) => MATERIAL_ALIASES[alias]);
}

export function getAliasSuggestions(): Array<{ value: string; canonical: string }> {
  return ALIAS_KEYS.map((alias) => ({
    value: alias,
    canonical: MATERIAL_ALIASES[alias],
  }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}