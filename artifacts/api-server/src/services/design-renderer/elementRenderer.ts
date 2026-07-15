/**
 * Design Renderer — Per-Element SVG Generation
 *
 * Converts resolved DesignElement objects into SVG markup strings.
 * All values are already resolved (variables expanded, assets loaded as data URIs).
 * Security rules: all string content is XML-escaped before injection.
 */

import QRCode from "qrcode";
import { RenderError } from "./errors.js";
import { WarningAccumulator } from "./renderWarnings.js";
import { resolveFont, safeFontFamily } from "./fontRegistry.js";
import { layoutText } from "./textLayout.js";
import type {
  DesignElement,
  TextElement,
  ImageElement,
  ShapeElement,
  QrCodeElement,
  LineElement,
  GroupElement,
  LinearGradient,
  Shadow,
  Border,
} from "../../types/designTemplate.js";
import { DESIGN_LIMITS } from "../../types/designTemplate.js";

// ── XML Escaping ──────────────────────────────────────────────────────────────

/** Escape a string for safe embedding in SVG XML text content or attributes. */
export function xmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Sanitise a color value for SVG attribute injection. */
function safeColor(color: string | undefined, fallback = "#000000"): string {
  if (!color) return fallback;
  // Only allow #hex, rgb(), rgba() — reject anything else
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  if (/^rgba?\([\d.,\s%]+\)$/.test(color)) return color;
  return fallback;
}

/** Sanitise a number for SVG — prevent NaN/Infinity. */
function safeNum(n: number | undefined, fallback = 0): number {
  if (n === undefined || !Number.isFinite(n)) return fallback;
  return n;
}

// ── Rotation Transform ────────────────────────────────────────────────────────

/** SVG transform that rotates around the center of an element. */
function rotationTransform(el: DesignElement): string {
  const deg = safeNum(el.rotation, 0);
  if (deg === 0) return "";
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  return ` transform="rotate(${deg}, ${cx}, ${cy})"`;
}

/** Build an SVG <g> wrapper with opacity and rotation. */
function elementGroup(el: DesignElement, inner: string): string {
  const opacity = el.opacity !== undefined ? ` opacity="${safeNum(el.opacity, 1)}"` : "";
  const rotate = rotationTransform(el);
  if (!opacity && !rotate) return inner;
  return `<g${opacity}${rotate}>${inner}</g>`;
}

// ── Gradient ──────────────────────────────────────────────────────────────────

let _gradientSeq = 0;

function buildLinearGradient(grad: LinearGradient, id: string): string {
  const angleRad = (grad.angle * Math.PI) / 180;
  const x1 = 50 - 50 * Math.cos(angleRad + Math.PI / 2);
  const y1 = 50 - 50 * Math.sin(angleRad + Math.PI / 2);
  const x2 = 50 + 50 * Math.cos(angleRad + Math.PI / 2);
  const y2 = 50 + 50 * Math.sin(angleRad + Math.PI / 2);
  const stops = grad.stops
    .map((s) => `<stop offset="${s.offset}" stop-color="${xmlEscape(safeColor(s.color))}"/>`)
    .join("");
  return `<linearGradient id="${id}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%" gradientUnits="userSpaceOnUse">${stops}</linearGradient>`;
}

// ── Shadow filter ─────────────────────────────────────────────────────────────

function buildShadowFilter(shadow: Shadow, id: string): string {
  return `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="${shadow.offsetX}" dy="${shadow.offsetY}" stdDeviation="${Math.max(0, shadow.blur / 2)}" flood-color="${xmlEscape(safeColor(shadow.color, "rgba(0,0,0,0.3)"))}"/>
  </filter>`;
}

// ── Shape ─────────────────────────────────────────────────────────────────────

export function renderShape(
  el: ShapeElement,
  defs: string[],
): string {
  const { x, y, width, height } = el;
  const fill = el.fill;
  let fillAttr: string;
  let defId: string | undefined;

  if (typeof fill === "object" && fill && fill.type === "linear") {
    defId = `grad-${++_gradientSeq}`;
    defs.push(buildLinearGradient(fill, defId));
    fillAttr = `url(#${defId})`;
  } else {
    fillAttr = safeColor(typeof fill === "string" ? fill : undefined, "transparent");
  }

  let filterId: string | undefined;
  if (el.shadow) {
    filterId = `shadow-${++_gradientSeq}`;
    defs.push(buildShadowFilter(el.shadow, filterId));
  }

  const filterAttr = filterId ? ` filter="url(#${filterId})"` : "";

  let strokeAttr = "";
  if (el.border) {
    const b = el.border;
    strokeAttr = ` stroke="${xmlEscape(safeColor(b.color))}" stroke-width="${safeNum(b.width, 1)}"`;
    if (b.style === "dashed") strokeAttr += ` stroke-dasharray="8,4"`;
    if (b.style === "dotted") strokeAttr += ` stroke-dasharray="2,4"`;
  }

  let shape: string;
  if (el.shape === "circle") {
    const r = Math.min(width, height) / 2;
    const cx = x + width / 2;
    const cy = y + height / 2;
    shape = `<ellipse cx="${cx}" cy="${cy}" rx="${width / 2}" ry="${height / 2}" fill="${xmlEscape(fillAttr)}"${strokeAttr}${filterAttr}/>`;
  } else if (el.shape === "rounded-rectangle") {
    const rx = Math.min(safeNum(el.borderRadius, 8), Math.min(width, height) / 2);
    shape = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" ry="${rx}" fill="${xmlEscape(fillAttr)}"${strokeAttr}${filterAttr}/>`;
  } else {
    // rectangle
    shape = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${xmlEscape(fillAttr)}"${strokeAttr}${filterAttr}/>`;
  }

  return elementGroup(el, shape);
}

