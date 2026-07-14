/**
 * presentationRenderService.ts — Phase 4 Presentation Engine
 *
 * Renders a CreativePresentationSpec to a real, editable PPTX Buffer using
 * pptxgenjs. Layouts are reusable render*Slide() functions shared across all
 * slide kinds — no per-deck one-off layout code.
 *
 * Text overflow protection (presentationOverflowService.ts) is applied before
 * any text reaches pptxgenjs so slides never render with clipped/overflowing
 * text and never rely on shrinking fonts below MIN_BODY_FONT_SIZE.
 */

import PptxGenJSImport from "pptxgenjs";

// pptxgenjs ships a CJS build; under ESM (tsx / ts-node / some bundlers) the
// default export can arrive wrapped as `{ default: PptxGenJS }` instead of the
// constructor itself, depending on the interop mode. Normalize both shapes so
// rendering works identically in dev (tsx) and in the esbuild-bundled server.
const PptxGenJS: typeof PptxGenJSImport =
  (PptxGenJSImport as unknown as { default?: typeof PptxGenJSImport }).default ?? PptxGenJSImport;
import {
  fitBulletsToBox,
  fitTextToBox,
  splitContentAcrossSlides,
  MIN_BODY_FONT_SIZE,
} from "./presentationOverflowService.js";
import type {
  CreativePresentationSpec,
  PresentationSlideSpec,
  PresentationTheme,
  SlideMetric,
  SlideTimelineItem,
  SlideComparisonRow,
} from "./presentationTypes.js";

// 16:9 widescreen in inches (pptxgenjs LAYOUT_WIDE)
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MARGIN = 0.6;

export class PresentationRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PresentationRenderError";
  }
}

export interface PresentationRenderResult {
  buffer: Buffer;
  slideCount: number;
  renderDurationMs: number;
  continuationSlidesCreated: number;
}

function footerText(spec: CreativePresentationSpec): string {
  return spec.companyName ? `${spec.companyName} — ${spec.title}` : spec.title;
}

function addFooter(slide: PptxGenJS.Slide, theme: PresentationTheme, footer: string, pageNumber: number) {
  slide.addText(footer, {
    x: MARGIN, y: SLIDE_H - 0.4, w: SLIDE_W - MARGIN * 2 - 0.8, h: 0.3,
    fontSize: 8, color: theme.mutedTextColor.replace("#", ""), align: "left",
  });
  slide.addText(String(pageNumber), {
    x: SLIDE_W - MARGIN - 0.6, y: SLIDE_H - 0.4, w: 0.6, h: 0.3,
    fontSize: 8, color: theme.mutedTextColor.replace("#", ""), align: "right",
  });
}

function hex(color: string): string {
  return color.replace("#", "");
}

function addTitle(slide: PptxGenJS.Slide, theme: PresentationTheme, rawTitle: string, y = 0.5) {
  const { final } = fitTextToBox(rawTitle);
  slide.addText(final, {
    x: MARGIN, y, w: SLIDE_W - MARGIN * 2, h: 0.9,
    fontSize: 28, bold: true, color: hex(theme.textColor), fontFace: theme.headingFont,
  });
}

function addSubtitle(slide: PptxGenJS.Slide, theme: PresentationTheme, subtitle: string | undefined, y = 1.35) {
  if (!subtitle) return;
  slide.addText(subtitle, {
    x: MARGIN, y, w: SLIDE_W - MARGIN * 2, h: 0.5,
    fontSize: 14, color: hex(theme.mutedTextColor), fontFace: theme.bodyFont,
  });
}

function addBulletsBlock(
  slide: PptxGenJS.Slide,
  theme: PresentationTheme,
  bullets: string[],
  x: number, y: number, w: number, h: number,
) {
  if (bullets.length === 0) return;
  slide.addText(
    bullets.map((b) => ({ text: b, options: { bullet: { code: "2022" }, breakLine: true } })),
    { x, y, w, h, fontSize: Math.max(MIN_BODY_FONT_SIZE, 15), color: hex(theme.textColor), fontFace: theme.bodyFont, valign: "top" },
  );
}

function addImageIfPresent(
  slide: PptxGenJS.Slide,
  image: { buffer: Buffer | null; fit?: "contain" | "cover" } | undefined,
  x: number, y: number, w: number, h: number,
): boolean {
  if (!image?.buffer || image.buffer.length === 0) return false;
  try {
    slide.addImage({
      data: `data:image/png;base64,${image.buffer.toString("base64")}`,
      x, y, w, h,
      sizing: { type: image.fit === "cover" ? "cover" : "contain", w, h },
    });
    return true;
  } catch {
    // Optional image failure must never abort the whole deck.
    return false;
  }
}

