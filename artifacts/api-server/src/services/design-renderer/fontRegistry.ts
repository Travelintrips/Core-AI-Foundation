/**
 * Design Renderer — Font Registry
 *
 * Controls which fonts are available for rendering. librsvg (used by Sharp)
 * renders text via Pango, which picks up system fonts installed in the
 * Replit/NixOS environment.
 *
 * Rules:
 *  - Never fetch fonts from the internet at render time.
 *  - If the requested font is not available, fall back deterministically.
 *  - Log a warning — never fail the render for a missing font.
 *  - Do not expose font paths via API.
 */

/** Fonts that are reliably available in the Replit/NixOS sandbox. */
const PLATFORM_FONTS = new Set([
  "Arial",
  "Helvetica",
  "sans-serif",
  "serif",
  "monospace",
  "DejaVu Sans",
  "DejaVu Serif",
  "DejaVu Sans Mono",
  "Liberation Sans",
  "Liberation Serif",
  "Liberation Mono",
  "Noto Sans",
  "Noto Serif",
  "Ubuntu",
  "Cantarell",
  "FreeSans",
  "FreeSerif",
  "FreeMono",
]);

const PLATFORM_FALLBACK = "Arial";
const GENERIC_FALLBACK = "sans-serif";

/**
 * Returns the best available font family for a requested font name.
 * If the font isn't in the registry, returns the platform fallback and
 * records whether a fallback was applied.
 */
export function resolveFont(
  requested: string | undefined,
  templateDefault?: string,
): { fontFamily: string; isFallback: boolean } {
  if (!requested) {
    // Use template default or platform fallback
    const def = templateDefault ?? PLATFORM_FALLBACK;
    return {
      fontFamily: PLATFORM_FONTS.has(def) ? def : PLATFORM_FALLBACK,
      isFallback: !templateDefault,
    };
  }

  if (PLATFORM_FONTS.has(requested)) {
    return { fontFamily: requested, isFallback: false };
  }

  // Try case-insensitive match
  const lower = requested.toLowerCase();
  for (const font of PLATFORM_FONTS) {
    if (font.toLowerCase() === lower) {
      return { fontFamily: font, isFallback: false };
    }
  }

  // Use template default if available and registered
  if (templateDefault && PLATFORM_FONTS.has(templateDefault)) {
    return { fontFamily: templateDefault, isFallback: true };
  }

  return { fontFamily: PLATFORM_FALLBACK, isFallback: true };
}

/**
 * Sanitise a font-family string for safe inclusion in SVG XML.
 * Strips characters that could break out of the XML attribute context.
 */
export function safeFontFamily(family: string): string {
  // Allow letters, digits, spaces, hyphens, underscores
  return family.replace(/[^a-zA-Z0-9 \-_]/g, "").slice(0, 100) || GENERIC_FALLBACK;
}

export { PLATFORM_FALLBACK, GENERIC_FALLBACK };
