/**
 * pdfLayoutHelpers.ts — Phase 2 Creative Document Engine
 *
 * Pure PDFKit rendering helpers. All functions receive the document instance
 * and mutate it in place. No DB calls, no network calls, no async operations.
 *
 * A4 portrait: 595.28 × 841.89 pts
 * Margin: 50 pts on all sides
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const PAGE_WIDTH    = 595.28;
export const PAGE_HEIGHT   = 841.89;
export const MARGIN        = 50;
export const USABLE_WIDTH  = PAGE_WIDTH - MARGIN * 2;
// Y position where we must break to a new page (leaves room for footer)
export const CONTENT_FLOOR = PAGE_HEIGHT - MARGIN - 50;

// ── Colour helpers ─────────────────────────────────────────────────────────────

/** Validate a hex colour string; return the input if valid, else fallback. */
export function safeHex(color: string | undefined, fallback: string): string {
  if (color && /^#[0-9A-Fa-f]{6}$/.test(color)) return color;
  return fallback;
}

// ── Theme ─────────────────────────────────────────────────────────────────────

export interface PdfTheme {
  primaryColor:   string; // e.g. "#1a365d"
  secondaryColor: string; // e.g. "#2d3748"
  accentColor:    string; // e.g. "#c05621"
}

export const DEFAULT_THEME: PdfTheme = {
  primaryColor:   "#1a365d",
  secondaryColor: "#2d3748",
  accentColor:    "#c05621",
};

// ── Doc type alias ─────────────────────────────────────────────────────────────

// PDFKit is loaded dynamically in creativeDocumentService. These helpers
// accept the doc instance typed broadly so they stay free of a hard import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PDFDoc = any;

// ── Page space guard ──────────────────────────────────────────────────────────

/**
 * If fewer than `neededPts` points remain before the footer zone,
 * add a new page and reset the cursor to the top margin.
 */
export function ensurePageSpace(doc: PDFDoc, neededPts: number): void {
  if (doc.y + neededPts > CONTENT_FLOOR) {
    doc.addPage();
    doc.y = MARGIN;
  }
}

// ── Cover page ────────────────────────────────────────────────────────────────

export interface CoverSpec {
  companyName: string;
  tagline?: string;
  subtitle?: string;
  imageBuffer?: Buffer | null;
  theme: PdfTheme;
}

export function renderCoverPage(doc: PDFDoc, spec: CoverSpec): void {
  const { companyName, tagline, subtitle, imageBuffer, theme } = spec;

  // Dark full-page background
  doc
    .rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
    .fill(theme.primaryColor);

  // Cover image — full bleed, behind text, with overlay
  if (imageBuffer) {
    try {
      doc.image(imageBuffer, 0, 0, { width: PAGE_WIDTH, height: PAGE_HEIGHT });
      // Semi-transparent overlay to keep text readable
      doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).opacity(0.65).fill(theme.primaryColor).opacity(1);
    } catch {
      // Image failed to render — continue with plain background
    }
  }

  // Accent bar (left edge)
  doc.rect(0, 0, 8, PAGE_HEIGHT).fill(theme.accentColor);

  // "COMPANY PROFILE" label badge
  const badgeY = 220;
  const badgeText = "COMPANY PROFILE";
  doc.font("Helvetica-Bold").fontSize(10).fillColor(theme.accentColor);
  doc.text(badgeText, MARGIN + 16, badgeY, { characterSpacing: 3 });

  // Divider line under badge
  doc
    .moveTo(MARGIN + 16, badgeY + 20)
    .lineTo(MARGIN + 16 + 60, badgeY + 20)
    .lineWidth(2)
    .strokeColor(theme.accentColor)
    .stroke();

  // Company name
  doc
    .font("Helvetica-Bold")
    .fontSize(36)
    .fillColor("#ffffff")
    .text(companyName, MARGIN + 16, badgeY + 38, {
      width: USABLE_WIDTH - 16,
      lineGap: 4,
    });

  const afterName = doc.y + 16;

  // Tagline
  if (tagline) {
    doc
      .font("Helvetica-Oblique")
      .fontSize(14)
      .fillColor("rgba(255,255,255,0.8)")
      .text(tagline, MARGIN + 16, afterName, { width: USABLE_WIDTH - 16 });
  }

  // Subtitle / document description
  if (subtitle) {
    const subY = doc.y + 8;
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor("rgba(255,255,255,0.65)")
      .text(subtitle, MARGIN + 16, subY, { width: USABLE_WIDTH - 16 });
  }

  // Year in bottom right
  const year = new Date().getFullYear().toString();
  doc
    .font("Helvetica")
    .fontSize(11)
    .fillColor("rgba(255,255,255,0.5)")
    .text(year, MARGIN, PAGE_HEIGHT - MARGIN - 30, {
      width: USABLE_WIDTH,
      align: "right",
    });
}

// ── Section heading ───────────────────────────────────────────────────────────