// ── Reusable slide layouts ───────────────────────────────────────────────────

export function renderCoverSlide(pres: PptxGenJS, theme: PresentationTheme, spec: PresentationSlideSpec & { kind: "cover" }, companyName?: string) {
  const slide = pres.addSlide();
  slide.background = { color: hex(theme.primaryColor) };
  const { final: title } = fitTextToBox(spec.title, 80);
  slide.addText(title, {
    x: 1, y: 2.6, w: SLIDE_W - 2, h: 1.4,
    fontSize: 40, bold: true, color: hex(theme.backgroundColor), align: "left", fontFace: theme.headingFont,
  });
  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 1, y: 4.05, w: SLIDE_W - 2, h: 0.8,
      fontSize: 18, color: hex(theme.backgroundColor), align: "left", fontFace: theme.bodyFont,
    });
  }
  if (companyName) {
    slide.addText(companyName, {
      x: 1, y: 0.7, w: SLIDE_W - 2, h: 0.5,
      fontSize: 14, color: hex(theme.backgroundColor), align: "left",
    });
  }
  addImageIfPresent(slide, spec.logo, SLIDE_W - 2.3, 0.5, 1.6, 1.0);
  return slide;
}

export function renderSectionSlide(pres: PptxGenJS, theme: PresentationTheme, spec: PresentationSlideSpec & { kind: "section" }) {
  const slide = pres.addSlide();
  slide.background = { color: hex(theme.secondaryColor) };
  const { final: title } = fitTextToBox(spec.title, 80);
  slide.addText(title, {
    x: MARGIN, y: SLIDE_H / 2 - 0.6, w: SLIDE_W - MARGIN * 2, h: 1.2,
    fontSize: 32, bold: true, color: hex(theme.backgroundColor), align: "center",
  });
  return slide;
}

export function renderContentSlide(
  pres: PptxGenJS, theme: PresentationTheme,
  title: string, body?: string, bullets?: string[],
  image?: { buffer: Buffer | null; caption?: string },
) {
  const slide = pres.addSlide();
  addTitle(slide, theme, title);
  const { fitted } = fitBulletsToBox(bullets ?? []);
  const hasImage = !!image?.buffer && image.buffer.length > 0;
  const textW = hasImage ? 6.6 : SLIDE_W - MARGIN * 2;

  let y = 1.5;
  if (body) {
    const { final } = fitTextToBox(body, 480);
    slide.addText(final, {
      x: MARGIN, y, w: textW, h: 1.2, fontSize: Math.max(MIN_BODY_FONT_SIZE, 14), color: hex(theme.textColor), valign: "top",
    });
    y += 1.3;
  }
  addBulletsBlock(slide, theme, fitted, MARGIN, y, textW, SLIDE_H - y - 0.6);

  if (hasImage) {
    addImageIfPresent(slide, image, SLIDE_W - MARGIN - 5.2, 1.5, 5.2, SLIDE_H - 2.2);
  }
  return slide;
}

export function renderProblemSolutionSlide(
  pres: PptxGenJS, theme: PresentationTheme,
  title: string, body: string | undefined, bullets: string[] | undefined,
) {
  return renderContentSlide(pres, theme, title, body, bullets);
}

export function renderMetricsSlide(pres: PptxGenJS, theme: PresentationTheme, title: string, metrics: SlideMetric[]) {
  const slide = pres.addSlide();
  addTitle(slide, theme, title);
  const cols = Math.min(metrics.length, 4) || 1;
  const cardW = (SLIDE_W - MARGIN * 2 - (cols - 1) * 0.3) / cols;
  metrics.slice(0, 8).forEach((m, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * (cardW + 0.3);
    const y = 1.7 + row * 2.2;
    slide.addShape("roundRect", { x, y, w: cardW, h: 2.0, fill: { color: hex(theme.backgroundColor) }, line: { color: hex(theme.primaryColor), width: 1 }, rectRadius: 0.08 });
    slide.addText(m.value, { x, y: y + 0.25, w: cardW, h: 0.7, fontSize: 26, bold: true, color: hex(theme.primaryColor), align: "center" });
    slide.addText(m.label, { x, y: y + 1.0, w: cardW, h: 0.5, fontSize: 12, color: hex(theme.textColor), align: "center" });
    if (m.note) slide.addText(m.note, { x, y: y + 1.5, w: cardW, h: 0.4, fontSize: 9, color: hex(theme.mutedTextColor), align: "center" });
  });
  return slide;
}

