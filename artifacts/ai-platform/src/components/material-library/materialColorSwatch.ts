/**
 * materialColorSwatch — generates a CSS background style for a material card
 * when no thumbnailUrl is available.
 *
 * Maps common interior-material color keywords → hex values and returns a
 * gradient that gives each card a distinctive, on-brand visual identity.
 */

const COLOR_MAP: Record<string, string> = {
  // Whites / Creams
  "pure white": "#f5f5f0",
  "white": "#f5f5f0",
  "brilliant white": "#f0f0ec",
  "magnolia": "#f5f0e8",
  "cream": "#f5ead8",
  "ivory": "#f5eedc",
  "warm ivory": "#f5ead0",
  "off white": "#f0ece0",
  "pearl": "#f0ede8",
  // Greys
  "soft grey": "#c8c8c4",
  "light grey": "#d0cfc8",
  "grey": "#b0aaa0",
  "concrete grey": "#9090888",
  "charcoal": "#4a4a48",
  "dark grey": "#555550",
  "slate": "#6a6e70",
  "concrete": "#909090",
  // Browns / Tans / Wood
  "natural oak": "#c89c60",
  "oak": "#c49858",
  "walnut": "#6b4226",
  "dark walnut": "#4a2c18",
  "teak": "#c8883a",
  "golden teak": "#d89c48",
  "merbau": "#5a3020",
  "dark brown": "#4a2e1a",
  "brown": "#7a5038",
  "natural wood": "#c0945a",
  "wood": "#b08040",
  "bamboo": "#d4b870",
  "natural": "#c8a868",
  // Beiges / Taupes
  "beige": "#d8c8a8",
  "warm beige": "#d8c0a0",
  "sand": "#d4c09a",
  "taupe": "#b8a890",
  "cream gold": "#e8d8a8",
  "cream grey": "#d0ccc0",
  // Blacks
  "black": "#1a1a18",
  "black white": "#2a2a28",
  "black gold": "#1a1810",
  // Greens
  "green": "#5a7a50",
  "olive": "#808050",
  "sage": "#9aaa88",
  "forest": "#3a6040",
  "mint": "#98d0b8",
  // Blues
  "pastel blue": "#a8c8e0",
  "blue": "#5080b0",
  "navy": "#2a3858",
  "teal": "#3a8080",
  "sky blue": "#80b8d8",
  // Yellows / Golds
  "yellow": "#e0c840",
  "gold": "#c8a030",
  "yellow gold": "#d8b030",
  // Reds / Pinks
  "red": "#c03030",
  "terracotta": "#c06040",
  "terracotta red": "#b85038",
  "rose": "#d09090",
  "pink": "#e0a0a8",
  "coral": "#d07860",
  // Purples
  "purple": "#7850a0",
  "lavender": "#b8a8d0",
  "mauve": "#c0909a",
  // Metallic
  "stainless": "#c0c0c0",
  "chrome": "#d0d0d0",
  "brass": "#c8a848",
  "copper": "#b06838",
  "bronze": "#906830",
  "silver": "#c8c8c8",
  "aluminum": "#b8b8b8",
  "white gold": "#e8e0c0",
  // Specialty
  "marble": "#e8e4dc",
  "calacatta": "#f0ece8",
  "nero marquina": "#1e1c18",
  "travertine": "#d8d0b8",
  "stone": "#b8b0a0",
  "grey stone": "#a8a49c",
  "blue white": "#c8d8e8",
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const num = parseInt(h, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function lighten(hex: string, amount = 20): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.min(255, r + amount)},${Math.min(255, g + amount)},${Math.min(255, b + amount)})`;
}

function darken(hex: string, amount = 20): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.max(0, r - amount)},${Math.max(0, g - amount)},${Math.max(0, b - amount)})`;
}

/** Resolve a color name → hex, falling back by partial match then a hash. */
function resolveColor(colorName: string | null | undefined): string {
  if (!colorName) return "#b0a898";
  const key = colorName.toLowerCase().trim();
  if (COLOR_MAP[key]) return COLOR_MAP[key];
  // Partial match — pick the first map key whose words overlap
  const words = key.split(/[\s,/]+/);
  for (const word of words) {
    for (const [mapKey, hex] of Object.entries(COLOR_MAP)) {
      if (mapKey.includes(word) && word.length > 3) return hex;
    }
  }
  // Deterministic hash fallback
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) & 0xffffff;
  return `#${(hash & 0xaaaaaa | 0x404040).toString(16).padStart(6, "0")}`;
}

/** Derive a texture-overlay hint from materialType / finish */
function getPattern(materialType: string | null | undefined, finish: string | null | undefined): string {
  const t = (materialType ?? "").toLowerCase();
  const f = (finish ?? "").toLowerCase();
  if (t.includes("wood") || t.includes("parquet") || t.includes("bamboo")) return "wood";
  if (t.includes("marble") || t.includes("terrazzo")) return "marble";
  if (t.includes("tile") || t.includes("ceramic") || t.includes("porcelain")) return "tile";
  if (t.includes("concrete") || t.includes("epoxy")) return "concrete";
  if (t.includes("metal") || t.includes("steel") || t.includes("alum")) return "metal";
  if (f.includes("gloss") || f.includes("polished")) return "gloss";
  return "plain";
}

export interface SwatchStyle {
  background: string;
  /** A short 1–2 word label to overlay on the swatch (material type icon hint) */
  patternHint: string;
}

/**
 * Returns an inline `style` object for a material swatch `<div>` and a
 * pattern hint string for the overlay icon.
 */
export function getMaterialSwatch(
  color: string | null | undefined,
  materialType: string | null | undefined,
  finish: string | null | undefined,
): SwatchStyle {
  const hex = resolveColor(color);
  const pattern = getPattern(materialType, finish);

  const light = lighten(hex, 30);
  const dark = darken(hex, 15);

  let background: string;
  switch (pattern) {
    case "wood":
      background = `repeating-linear-gradient(
        90deg,
        ${hex} 0px, ${darken(hex, 10)} 4px, ${hex} 8px, ${light} 12px, ${hex} 16px
      )`;
      break;
    case "marble":
      background = `radial-gradient(ellipse at 30% 30%, ${light} 0%, ${hex} 40%, ${dark} 100%)`;
      break;
    case "tile":
      background = `
        linear-gradient(${hex} 0%, ${hex} 100%),
        repeating-linear-gradient(0deg, transparent, transparent 19px, rgba(0,0,0,0.12) 19px, rgba(0,0,0,0.12) 20px),
        repeating-linear-gradient(90deg, transparent, transparent 19px, rgba(0,0,0,0.12) 19px, rgba(0,0,0,0.12) 20px)
      `;
      break;
    case "metal":
      background = `linear-gradient(135deg, ${light} 0%, ${hex} 40%, ${darken(hex, 30)} 60%, ${hex} 80%, ${light} 100%)`;
      break;
    case "gloss":
      background = `linear-gradient(135deg, ${light} 0%, ${hex} 50%, ${darken(hex, 8)} 100%)`;
      break;
    case "concrete":
      background = `radial-gradient(circle at 60% 40%, ${hex} 0%, ${darken(hex, 5)} 50%, ${darken(hex, 20)} 100%)`;
      break;
    default:
      background = `linear-gradient(135deg, ${light} 0%, ${hex} 60%, ${dark} 100%)`;
  }

  const PATTERN_LABELS: Record<string, string> = {
    wood: "🪵", marble: "🔲", tile: "⬛", metal: "⚙️", gloss: "✨", concrete: "🧱", plain: "",
  };

  return { background, patternHint: PATTERN_LABELS[pattern] ?? "" };
}
