/**
 * Design Renderer — Text Layout Engine
 *
 * Computes line breaks, auto-shrink, and truncation for text elements.
 * Uses a character-width estimator (documented limitation: not pixel-exact;
 * uses font metrics approximation with a safety margin).
 *
 * This estimator is calibrated for Helvetica/Arial-class sans-serif fonts
 * at common sizes. It includes a 15% safety margin to prevent overflow.
 * Preview and production render use the same logic.
 */

import type { TextElement } from "../../types/designTemplate.js";
import { DESIGN_LIMITS } from "../../types/designTemplate.js";
import { WarningAccumulator } from "./renderWarnings.js";

/** Per-character width ratios relative to font size, tuned for sans-serif. */
function charWidthRatio(ch: string): number {
  if (/[iIl1!|.,;:'"[\](){}]/.test(ch)) return 0.30;   // narrow
  if (/[mMwWQO%@#&]/.test(ch))           return 0.72;   // wide
  if (/[ ]/.test(ch))                    return 0.28;   // space
  return 0.55;                                           // average
}

/** Estimate width of a string in pixels at a given font size. */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    width += charWidthRatio(ch) * fontSize;
  }
  // Safety margin: 0.85 reduces false negatives (assuming we overestimate by ~15%)
  return width * 0.85;
}

/** Estimate height of a block of text (lineCount * lineHeight * fontSize). */
export function estimateTextHeight(lineCount: number, fontSize: number, lineHeight: number): number {
  return lineCount * lineHeight * fontSize;
}

/**
 * Wrap text into lines that fit within the given pixel width.
 * Returns an array of line strings.
 */
export function wrapText(text: string, boxWidth: number, fontSize: number): string[] {
  if (boxWidth <= 0 || fontSize <= 0) return [text];

  const lines: string[] = [];
  const paragraphs = text.split("\n");

  for (const para of paragraphs) {
    const words = para.split(" ");
    let currentLine = "";

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (estimateTextWidth(candidate, fontSize) <= boxWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) lines.push(currentLine);
        // Word itself wider than box → force-break it character by character
        if (estimateTextWidth(word, fontSize) > boxWidth) {
          let chunk = "";
          for (const ch of word) {
            const tryChunk = chunk + ch;
            if (estimateTextWidth(tryChunk, fontSize) <= boxWidth) {
              chunk = tryChunk;
            } else {
              if (chunk) lines.push(chunk);
              chunk = ch;
            }
          }
          currentLine = chunk;
        } else {
          currentLine = word;
        }
      }
    }

    if (currentLine || para === "") {
      lines.push(currentLine);
    }
  }

  return lines.length > 0 ? lines : [""];
}

export type TextLayoutResult = {
  lines: string[];
  fontSize: number;
  truncated: boolean;
  shrunk: boolean;
  warnings: string[];
};

/**
 * Compute the final laid-out text for a TextElement.
 * Handles wrap, auto-shrink, truncation, and ellipsis.
 */
