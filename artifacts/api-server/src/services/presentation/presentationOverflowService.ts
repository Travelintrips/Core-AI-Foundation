/**
 * presentationOverflowService.ts — Phase 4 Presentation Engine
 *
 * Text overflow protection helpers shared by the PPTX renderer.
 * Text overflow is a critical acceptance criterion: slides must never let
 * text run off the visible area, and font sizes must never shrink below a
 * readable minimum just to force everything to fit.
 */

export const MIN_BODY_FONT_SIZE = 12;
export const MAX_TITLE_LENGTH = 90;
export const MAX_BULLET_ITEMS_PER_SLIDE = 6;
export const MAX_BULLET_CHARS = 140;
export const MAX_PARAGRAPH_CHARS = 480;

export interface TruncationReport {
  truncated: boolean;
  original?: string;
  final: string;
}

/**
 * Truncate a string to a maximum length at a word boundary, appending an
 * ellipsis, and report whether truncation occurred so callers can log it in
 * the generation report instead of silently losing content.
 */
export function truncateWithReport(text: string, maxChars: number): TruncationReport {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return { truncated: false, final: trimmed };
  }
  const cut = trimmed.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  const safeCut = lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut;
  return { truncated: true, original: trimmed, final: `${safeCut.trim()}…` };
}

/**
 * Cap a bullet list to a maximum item count, truncating each item's text.
 * Any dropped items are reported so continuation-slide logic can act on them.
 */
export function fitBulletsToBox(
  items: string[],
  maxItems = MAX_BULLET_ITEMS_PER_SLIDE,
  maxCharsPerItem = MAX_BULLET_CHARS,
): { fitted: string[]; overflow: string[]; anyTruncated: boolean } {
  const cleaned = items.map((i) => i.trim()).filter(Boolean);
  const fitted: string[] = [];
  let anyTruncated = false;

  for (const item of cleaned.slice(0, maxItems)) {
    const { truncated, final } = truncateWithReport(item, maxCharsPerItem);
    if (truncated) anyTruncated = true;
    fitted.push(final);
  }
  const overflow = cleaned.slice(maxItems);

  return { fitted, overflow, anyTruncated };
}

/**
 * Split a long bullet list across multiple "continuation" slides instead of
 * truncating content away. Returns an array of chunks, each respecting
 * maxItems. Callers render one content slide per chunk, titling subsequent
 * chunks "<title> (cont.)".
 */
export function splitContentAcrossSlides(
  items: string[],
  maxItemsPerSlide = MAX_BULLET_ITEMS_PER_SLIDE,
): string[][] {
  const cleaned = items.map((i) => i.trim()).filter(Boolean);
  if (cleaned.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < cleaned.length; i += maxItemsPerSlide) {
    chunks.push(cleaned.slice(i, i + maxItemsPerSlide));
  }
  return chunks;
}

/** Fit a title to a maximum length without ever using an unreadably small font. */
export function fitTextToBox(text: string, maxChars = MAX_TITLE_LENGTH): TruncationReport {
  return truncateWithReport(text, maxChars);
}