export function renderSectionHeading(
  doc: PDFDoc,
  title: string,
  subtitle: string | undefined,
  theme: PdfTheme,
): void {
  ensurePageSpace(doc, 80);

  // Left accent bar
  const barHeight = subtitle ? 54 : 36;
  doc.rect(MARGIN, doc.y, 4, barHeight).fill(theme.accentColor);

  // Heading title
  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor(theme.primaryColor)
    .text(title, MARGIN + 14, doc.y, { width: USABLE_WIDTH - 14 });

  if (subtitle) {
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor(theme.secondaryColor)
      .text(subtitle, MARGIN + 14, doc.y + 2, { width: USABLE_WIDTH - 14 });
  }

  doc.moveDown(0.8);
}

// ── Paragraph ─────────────────────────────────────────────────────────────────

export function renderParagraph(doc: PDFDoc, text: string): void {
  if (!text.trim()) return;
  ensurePageSpace(doc, 60);
  doc
    .font("Helvetica")
    .fontSize(11)
    .fillColor("#333333")
    .text(text, MARGIN, doc.y, {
      width: USABLE_WIDTH,
      align: "justify",
      lineGap: 3,
    });
  doc.moveDown(0.6);
}

// ── Bullet list ───────────────────────────────────────────────────────────────

export function renderBullets(doc: PDFDoc, items: string[], theme: PdfTheme): void {
  if (items.length === 0) return;
  ensurePageSpace(doc, 30 + items.length * 20);
  for (const item of items) {
    if (!item.trim()) continue;
    ensurePageSpace(doc, 22);
    const bulletY = doc.y;
    // Coloured bullet dot
    doc.circle(MARGIN + 5, bulletY + 5, 3).fill(theme.accentColor);
    // Item text (indented)
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor("#333333")
      .text(item, MARGIN + 16, bulletY, {
        width: USABLE_WIDTH - 16,
        lineGap: 2,
      });
    doc.y = doc.y + 4;
  }
  doc.moveDown(0.5);
}

// ── Image block ───────────────────────────────────────────────────────────────

export function renderImageBlock(
  doc: PDFDoc,
  imageBuffer: Buffer,
  caption?: string,
  _alt?: string,
): void {
  const maxWidth  = USABLE_WIDTH;
  const maxHeight = 260;
  ensurePageSpace(doc, maxHeight + 30);

  try {
    doc.image(imageBuffer, MARGIN, doc.y, {
      fit: [maxWidth, maxHeight],
      align: "center",
    });
    // Advance Y to just below the image
    doc.y = doc.y + maxHeight + 8;
  } catch {
    // Image decode failure — skip silently; caller records in report
    return;
  }

  if (caption) {
    doc
      .font("Helvetica-Oblique")
      .fontSize(9)
      .fillColor("#666666")
      .text(caption, MARGIN, doc.y, { width: USABLE_WIDTH, align: "center" });
    doc.moveDown(0.5);
  }
}

// ── Table ─────────────────────────────────────────────────────────────────────

export function renderTable(
  doc: PDFDoc,
  headers: string[],
  rows: string[][],
  theme: PdfTheme,
): void {
  if (headers.length === 0) return;
  const colWidth = USABLE_WIDTH / headers.length;
  const rowHeight = 24;
  const headerHeight = 28;

  ensurePageSpace(doc, headerHeight + rows.length * rowHeight + 10);

  let startY = doc.y;

  // Header row background
  doc.rect(MARGIN, startY, USABLE_WIDTH, headerHeight).fill(theme.primaryColor);
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#ffffff");
  for (let i = 0; i < headers.length; i++) {
    doc.text(
      headers[i] ?? "",
      MARGIN + i * colWidth + 6,
      startY + 8,
      { width: colWidth - 12, lineBreak: false },
    );
  }

  startY += headerHeight;

  // Data rows
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const bg = r % 2 === 0 ? "#f7f8f9" : "#ffffff";
    doc.rect(MARGIN, startY, USABLE_WIDTH, rowHeight).fill(bg);
    doc.font("Helvetica").fontSize(10).fillColor("#333333");
    for (let c = 0; c < headers.length; c++) {
      doc.text(
        row[c] ?? "",
        MARGIN + c * colWidth + 6,
        startY + 7,
        { width: colWidth - 12, lineBreak: false },
      );
    }
    startY += rowHeight;
  }

  // Border
  doc
    .rect(MARGIN, doc.y, USABLE_WIDTH, startY - doc.y)
    .lineWidth(0.5)
    .strokeColor("#dddddd")
    .stroke();

  doc.y = startY + 8;
  doc.moveDown(0.5);
}

// ── Key metrics cards ─────────────────────────────────────────────────────────

