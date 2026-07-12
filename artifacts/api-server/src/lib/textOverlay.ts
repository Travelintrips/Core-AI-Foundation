/**
 * textOverlay — bakes real, crisp vector text onto a generated background image.
 *
 * Sprint P2.1 fix: diffusion models (FLUX Schnell/Dev) cannot reliably render
 * legible brand names, taglines, or menu copy — they consistently produce
 * gibberish glyphs ("Kopii bumi", "opfiimy", garbled price lists). Rather than
 * fight the model with prompt engineering alone, roles that need legible text
 * generate a text-free background (see `noText` in imageDesignerService) and
 * this module composites the real copy on top using SVG + sharp, which never
 * misspells anything because it isn't hallucinating glyphs.
 */
import sharp from "sharp";

export interface OverlaySpec {
  kind: "brandName" | "brandTagline" | "menu";
  anchor?: "top" | "center" | "bottom";
  /** "dark" = dark translucent plate + light text (for busy/light photo backgrounds).
   * "light" = light translucent plate + dark text (for dark backgrounds). */
  theme?: "dark" | "light";
}

export interface OverlayContext {
  brandName: string;
  tagline?: string;
  menuItems?: { name: string; price: string }[];
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Deterministic, legible placeholder menu — never LLM/diffusion generated, so it
 * can never come out garbled. Enough variety to feel real across common demo
 * industries without claiming to be an actual client's menu. */
export function buildPlaceholderMenu(industry: string): { name: string; price: string }[] {
  const menus: Record<string, { name: string; price: string }[]> = {
    coffee: [
      { name: "Espresso", price: "Rp 22.000" },
      { name: "Cappuccino", price: "Rp 32.000" },
      { name: "Caramel Latte", price: "Rp 35.000" },
      { name: "Cold Brew", price: "Rp 30.000" },
      { name: "Croissant", price: "Rp 25.000" },
    ],
    food: [
      { name: "House Special Bowl", price: "Rp 45.000" },
      { name: "Grilled Chicken Set", price: "Rp 52.000" },
      { name: "Iced Lemon Tea", price: "Rp 18.000" },
      { name: "Signature Fries", price: "Rp 20.000" },
      { name: "Chef's Salad", price: "Rp 38.000" },
    ],
  };
  return menus[industry.toLowerCase()] ?? menus.food;
}

function plateColors(theme: "dark" | "light" = "dark") {
  return theme === "light"
    ? { plate: "rgba(255,255,255,0.88)", text: "#1a1a1a", sub: "#4a4a4a" }
    : { plate: "rgba(20,20,20,0.62)", text: "#ffffff", sub: "#e6e6e6" };
}

function buildSvg(width: number, height: number, spec: OverlaySpec, ctx: OverlayContext): string {
  const { theme = "dark", anchor = "bottom", kind } = spec;
  const c = plateColors(theme);
  const fontStack = "'Georgia', 'Times New Roman', serif";
  const sansStack = "'Helvetica Neue', Arial, sans-serif";

  if (kind === "menu") {
    const items = (ctx.menuItems ?? []).slice(0, 6);
    const panelW = Math.min(width * 0.62, 640);
    const panelH = 90 + items.length * 54 + 40;
    const x = (width - panelW) / 2;
    const y = (height - panelH) / 2;
    const rows = items
      .map((it, i) => {
        const ry = y + 100 + i * 54;
        return `
          <text x="${x + 32}" y="${ry}" font-family="${sansStack}" font-size="24" fill="${c.text}">${escapeXml(it.name)}</text>
          <text x="${x + panelW - 32}" y="${ry}" font-family="${sansStack}" font-size="24" fill="${c.sub}" text-anchor="end">${escapeXml(it.price)}</text>`;
      })
      .join("");
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${x}" y="${y}" width="${panelW}" height="${panelH}" rx="18" fill="${c.plate}" />
      <text x="${x + panelW / 2}" y="${y + 56}" font-family="${fontStack}" font-size="34" font-weight="bold" fill="${c.text}" text-anchor="middle">${escapeXml(ctx.brandName)}</text>
      ${rows}
    </svg>`;
  }

  // brandName / brandTagline: a plate anchored top/center/bottom with the name
  // (and optional tagline beneath it).
  const hasTagline = kind === "brandTagline" && ctx.tagline;
  const panelH = hasTagline ? 150 : 100;
  const panelW = Math.min(width * 0.72, 720);
  const x = (width - panelW) / 2;
  const y = anchor === "top" ? height * 0.08 : anchor === "center" ? (height - panelH) / 2 : height * 0.82 - panelH;

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${x}" y="${y}" width="${panelW}" height="${panelH}" rx="14" fill="${c.plate}" />
    <text x="${width / 2}" y="${y + (hasTagline ? 62 : 62)}" font-family="${fontStack}" font-size="42" font-weight="bold" fill="${c.text}" text-anchor="middle" letter-spacing="1">${escapeXml(ctx.brandName)}</text>
    ${hasTagline ? `<text x="${width / 2}" y="${y + 108}" font-family="${sansStack}" font-size="22" fill="${c.sub}" text-anchor="middle" font-style="italic">${escapeXml(ctx.tagline!)}</text>` : ""}
  </svg>`;
}

/**
 * Composites real vector text onto a generated background image. Returns the
 * final webp buffer. Never throws for text-rendering reasons — SVG text
 * can't come out gibberish, so the only failure mode is a malformed source
 * image, in which case the original buffer is returned unmodified.
 */
export async function applyTextOverlay(
  sourceBuffer: Buffer,
  spec: OverlaySpec,
  ctx: OverlayContext,
): Promise<Buffer> {
  try {
    const base = sharp(sourceBuffer);
    const metadata = await base.metadata();
    const width = metadata.width ?? 1024;
    const height = metadata.height ?? 1024;
    const svg = buildSvg(width, height, spec, ctx);
    return await base
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .webp({ quality: 90 })
      .toBuffer();
  } catch (err) {
    console.error("[textOverlay] Failed to composite overlay, using raw image:", err);
    return sourceBuffer;
  }
}