// ── Text ──────────────────────────────────────────────────────────────────────

export function renderText(
  el: TextElement,
  resolvedText: string,
  warnings: WarningAccumulator,
): string {
  const { x, y, width, height } = el;
  const { fontFamily, isFallback } = resolveFont(el.fontFamily);

  if (isFallback && el.fontFamily) {
    warnings.add(el.id, "FONT_FALLBACK_USED", `Font "${el.fontFamily}" not available, using ${fontFamily}`);
  }

  const layout = layoutText(el, resolvedText, warnings);
  const fontSize = layout.fontSize;
  const color = safeColor(el.color, "#000000");
  const lineHeight = (el.lineHeight ?? 1.2) * fontSize;
  const textAlign = el.textAlign ?? "left";
  const weight = el.fontWeight ?? "normal";
  const fontStyle = el.italic ? "italic" : "normal";
  const letterSpacing = el.letterSpacing ? ` letter-spacing="${safeNum(el.letterSpacing)}"` : "";
  const decoration = el.underline ? ` text-decoration="underline"` : "";

  // X anchor based on alignment
  let textAnchor: string;
  let textX: number;
  if (textAlign === "center") {
    textAnchor = "middle";
    textX = x + width / 2;
  } else if (textAlign === "right") {
    textAnchor = "end";
    textX = x + width;
  } else {
    textAnchor = "start";
    textX = x;
  }

  // Clip text to element bounding box
  const clipId = `clip-text-${el.id.replace(/[^a-zA-Z0-9]/g, "-")}`;

  const tspans = layout.lines.map((line, i) => {
    const dy = i === 0 ? fontSize : lineHeight;
    return `<tspan x="${textX}" dy="${dy}"${letterSpacing}>${xmlEscape(line)}</tspan>`;
  });

  const inner = `
<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}"/></clipPath>
<text
  font-family="${xmlEscape(safeFontFamily(fontFamily))}"
  font-size="${fontSize}"
  font-weight="${weight}"
  font-style="${fontStyle}"
  fill="${xmlEscape(color)}"
  text-anchor="${textAnchor}"${decoration}
  clip-path="url(#${clipId})"
  x="${textX}" y="${y}"
>${tspans.join("")}</text>`;

  return elementGroup(el, inner);
}

// ── Image ─────────────────────────────────────────────────────────────────────

export function renderImage(
  el: ImageElement,
  resolvedDataUri: string | null,
  warnings: WarningAccumulator,
): string {
  const { x, y, width, height } = el;

  if (!resolvedDataUri) {
    warnings.add(el.id, "IMAGE_FALLBACK_USED", "Image missing — rendered as empty rectangle");
    // Render a placeholder rectangle
    return elementGroup(el, `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#e5e7eb" stroke="#d1d5db" stroke-width="1"/>`);
  }

  const objectFit = el.objectFit ?? "cover";
  const clipId    = `clip-img-${el.id.replace(/[^a-zA-Z0-9]/g, "-")}`;
  const rx = el.borderRadius ? Math.min(safeNum(el.borderRadius), Math.min(width, height) / 2) : 0;
  const clipShape = rx > 0
    ? `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" ry="${rx}"/>`
    : `<rect x="${x}" y="${y}" width="${width}" height="${height}"/>`;

  // For cover/contain we need to know the image's natural size — since we only
  // have the buffer, we'll use SVG preserveAspectRatio which achieves the same.
  let preserveAspectRatio: string;
  if (objectFit === "cover")   preserveAspectRatio = "xMidYMid slice";
  else if (objectFit === "contain") preserveAspectRatio = "xMidYMid meet";
  else preserveAspectRatio = "none"; // fill — stretch

  const inner = `
<clipPath id="${clipId}">${clipShape}</clipPath>
<image
  x="${x}" y="${y}"
  width="${width}" height="${height}"
  href="${xmlEscape(resolvedDataUri)}"
  preserveAspectRatio="${preserveAspectRatio}"
  clip-path="url(#${clipId})"
/>`;

  return elementGroup(el, inner);
}