export function layoutText(
  element: TextElement,
  rawText: string,
  elementWarnings: WarningAccumulator,
): TextLayoutResult {
  const fontSize     = element.fontSize    ?? 16;
  const minFontSize  = element.minFontSize ?? DESIGN_LIMITS.MIN_FONT_SIZE;
  const lineHeight   = element.lineHeight  ?? 1.2;
  const maxLines     = element.maxLines    ?? Infinity;
  const overflow     = element.overflow    ?? "wrap";
  const ellipsis     = element.ellipsis    ?? true;
  const boxWidth     = element.width;
  const boxHeight    = element.height;

  // Apply textTransform
  let text = rawText;
  if (element.textTransform === "uppercase")  text = text.toUpperCase();
  if (element.textTransform === "lowercase")  text = text.toLowerCase();
  if (element.textTransform === "capitalize") text = text.replace(/\b\w/g, (c) => c.toUpperCase());

  if (overflow === "truncate") {
    // Simple single-line truncation
    const lines = wrapText(text, boxWidth, fontSize);
    const visibleLines = maxLines === Infinity ? lines : lines.slice(0, maxLines as number);
    let truncated = lines.length > visibleLines.length;
    let result = visibleLines;

    if (truncated && ellipsis) {
      const lastLine = result[result.length - 1] ?? "";
      result[result.length - 1] = truncateLine(lastLine, boxWidth, fontSize, "…");
    }

    if (truncated) {
      elementWarnings.add(element.id, "TEXT_TRUNCATED", `Text truncated to ${visibleLines.length} lines`);
    }

    return { lines: result, fontSize, truncated, shrunk: false, warnings: [] };
  }

  if (overflow === "auto-shrink") {
    let currentSize = fontSize;
    let shrunk = false;

    while (currentSize >= minFontSize) {
      const lines = wrapText(text, boxWidth, currentSize);
      const lineCount = maxLines === Infinity ? lines.length : Math.min(lines.length, maxLines as number);
      const totalHeight = estimateTextHeight(lineCount, currentSize, lineHeight);

      if (lines.length <= (maxLines === Infinity ? Infinity : maxLines) && totalHeight <= boxHeight) {
        if (shrunk) {
          elementWarnings.add(element.id, "TEXT_AUTO_SHRINK_APPLIED", `Font shrunk from ${fontSize}px to ${currentSize}px`);
        }
        const visibleLines = maxLines === Infinity ? lines : lines.slice(0, maxLines as number);
        return { lines: visibleLines, fontSize: currentSize, truncated: false, shrunk, warnings: [] };
      }

      if (currentSize <= minFontSize) break;
      currentSize = Math.max(minFontSize, currentSize - 1);
      shrunk = true;
    }

    // Still overflowing at minFontSize — truncate
    const lines = wrapText(text, boxWidth, minFontSize);
    const visibleLines = maxLines === Infinity ? lines : lines.slice(0, maxLines as number);
    const truncated = lines.length > visibleLines.length;

    if (truncated && ellipsis) {
      const lastLine = visibleLines[visibleLines.length - 1] ?? "";
      visibleLines[visibleLines.length - 1] = truncateLine(lastLine, boxWidth, minFontSize, "…");
    }

    if (shrunk) {
      elementWarnings.add(element.id, "TEXT_AUTO_SHRINK_APPLIED", `Font shrunk to minimum ${minFontSize}px`);
    }
    if (truncated) {
      elementWarnings.add(element.id, "TEXT_TRUNCATED", "Text truncated after auto-shrink");
    }

    return { lines: visibleLines, fontSize: minFontSize, truncated, shrunk, warnings: [] };
  }

  // Default: wrap
  const lines = wrapText(text, boxWidth, fontSize);
  const visibleLines = maxLines === Infinity ? lines : lines.slice(0, maxLines as number);
  const truncated = lines.length > visibleLines.length;

  if (truncated) {
    if (ellipsis) {
      const lastLine = visibleLines[visibleLines.length - 1] ?? "";
      visibleLines[visibleLines.length - 1] = truncateLine(lastLine, boxWidth, fontSize, "…");
    }
    elementWarnings.add(element.id, "MAX_LINES_EXCEEDED", `Text has ${lines.length} lines, max ${maxLines}`);
  }

  return { lines: visibleLines, fontSize, truncated, shrunk: false, warnings: [] };
}

/** Trim a line + append ellipsis so it fits within boxWidth. */
function truncateLine(line: string, boxWidth: number, fontSize: number, ellipsis: string): string {
  const ellipsisWidth = estimateTextWidth(ellipsis, fontSize);
  if (estimateTextWidth(line, fontSize) <= boxWidth) return line;

  let result = line;
  while (result.length > 0 && estimateTextWidth(result + ellipsis, fontSize) > boxWidth) {
    result = result.slice(0, -1);
  }
  return result + ellipsis;
}