export function renderTimelineSlide(pres: PptxGenJS, theme: PresentationTheme, title: string, items: SlideTimelineItem[]) {
  const slide = pres.addSlide();
  addTitle(slide, theme, title);
  const capped = items.slice(0, 6);
  const n = capped.length || 1;
  const stepW = (SLIDE_W - MARGIN * 2) / n;
  slide.addShape("line", { x: MARGIN, y: 3.2, w: SLIDE_W - MARGIN * 2, h: 0, line: { color: hex(theme.mutedTextColor), width: 1.5 } });
  capped.forEach((item, i) => {
    const x = MARGIN + i * stepW;
    slide.addShape("ellipse", { x: x + stepW / 2 - 0.08, y: 3.12, w: 0.16, h: 0.16, fill: { color: hex(theme.accentColor) } });
    const { final: period } = fitTextToBox(item.period, 30);
    const { final: t } = fitTextToBox(item.title, 60);
    slide.addText(period, { x, y: 2.6, w: stepW - 0.15, h: 0.4, fontSize: 11, bold: true, color: hex(theme.primaryColor), align: "center" });
    slide.addText(t, { x, y: 3.45, w: stepW - 0.15, h: 0.5, fontSize: 12, bold: true, color: hex(theme.textColor), align: "center" });
    if (item.description) {
      const { final: d } = fitTextToBox(item.description, 90);
      slide.addText(d, { x, y: 3.95, w: stepW - 0.15, h: 1.4, fontSize: 10, color: hex(theme.mutedTextColor), align: "center", valign: "top" });
    }
  });
  return slide;
}

export function renderComparisonSlide(pres: PptxGenJS, theme: PresentationTheme, title: string, rows: SlideComparisonRow[]) {
  const slide = pres.addSlide();
  addTitle(slide, theme, title);
  const capped = rows.slice(0, 8);
  const tableRows: PptxGenJS.TableRow[] = [
    [
      { text: "", options: { fill: { color: hex(theme.backgroundColor) } } },
      { text: "Us", options: { fill: { color: hex(theme.primaryColor) }, color: hex(theme.backgroundColor), bold: true, align: "center" } },
      { text: "Competitor", options: { fill: { color: "E5E7EB" }, bold: true, align: "center" } },
    ],
    ...capped.map((r) => [
      { text: fitTextToBox(r.label, 40).final, options: { bold: true } },
      { text: fitTextToBox(r.us, 60).final, options: { align: "center" as const } },
      { text: fitTextToBox(r.competitor, 60).final, options: { align: "center" as const } },
    ]),
  ];
  slide.addTable(tableRows, {
    x: MARGIN, y: 1.6, w: SLIDE_W - MARGIN * 2, h: Math.min(4.8, 0.5 + capped.length * 0.5),
    fontSize: 11, color: hex(theme.textColor), border: { type: "solid", color: "E5E7EB", pt: 0.5 },
    autoPage: false,
  });
  return slide;
}

export function renderMarketSlide(pres: PptxGenJS, theme: PresentationTheme, title: string, body: string | undefined, bullets: string[] | undefined) {
  return renderContentSlide(pres, theme, title, body, bullets);
}

export function renderTeamSlide(pres: PptxGenJS, theme: PresentationTheme, title: string, members: Array<{ name: string; role: string; bio?: string }>) {
  const slide = pres.addSlide();
  addTitle(slide, theme, title);
  const capped = members.slice(0, 5);
  const cols = capped.length || 1;
  const cardW = (SLIDE_W - MARGIN * 2 - (cols - 1) * 0.25) / cols;
  capped.forEach((m, i) => {
    const x = MARGIN + i * (cardW + 0.25);
    slide.addShape("roundRect", { x, y: 1.7, w: cardW, h: 4.6, fill: { color: "F9FAFB" }, line: { color: "E5E7EB", width: 1 }, rectRadius: 0.06 });
    slide.addShape("ellipse", { x: x + cardW / 2 - 0.5, y: 2.0, w: 1.0, h: 1.0, fill: { color: hex(theme.primaryColor) } });
    slide.addText(fitTextToBox(m.name, 40).final, { x, y: 3.15, w: cardW, h: 0.4, fontSize: 13, bold: true, align: "center", color: hex(theme.textColor) });
    slide.addText(fitTextToBox(m.role, 40).final, { x, y: 3.55, w: cardW, h: 0.4, fontSize: 11, align: "center", color: hex(theme.primaryColor) });
    if (m.bio) {
      slide.addText(fitTextToBox(m.bio, 160).final, { x: x + 0.15, y: 4.05, w: cardW - 0.3, h: 2.1, fontSize: 9, align: "center", color: hex(theme.mutedTextColor), valign: "top" });
    }
  });
  return slide;
}