export function renderKeyMetrics(
  doc: PDFDoc,
  items: Array<{ label: string; value: string }>,
  theme: PdfTheme,
): void {
  if (items.length === 0) return;
  const cardWidth  = Math.floor(USABLE_WIDTH / Math.min(items.length, 3)) - 8;
  const cardHeight = 60;
  ensurePageSpace(doc, cardHeight + 20);

  const startY = doc.y;
  let col = 0;

  for (const item of items.slice(0, 6)) {
    const x = MARGIN + col * (cardWidth + 8);
    if (col > 0 && col % 3 === 0) {
      doc.y = startY + cardHeight + 12;
      col = 0;
    }

    // Card background
    doc.rect(x, startY, cardWidth, cardHeight).fill(theme.primaryColor);

    // Value
    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .fillColor("#ffffff")
      .text(item.value, x + 10, startY + 10, {
        width: cardWidth - 20,
        lineBreak: false,
      });

    // Label
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("rgba(255,255,255,0.75)")
      .text(item.label, x + 10, startY + 36, {
        width: cardWidth - 20,
        lineBreak: false,
      });

    col++;
  }

  doc.y = startY + cardHeight + 16;
}

// ── Quote block ───────────────────────────────────────────────────────────────

export function renderQuote(
  doc: PDFDoc,
  text: string,
  attribution?: string,
  theme?: PdfTheme,
): void {
  ensurePageSpace(doc, 70);
  const accent = theme?.accentColor ?? "#c05621";
  const startY = doc.y;

  // Left bar
  doc.rect(MARGIN, startY, 4, 50).fill(accent);

  doc
    .font("Helvetica-Oblique")
    .fontSize(13)
    .fillColor("#333333")
    .text(`"${text}"`, MARGIN + 16, startY, { width: USABLE_WIDTH - 20 });

  if (attribution) {
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#666666")
      .text(`— ${attribution}`, MARGIN + 16, doc.y + 4, {
        width: USABLE_WIDTH - 20,
      });
  }
  doc.moveDown(0.8);
}

// ── Closing page ──────────────────────────────────────────────────────────────

export function renderClosingPage(
  doc: PDFDoc,
  companyName: string,
  closingText: string,
  contactText: string,
  theme: PdfTheme,
): void {
  doc.addPage();

  // Background
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fill(theme.primaryColor);
  doc.rect(0, 0, 8, PAGE_HEIGHT).fill(theme.accentColor);

  const midY = PAGE_HEIGHT / 2 - 60;

  doc
    .font("Helvetica-Bold")
    .fontSize(28)
    .fillColor("#ffffff")
    .text(companyName, MARGIN + 16, midY, {
      width: USABLE_WIDTH - 16,
      align: "center",
    });

  if (closingText) {
    doc
      .font("Helvetica")
      .fontSize(13)
      .fillColor("rgba(255,255,255,0.8)")
      .text(closingText, MARGIN + 16, doc.y + 16, {
        width: USABLE_WIDTH - 16,
        align: "center",
      });
  }

  if (contactText) {
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("rgba(255,255,255,0.6)")
      .text(contactText, MARGIN + 16, PAGE_HEIGHT - MARGIN - 60, {
        width: USABLE_WIDTH - 16,
        align: "center",
      });
  }
}

// ── Section divider ───────────────────────────────────────────────────────────

export function renderDivider(doc: PDFDoc, theme: PdfTheme): void {
  ensurePageSpace(doc, 20);
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(MARGIN + USABLE_WIDTH, doc.y)
    .lineWidth(0.5)
    .strokeColor(theme.accentColor + "44")
    .stroke();
  doc.moveDown(0.5);
}

// ── Footer on all pages ───────────────────────────────────────────────────────

/**
 * Called after all content pages are rendered (but before doc.flushPages()).
 * Iterates all buffered pages and adds a consistent footer with page number.
 * Skips the cover page (page index 0).
 */
export function renderAllFooters(
  doc: PDFDoc,
  footerText: string,
  theme: PdfTheme,
): void {
  const range = doc.bufferedPageRange();
  const totalPages = range.count;

  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);

    if (i === 0) {
      // Cover page: no standard footer
      continue;
    }

    const footerY = PAGE_HEIGHT - MARGIN + 10;

    // Footer separator line
    doc
      .moveTo(MARGIN, footerY - 6)
      .lineTo(PAGE_WIDTH - MARGIN, footerY - 6)
      .lineWidth(0.5)
      .strokeColor(theme.primaryColor + "33")
      .stroke();

    // Footer text (company name / document title)
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#999999")
      .text(footerText, MARGIN, footerY, {
        width: USABLE_WIDTH - 60,
        align: "left",
        lineBreak: false,
      });

    // Page number (right side)
    const pageLabel = `${i} / ${totalPages - 1}`; // don't count cover page
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#999999")
      .text(pageLabel, PAGE_WIDTH - MARGIN - 60, footerY, {
        width: 60,
        align: "right",
        lineBreak: false,
      });
  }
}

// ── Page header bar ───────────────────────────────────────────────────────────

/**
 * Thin coloured bar at the top of content pages (not the cover).
 * Call immediately after `doc.addPage()`.
 */
export function renderPageHeader(doc: PDFDoc, companyName: string, theme: PdfTheme): void {
  doc.rect(0, 0, PAGE_WIDTH, 6).fill(theme.primaryColor);
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(theme.secondaryColor + "88")
    .text(companyName.toUpperCase(), MARGIN, 14, {
      width: USABLE_WIDTH,
      align: "right",
      characterSpacing: 1,
    });
  doc.y = MARGIN + 10;
}
