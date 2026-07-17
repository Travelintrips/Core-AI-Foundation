// ============================================================
// TEAM 12 — Text Fitting
// Estimates whether text content fits in an element box
// No canvas rendering — purely geometric estimation
// ============================================================

import type {
  LayoutElement,
  TextStyle,
  TextFitResult,
} from "../../types/layout-composer/index.js";

const DEFAULT_CHAR_WIDTH_RATIO = 0.55; // avg char width as fraction of fontSize
const DEFAULT_LINE_HEIGHT = 1.4;
const DEFAULT_MIN_FONT = 8;
const DEFAULT_MAX_FONT = 72;

/** Estimate number of lines needed to render text in a given width */
export function estimateLines(
  text: string,
  style: TextStyle,
  containerWidth: number
): number {
  if (!text || containerWidth <= 0) return 0;

  const charWidth = style.fontSize * (style.charWidthRatio ?? DEFAULT_CHAR_WIDTH_RATIO);
  if (charWidth <= 0) return 0;

  const charsPerLine = Math.floor(containerWidth / charWidth);
  if (charsPerLine <= 0) return Infinity;

  // Split by hard line breaks first, then wrap each paragraph
  const paragraphs = text.split(/\r?\n/);
  let totalLines = 0;

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      totalLines += 1; // blank line
      continue;
    }

    // Word-wrap estimation
    const words = paragraph.split(/\s+/);
    let currentLineLen = 0;
    let linesForPara = 1;

    for (const word of words) {
      // Long word that exceeds one line — split across multiple lines
      if (word.length > charsPerLine) {
        if (currentLineLen > 0) {
          linesForPara++; // finish current partial line
          currentLineLen = 0;
        }
        const linesForWord = Math.ceil(word.length / charsPerLine);
        linesForPara += linesForWord - 1; // -1: last chunk is the "current" open line
        currentLineLen = word.length % charsPerLine || charsPerLine;
        continue;
      }

      const wordLen = word.length + (currentLineLen > 0 ? 1 : 0); // +1 for space
      if (currentLineLen + wordLen > charsPerLine && currentLineLen > 0) {
        linesForPara++;
        currentLineLen = word.length;
      } else {
        currentLineLen += wordLen;
      }
    }

    totalLines += linesForPara;
  }

  return totalLines;
}

/** How many lines fit in element height given font style */
export function linesAvailable(
  height: number,
  style: TextStyle
): number {
  const lineHeightPx = style.fontSize * (style.lineHeight ?? DEFAULT_LINE_HEIGHT);
  if (lineHeightPx <= 0) return 0;
  return Math.floor(height / lineHeightPx);
}

/** Height required to render N lines */
export function heightForLines(lines: number, style: TextStyle): number {
  return lines * style.fontSize * (style.lineHeight ?? DEFAULT_LINE_HEIGHT);
}

/** Check whether text content fits within an element's current dimensions */
export function checkTextFit(el: LayoutElement): TextFitResult {
  const text = el.content ?? "";
  const style: TextStyle = el.textStyle ?? { fontSize: 14, lineHeight: DEFAULT_LINE_HEIGHT };

  const required = estimateLines(text, style, el.width);
  const available = linesAvailable(el.height, style);

  const lineHeightPx = style.fontSize * (style.lineHeight ?? DEFAULT_LINE_HEIGHT);
  const overflow = (required - available) * lineHeightPx;

  const fits =
    required <= available &&
    (style.maxLines === undefined || required <= style.maxLines);

  const suggestedHeight = fits ? undefined : Math.ceil(required * lineHeightPx);

  return {
    fits,
    linesRequired: required,
    linesAvailable: available,
    overflow: Math.max(0, overflow),
    suggestedHeight,
  };
}

/**
 * Find the largest font size that makes text fit within element dimensions.
 * Returns undefined if already fitting or impossible.
 */
export function shrinkFontToFit(
  el: LayoutElement,
  minFontSize = DEFAULT_MIN_FONT
): number | undefined {
  if (!el.textStyle || !el.content) return undefined;

  const text = el.content;
  const style = { ...el.textStyle };
  let fontSize = style.fontSize;

  while (fontSize >= minFontSize) {
    const testStyle = { ...style, fontSize };
    const required = estimateLines(text, testStyle, el.width);
    const available = linesAvailable(el.height, testStyle);
    if (required <= available) return fontSize;
    fontSize -= 1;
  }

  return undefined; // impossible to fit
}

/**
 * Find the minimum element height to contain all text at current font size.
 * Returns undefined if no text content.
 */
export function expandHeightToFit(el: LayoutElement): number | undefined {
  if (!el.textStyle || !el.content) return undefined;

  const style = el.textStyle;
  const required = estimateLines(el.content, style, el.width);
  return Math.ceil(heightForLines(required, style));
}

/**
 * Given text and a target height, find the font size that fills it best.
 * Used for "fill" text fitting (grow font to fill box).
 */
export function fitFontToHeight(
  el: LayoutElement,
  maxFontSize = DEFAULT_MAX_FONT
): number | undefined {
  if (!el.textStyle || !el.content) return undefined;

  const text = el.content;
  const style = { ...el.textStyle };

  for (let fontSize = maxFontSize; fontSize >= DEFAULT_MIN_FONT; fontSize--) {
    const testStyle = { ...style, fontSize };
    const required = estimateLines(text, testStyle, el.width);
    const available = linesAvailable(el.height, testStyle);
    if (required <= available) return fontSize;
  }

  return DEFAULT_MIN_FONT;
}