export function renderFinancialSlide(
  pres: PptxGenJS, theme: PresentationTheme, title: string,
  metrics: SlideMetric[] | undefined, chart: import("./presentationTypes.js").SlideChartSpec | undefined,
) {
  const slide = pres.addSlide();
  addTitle(slide, theme, title);

  if (chart && chart.categories.length > 0 && chart.series.length > 0) {
    const chartData: PptxGenJS.IChartMulti[] = chart.series.map((s) => ({
      name: s.name,
      labels: chart.categories,
      values: s.values,
    })) as unknown as PptxGenJS.IChartMulti[];
    const chartType =
      chart.chartType === "line" ? pres.ChartType.line :
      chart.chartType === "pie" ? pres.ChartType.pie :
      pres.ChartType.bar;
    slide.addChart(chartType, chartData, {
      x: MARGIN, y: 1.6, w: metrics?.length ? 7.6 : SLIDE_W - MARGIN * 2, h: 4.4,
      chartColors: [hex(theme.primaryColor), hex(theme.accentColor), hex(theme.secondaryColor)],
      showLegend: chart.series.length > 1,
    });
    if (chart.isProjection) {
      slide.addText("Projection — not actuals", { x: MARGIN, y: 6.15, w: 7.6, h: 0.3, fontSize: 9, italic: true, color: hex(theme.mutedTextColor) });
    }
    if (chart.sourceNote) {
      slide.addText(chart.sourceNote, { x: MARGIN, y: 6.45, w: 7.6, h: 0.4, fontSize: 8, color: hex(theme.mutedTextColor) });
    }
  }

  if (metrics && metrics.length > 0) {
    const x0 = chart ? SLIDE_W - MARGIN - 4.6 : MARGIN;
    const w0 = chart ? 4.6 : SLIDE_W - MARGIN * 2;
    metrics.slice(0, 4).forEach((m, i) => {
      const y = 1.7 + i * 1.15;
      slide.addText(m.value, { x: x0, y, w: w0, h: 0.5, fontSize: 20, bold: true, color: hex(theme.primaryColor) });
      slide.addText(m.label, { x: x0, y: y + 0.5, w: w0, h: 0.4, fontSize: 11, color: hex(theme.textColor) });
    });
  }
  return slide;
}

export function renderAskSlide(pres: PptxGenJS, theme: PresentationTheme, title: string, body?: string, bullets?: string[]) {
  const slide = pres.addSlide();
  slide.background = { color: hex(theme.primaryColor) };
  slide.addText(fitTextToBox(title, 80).final, {
    x: MARGIN, y: 0.8, w: SLIDE_W - MARGIN * 2, h: 0.9, fontSize: 30, bold: true, color: hex(theme.backgroundColor),
  });
  if (body) {
    slide.addText(fitTextToBox(body, 400).final, {
      x: MARGIN, y: 1.9, w: SLIDE_W - MARGIN * 2, h: 1.2, fontSize: 16, color: hex(theme.backgroundColor),
    });
  }
  const { fitted } = fitBulletsToBox(bullets ?? []);
  if (fitted.length > 0) {
    slide.addText(
      fitted.map((b) => ({ text: b, options: { bullet: { code: "2022" }, breakLine: true } })),
      { x: MARGIN, y: 3.2, w: SLIDE_W - MARGIN * 2, h: 3.0, fontSize: 15, color: hex(theme.backgroundColor), valign: "top" },
    );
  }
  return slide;
}

export function renderClosingSlide(pres: PptxGenJS, theme: PresentationTheme, spec: PresentationSlideSpec & { kind: "closing" }, companyName?: string) {
  const slide = pres.addSlide();
  slide.background = { color: hex(theme.secondaryColor) };
  slide.addText(fitTextToBox(spec.title, 80).final, {
    x: 1, y: SLIDE_H / 2 - 0.8, w: SLIDE_W - 2, h: 1.0, fontSize: 32, bold: true, color: hex(theme.backgroundColor), align: "center",
  });
  if (spec.subtitle || companyName) {
    slide.addText(spec.subtitle ?? companyName ?? "", {
      x: 1, y: SLIDE_H / 2 + 0.3, w: SLIDE_W - 2, h: 0.6, fontSize: 14, color: hex(theme.mutedTextColor), align: "center",
    });
  }
  return slide;
}