// ── QR Code ───────────────────────────────────────────────────────────────────

export async function renderQrCode(
  el: QrCodeElement,
  resolvedContent: string,
  warnings: WarningAccumulator,
): Promise<string> {
  const { x, y, width, height } = el;

  if (resolvedContent.length > DESIGN_LIMITS.MAX_QR_CONTENT_LENGTH) {
    throw new RenderError("QR_DATA_INVALID", `QR content exceeds max length (${resolvedContent.length} > ${DESIGN_LIMITS.MAX_QR_CONTENT_LENGTH})`);
  }
  if (resolvedContent.trim().length === 0) {
    throw new RenderError("QR_DATA_INVALID", "QR content is empty");
  }

  const errorLevel = el.errorLevel ?? "M";
  const fgColor    = safeColor(el.fgColor, "#000000");
  const bgColor    = safeColor(el.bgColor, "#ffffff");

  // Generate QR as PNG buffer, embed as data URI in SVG <image>
  let pngBuffer: Buffer;
  try {
    pngBuffer = await QRCode.toBuffer(resolvedContent, {
      type: "png",
      errorCorrectionLevel: errorLevel,
      color: { dark: fgColor, light: bgColor },
      width: Math.max(width, height),
      margin: 1,
    });
  } catch (err) {
    throw new RenderError("QR_DATA_INVALID", `QR generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const dataUri = `data:image/png;base64,${pngBuffer.toString("base64")}`;
  const clipId  = `clip-qr-${el.id.replace(/[^a-zA-Z0-9]/g, "-")}`;

  const inner = `
<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}"/></clipPath>
<image x="${x}" y="${y}" width="${width}" height="${height}" href="${xmlEscape(dataUri)}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid meet"/>`;

  return elementGroup(el, inner);
}

// ── Line ──────────────────────────────────────────────────────────────────────

export function renderLine(el: LineElement): string {
  const { x, y, width, height } = el;
  const stroke      = safeColor(el.stroke, "#000000");
  const strokeWidth = safeNum(el.strokeWidth, 1);
  let dashAttr      = "";
  if (el.dashArray && el.dashArray.length > 0) {
    dashAttr = ` stroke-dasharray="${el.dashArray.map(safeNum).join(",")}"`;
  }
  // Line drawn from (x,y) to (x+width, y+height) — covers diagonal and straight lines
  const inner = `<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y + height}" stroke="${xmlEscape(stroke)}" stroke-width="${strokeWidth}"${dashAttr}/>`;
  return elementGroup(el, inner);
}

// ── Group (depth-limited) ─────────────────────────────────────────────────────

const MAX_GROUP_DEPTH = 4;

export async function renderGroup(
  el: GroupElement,
  resolvedImages: Map<string, string | null>,
  warnings: WarningAccumulator,
  depth = 0,
): Promise<string> {
  if (depth >= MAX_GROUP_DEPTH) {
    warnings.add(el.id, "ELEMENT_SKIPPED", "Group nesting too deep — flattened");
    return "";
  }

  const childSvgs: string[] = [];
  const sortedChildren = [...el.children].sort((a, b) => a.zIndex - b.zIndex);
  const defs: string[] = [];

  for (const child of sortedChildren) {
    const svg = await renderElement(child, resolvedImages, warnings, defs, depth + 1);
    childSvgs.push(svg);
  }

  const inner = `<g>${childSvgs.join("")}</g>`;
  return elementGroup(el, inner);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export async function renderElement(
  el: DesignElement,
  resolvedImages: Map<string, string | null>,
  warnings: WarningAccumulator,
  defs: string[],
  depth = 0,
): Promise<string> {
  // Visibility
  if (el.visible === false) return "";

  switch (el.type) {
    case "shape":
      return renderShape(el, defs);

    case "text": {
      const rawText =
        typeof el.content === "string"
          ? el.content
          : (resolvedImages.get(`__text__${el.id}`) ?? "");
      return renderText(el, rawText, warnings);
    }

    case "image": {
      const dataUri = resolvedImages.get(el.id) ?? null;
      return renderImage(el, dataUri, warnings);
    }

    case "qrcode": {
      const content = resolvedImages.get(`__qr__${el.id}`) ?? "";
      return renderQrCode(el, content, warnings);
    }

    case "line":
      return renderLine(el);

    case "group":
      return renderGroup(el, resolvedImages, warnings, depth);

    case "icon":
      // Icon registry not implemented in Phase 2 — render placeholder
      warnings.add(el.id, "ELEMENT_SKIPPED", `Icon "${el.iconName}" not rendered (Phase 3)`);
      return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="none" stroke="#999" stroke-width="1" stroke-dasharray="4,2"/>`;

    default:
      warnings.add((el as any).id ?? "unknown", "ELEMENT_SKIPPED", `Unknown element type`);
      return "";
  }
}