// ── Main render entry point ───────────────────────────────────────────────────

/**
 * Render a CreativePresentationSpec to a real PPTX Buffer.
 * Long bullet content that exceeds MAX_BULLET_ITEMS_PER_SLIDE on a `content`
 * slide is split across continuation slides ("<title> (cont.)") rather than
 * silently dropped or shrunk to an unreadable font size.
 */
export async function renderPresentation(spec: CreativePresentationSpec): Promise<PresentationRenderResult> {
  const renderStart = Date.now();
  const pres = new PptxGenJS();
  pres.defineLayout({ name: "PITCH_WIDE", width: SLIDE_W, height: SLIDE_H });
  pres.layout = "PITCH_WIDE";
  pres.author = "Creative AI Studio";
  pres.title = spec.title;
  pres.subject = spec.presentationType.replace(/_/g, " ");

  const theme = spec.theme;
  let continuationSlidesCreated = 0;
  let slideIndex = 0;

  function attachNotesAndFooter(slide: PptxGenJS.Slide, notes?: string) {
    slideIndex += 1;
    if (notes && notes.trim()) {
      slide.addNotes(notes.trim().slice(0, 2000));
    }
    addFooter(slide, theme, footerText(spec), slideIndex);
  }

  for (const raw of spec.slides) {
    switch (raw.kind) {
      case "cover": {
        const s = renderCoverSlide(pres, theme, raw, spec.companyName);
        attachNotesAndFooter(s, raw.speakerNotes);
        break;
      }
      case "section": {
        const s = renderSectionSlide(pres, theme, raw);
        attachNotesAndFooter(s, raw.speakerNotes);
        break;
      }
      case "content":
      case "problem":
      case "solution":
      case "market": {
        const chunks = raw.bullets && raw.bullets.length > 0 ? splitContentAcrossSlides(raw.bullets) : [[]];
        chunks.forEach((chunk, i) => {
          const title = i === 0 ? (raw.title ?? "") : `${raw.title ?? ""} (cont.)`;
          const s = renderContentSlide(pres, theme, title, i === 0 ? raw.body : undefined, chunk, raw.image);
          if (i > 0) continuationSlidesCreated += 1;
          attachNotesAndFooter(s, i === 0 ? raw.speakerNotes : undefined);
        });
        break;
      }
      case "metrics": {
        const s = renderMetricsSlide(pres, theme, raw.title, raw.metrics);
        attachNotesAndFooter(s, raw.speakerNotes);
        break;
      }
      case "timeline": {
        const s = renderTimelineSlide(pres, theme, raw.title, raw.items);
        attachNotesAndFooter(s, raw.speakerNotes);
        break;
      }
      case "comparison": {
        const s = renderComparisonSlide(pres, theme, raw.title, raw.rows);
        attachNotesAndFooter(s, raw.speakerNotes);
        break;
      }
      case "team": {
        const s = renderTeamSlide(pres, theme, raw.title, raw.members);
        attachNotesAndFooter(s, raw.speakerNotes);
        break;
      }
      case "financial": {
        const s = renderFinancialSlide(pres, theme, raw.title, raw.metrics, raw.chart);
        attachNotesAndFooter(s, raw.speakerNotes);
        break;
      }
      case "ask": {
        const s = renderAskSlide(pres, theme, raw.title, raw.body, raw.bullets);
        attachNotesAndFooter(s, raw.speakerNotes);
        break;
      }
      case "closing": {
        const s = renderClosingSlide(pres, theme, raw, spec.companyName);
        attachNotesAndFooter(s, raw.speakerNotes);
        break;
      }
    }
  }

  let buffer: Buffer;
  try {
    const arrayBuffer = (await pres.write({ outputType: "arraybuffer" })) as ArrayBuffer;
    buffer = Buffer.from(arrayBuffer);
  } catch (err) {
    throw new PresentationRenderError(`pptxgenjs render failed: ${String(err)}`);
  }

  return {
    buffer,
    slideCount: slideIndex,
    renderDurationMs: Date.now() - renderStart,
    continuationSlidesCreated,
  };
}
