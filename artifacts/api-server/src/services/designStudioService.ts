/**
 * V4.5 AI Design Studio — service layer
 * Handles design projects, canvas state, version history, export, and AI regeneration.
 *
 * Team 36 (Design Security) changes:
 *   - All project-level operations now require and enforce tenantId.
 *   - Version operations verify project ownership (via getDesignProject) before
 *     querying the ai_design_versions table, so tenant isolation is transitive.
 *   - canvasStateToSvg now sanitizes all attribute values to prevent SVG/XSS
 *     injection from user-controlled canvas element properties.
 */
import { db } from "@workspace/db";
import { aiDesignProjects, aiDesignVersions } from "@workspace/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import OpenAI from "openai";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DesignElement {
  id: string;
  name: string;
  type: "text" | "image" | "rect" | "circle" | "line" | "frame";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  locked: boolean;
  visible: boolean;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  borderRadius?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  textAlign?: string;
  color?: string;
  src?: string;
  objectFit?: string;
}

export interface CanvasState {
  width: number;
  height: number;
  background: string;
  elements: DesignElement[];
}

// ── SVG Sanitization Helpers ──────────────────────────────────────────────────
//
// All canvas element properties that flow into SVG attribute or text content
// positions MUST pass through one of these helpers. Unsanitized user data in
// SVG attributes can produce XSS when the SVG is rendered directly in a browser,
// and CSS url() values in fill/stroke can trigger SSRF fetches by SVG renderers.

/** Allows hex, rgb/rgba, hsl/hsla, named colors, "transparent", and "none". */
const SAFE_CSS_COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*[\d.]+)?\s*\)|hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%(?:\s*,\s*[\d.]+)?\s*\)|transparent|none|[a-zA-Z]{2,30})$/;

/** Allows font names: alphanumeric, spaces, commas, single/double quotes, dashes, underscores, dots. */
const SAFE_FONT_FAMILY_RE = /^[a-zA-Z0-9 ,'"\-_.]{1,200}$/;

/** Only https:// external URLs are allowed in image href attributes. */
const SAFE_HTTPS_URL_RE = /^https:\/\/.{1,1000}$/;

function safeCssColor(value: string | undefined, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  return SAFE_CSS_COLOR_RE.test(trimmed) ? trimmed : fallback;
}

function safeFontFamily(value: string | undefined, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  return SAFE_FONT_FAMILY_RE.test(String(value)) ? String(value) : fallback;
}

/** Returns the URL string if it is a safe https:// URL, or null otherwise. */
function safeHttpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  return SAFE_HTTPS_URL_RE.test(String(value)) ? String(value) : null;
}

/** Escapes characters that are special in XML attribute values and text content. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Ensures a value is a finite number, returning a fallback otherwise. */
function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultCanvas(w = 1920, h = 1080): CanvasState {
  return { width: w, height: h, background: "#ffffff", elements: [] };
}

// ── Project CRUD ──────────────────────────────────────────────────────────────

export interface ListProjectsOptions {
  tenantId: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export async function listDesignProjects(opts: ListProjectsOptions) {
  const { tenantId, status, page = 1, pageSize = 20 } = opts;
  const offset = (page - 1) * pageSize;

  const tenantFilter = eq(aiDesignProjects.tenantId, tenantId);
  const where = status
    ? and(tenantFilter, eq(aiDesignProjects.status, status))
    : tenantFilter;

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(aiDesignProjects)
      .where(where)
      .orderBy(desc(aiDesignProjects.updatedAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiDesignProjects)
      .where(where),
  ]);

  // For each project, get the version count and element count
  const enriched = await Promise.all(
    rows.map(async (p: (typeof rows)[number]) => {
      const [versionResult, currentVersion] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(aiDesignVersions)
          .where(eq(aiDesignVersions.projectId, p.id)),
        p.currentVersionId
          ? db
              .select({ elementCount: aiDesignVersions.elementCount })
              .from(aiDesignVersions)
              .where(eq(aiDesignVersions.id, p.currentVersionId))
              .limit(1)
          : Promise.resolve([{ elementCount: 0 }]),
      ]);
      return {
        ...p,
        versionCount: versionResult[0]?.count ?? 0,
        elementCount: currentVersion[0]?.elementCount ?? 0,
      };
    }),
  );

  return {
    items: enriched,
    total: countResult[0]?.count ?? 0,
    page,
    pageSize,
  };
}

export async function getDesignProject(id: number, tenantId: string) {
  const [project] = await db
    .select()
    .from(aiDesignProjects)
    .where(and(eq(aiDesignProjects.id, id), eq(aiDesignProjects.tenantId, tenantId)))
    .limit(1);

  if (!project) return null;

  const [versionResult, currentVersion] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiDesignVersions)
      .where(eq(aiDesignVersions.projectId, id)),
    project.currentVersionId
      ? db
          .select({ elementCount: aiDesignVersions.elementCount })
          .from(aiDesignVersions)
          .where(eq(aiDesignVersions.id, project.currentVersionId))
          .limit(1)
      : Promise.resolve([{ elementCount: 0 }]),
  ]);

  return {
    ...project,
    versionCount: versionResult[0]?.count ?? 0,
    elementCount: currentVersion[0]?.elementCount ?? 0,
  };
}

export async function createDesignProject(input: {
  tenantId: string;
  name: string;
  description?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  templateId?: number;
  brandDnaId?: number;
  tags?: string[];
  initialState?: CanvasState;
}) {
  const w = input.canvasWidth ?? 1920;
  const h = input.canvasHeight ?? 1080;

  const [project] = await db
    .insert(aiDesignProjects)
    .values({
      tenantId: input.tenantId,
      name: input.name,
      description: input.description,
      canvasWidth: w,
      canvasHeight: h,
      templateId: input.templateId,
      brandDnaId: input.brandDnaId,
      tags: input.tags ?? [],
      status: "draft",
    })
    .returning();

  if (!project) throw new Error("Failed to create design project");

  // Create initial version
  const initState = input.initialState ?? defaultCanvas(w, h);
  const [version] = await db
    .insert(aiDesignVersions)
    .values({
      projectId: project.id,
      versionNumber: 1,
      label: "Initial",
      canvasState: initState,
      elementCount: initState.elements.length,
    })
    .returning();

  if (!version) throw new Error("Failed to create initial version");

  // Link current version
  const [updated] = await db
    .update(aiDesignProjects)
    .set({ currentVersionId: version.id, updatedAt: new Date() })
    .where(and(eq(aiDesignProjects.id, project.id), eq(aiDesignProjects.tenantId, input.tenantId)))
    .returning();

  return { ...(updated ?? project), versionCount: 1, elementCount: initState.elements.length };
}

export async function updateDesignProject(
  id: number,
  tenantId: string,
  input: {
    name?: string;
    description?: string;
    status?: string;
    tags?: string[];
    thumbnailUrl?: string;
  },
) {
  const [updated] = await db
    .update(aiDesignProjects)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(aiDesignProjects.id, id), eq(aiDesignProjects.tenantId, tenantId)))
    .returning();

  if (!updated) return null;
  return { ...updated, versionCount: 0, elementCount: 0 };
}

export async function archiveDesignProject(id: number, tenantId: string) {
  const [updated] = await db
    .update(aiDesignProjects)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(aiDesignProjects.id, id), eq(aiDesignProjects.tenantId, tenantId)))
    .returning();

  if (!updated) return null;
  return { ok: true };
}

// ── Canvas / Version management ───────────────────────────────────────────────

export async function getDesignCanvas(projectId: number, tenantId: string) {
  const project = await getDesignProject(projectId, tenantId);
  if (!project) return null;

  if (!project.currentVersionId) {
    // No versions yet — return empty default
    const state = defaultCanvas(project.canvasWidth, project.canvasHeight);
    return {
      projectId,
      versionId: 0,
      versionNumber: 0,
      canvasState: state,
      savedAt: project.updatedAt,
    };
  }

  const [version] = await db
    .select()
    .from(aiDesignVersions)
    .where(eq(aiDesignVersions.id, project.currentVersionId))
    .limit(1);

  if (!version) return null;

  return {
    projectId,
    versionId: version.id,
    versionNumber: version.versionNumber,
    canvasState: version.canvasState as CanvasState,
    savedAt: version.createdAt,
  };
}

export async function saveDesignCanvas(
  projectId: number,
  canvasState: CanvasState,
  tenantId: string,
  label?: string,
) {
  const project = await getDesignProject(projectId, tenantId);
  if (!project) return null;

  // Next version number
  const [lastVersion] = await db
    .select({ versionNumber: aiDesignVersions.versionNumber })
    .from(aiDesignVersions)
    .where(eq(aiDesignVersions.projectId, projectId))
    .orderBy(desc(aiDesignVersions.versionNumber))
    .limit(1);

  const nextVersionNumber = (lastVersion?.versionNumber ?? 0) + 1;

  const [version] = await db
    .insert(aiDesignVersions)
    .values({
      projectId,
      versionNumber: nextVersionNumber,
      label: label ?? undefined,
      canvasState,
      elementCount: canvasState.elements.length,
    })
    .returning();

  if (!version) throw new Error("Failed to save canvas version");

  await db
    .update(aiDesignProjects)
    .set({
      currentVersionId: version.id,
      updatedAt: new Date(),
    })
    .where(and(eq(aiDesignProjects.id, projectId), eq(aiDesignProjects.tenantId, tenantId)));

  return {
    projectId,
    versionId: version.id,
    versionNumber: version.versionNumber,
    canvasState,
    savedAt: version.createdAt,
  };
}

export async function listDesignVersions(projectId: number, tenantId: string) {
  // Verify project belongs to this tenant before listing its versions.
  const project = await getDesignProject(projectId, tenantId);
  if (!project) return null;

  const rows = await db
    .select({
      id: aiDesignVersions.id,
      projectId: aiDesignVersions.projectId,
      versionNumber: aiDesignVersions.versionNumber,
      label: aiDesignVersions.label,
      elementCount: aiDesignVersions.elementCount,
      createdAt: aiDesignVersions.createdAt,
    })
    .from(aiDesignVersions)
    .where(eq(aiDesignVersions.projectId, projectId))
    .orderBy(desc(aiDesignVersions.versionNumber));

  return { items: rows, total: rows.length };
}

export async function getDesignVersion(projectId: number, versionId: number, tenantId: string) {
  // Verify project ownership before fetching the version.
  const project = await getDesignProject(projectId, tenantId);
  if (!project) return null;

  const [version] = await db
    .select()
    .from(aiDesignVersions)
    .where(
      and(
        eq(aiDesignVersions.id, versionId),
        eq(aiDesignVersions.projectId, projectId),
      ),
    )
    .limit(1);

  if (!version) return null;
  return version;
}

export async function restoreDesignVersion(
  projectId: number,
  versionId: number,
  tenantId: string,
) {
  const version = await getDesignVersion(projectId, versionId, tenantId);
  if (!version) return null;

  const state = version.canvasState as CanvasState;
  return saveDesignCanvas(projectId, state, tenantId, `Restored v${version.versionNumber}`);
}

// ── Export ────────────────────────────────────────────────────────────────────

export async function exportDesign(
  projectId: number,
  tenantId: string,
  format: "png" | "pdf" | "svg" | "json",
  _scale = 1,
) {
  const canvas = await getDesignCanvas(projectId, tenantId);
  if (!canvas) return null;

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  if (format === "json") {
    // Return inline JSON data URL
    const json = JSON.stringify(canvas.canvasState, null, 2);
    const dataUrl = `data:application/json;base64,${Buffer.from(json).toString("base64")}`;
    return { format, url: dataUrl, dataUrl, expiresAt: expiresAt.toISOString() };
  }

  if (format === "svg") {
    const svgContent = canvasStateToSvg(canvas.canvasState);
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString("base64")}`;
    return { format, url: dataUrl, dataUrl, expiresAt: expiresAt.toISOString() };
  }

  // PNG / PDF: return SVG-based data URL as placeholder
  // Full raster export requires a headless browser — tracked as TODO
  const svgContent = canvasStateToSvg(canvas.canvasState);
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString("base64")}`;
  return { format, url: dataUrl, dataUrl: null, expiresAt: expiresAt.toISOString() };
}

/**
 * Converts a CanvasState to a sanitized SVG string.
 *
 * Security hardening (Team 36):
 *   - CSS color attributes (fill, stroke, color, background) are validated
 *     against an allowlist regex. Invalid values fall back to a safe default.
 *     This prevents CSS url() SSRF and other injection via color values.
 *   - font-family is validated against an allowlist of safe characters.
 *   - image href is restricted to https:// URLs only to prevent
 *     data: URI injection and non-https fetches by SVG renderers.
 *   - All string values placed in text content or attribute positions are
 *     XML-escaped to prevent XSS.
 *   - Numeric values are checked for finiteness before being serialized.
 */
export function canvasStateToSvg(state: CanvasState): string {
  const width = safeNum(state.width, 1920);
  const height = safeNum(state.height, 1080);
  const background = safeCssColor(state.background, "#ffffff");

  const sorted = Array.isArray(state.elements)
    ? [...state.elements]
        .filter((e) => e.visible)
        .sort((a, b) => safeNum(a.zIndex) - safeNum(b.zIndex))
    : [];

  const elementsSvg = sorted
    .map((el) => {
      const x = safeNum(el.x);
      const y = safeNum(el.y);
      const w = safeNum(el.width, 10);
      const h = safeNum(el.height, 10);
      const rotation = safeNum(el.rotation);
      const opacity = safeNum(el.opacity, 1);

      const transform = rotation
        ? ` transform="rotate(${rotation} ${x + w / 2} ${y + h / 2})"`
        : "";
      const opacityAttr = opacity !== 1 ? ` opacity="${opacity}"` : "";

      if (el.type === "rect" || el.type === "frame") {
        const fill = safeCssColor(el.fill, "#e5e7eb");
        const stroke = safeCssColor(el.stroke, "none");
        const strokeWidth = safeNum(el.strokeWidth);
        const rx = safeNum(el.borderRadius);
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" rx="${rx}"${transform}${opacityAttr}/>`;
      }

      if (el.type === "circle") {
        const cx = x + w / 2;
        const cy = y + h / 2;
        const fill = safeCssColor(el.fill, "#e5e7eb");
        const stroke = safeCssColor(el.stroke, "none");
        const strokeWidth = safeNum(el.strokeWidth);
        return `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${transform}${opacityAttr}/>`;
      }

      if (el.type === "line") {
        const stroke = safeCssColor(el.stroke, "#000000");
        const strokeWidth = safeNum(el.strokeWidth, 2);
        return `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="${stroke}" stroke-width="${strokeWidth}"${transform}${opacityAttr}/>`;
      }

      if (el.type === "text") {
        const fontSize = safeNum(el.fontSize, 16);
        const fontFamily = xmlEscape(safeFontFamily(el.fontFamily, "sans-serif"));
        const color = safeCssColor(el.color, "#000000");
        const textContent = xmlEscape(el.text ?? "");
        return `<text x="${x}" y="${y + fontSize}" font-size="${fontSize}" font-family="${fontFamily}" fill="${color}"${transform}${opacityAttr}>${textContent}</text>`;
      }

      if (el.type === "image") {
        const href = safeHttpsUrl(el.src);
        if (!href) return ""; // skip images with non-https or missing src
        return `<image href="${xmlEscape(href)}" x="${x}" y="${y}" width="${w}" height="${h}"${transform}${opacityAttr}/>`;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${background}"/>
  ${elementsSvg}
</svg>`;
}

// ── AI Regenerate ─────────────────────────────────────────────────────────────

export async function aiRegenerateElement(
  projectId: number,
  tenantId: string,
  input: {
    elementId: string;
    elementType: "text" | "image" | "style";
    prompt: string;
    currentContent?: string;
    style?: string;
    tone?: string;
  },
) {
  // Verify the caller owns this project before invoking AI.
  const project = await getDesignProject(projectId, tenantId);
  if (!project) return null;

  const openaiKey = process.env["OPENAI_API_KEY"];

  if (!openaiKey) {
    // Return mock suggestions when no key available
    return {
      elementId: input.elementId,
      elementType: input.elementType,
      suggestions: [
        {
          id: "sug-1",
          content: `AI suggestion for: ${input.prompt}`,
          reasoning: "Generated based on your brand tone",
          preview: null,
        },
        {
          id: "sug-2",
          content: `Alternative: ${input.prompt} (variation)`,
          reasoning: "Shorter variant for compact layouts",
          preview: null,
        },
        {
          id: "sug-3",
          content: `Creative: ${input.prompt} — reimagined`,
          reasoning: "Bold creative direction",
          preview: null,
        },
      ],
      brandAligned: true,
      confidence: 0.75,
    };
  }

  const openai = new OpenAI({ apiKey: openaiKey });

  const systemPrompt =
    input.elementType === "text"
      ? `You are a professional copywriter and brand strategist. Generate 3 concise text variations for a design element. Each should be compelling, on-brand, and suitable for visual design. Current content: "${input.currentContent ?? ""}". Style: ${input.style ?? "professional"}. Tone: ${input.tone ?? "confident"}. Respond with a JSON array of exactly 3 objects: [{id, content, reasoning}]`
      : `You are a visual designer. Suggest 3 creative improvements for a ${input.elementType} design element. Prompt: ${input.prompt}. Respond with JSON: [{id, content, reasoning}]`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: input.prompt },
    ],
    response_format: { type: "json_object" },
    max_tokens: 600,
  });

  let suggestions: Array<{ id: string; content: string; reasoning: string | null; preview: string | null }> = [];
  try {
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    const arr = Array.isArray(raw) ? raw : (raw.suggestions ?? raw.items ?? []);
    suggestions = arr.slice(0, 3).map((s: { id?: string; content?: string; reasoning?: string }, i: number) => ({
      id: s.id ?? `sug-${i + 1}`,
      content: s.content ?? "",
      reasoning: s.reasoning ?? null,
      preview: null,
    }));
  } catch {
    suggestions = [];
  }

  return {
    elementId: input.elementId,
    elementType: input.elementType,
    suggestions,
    brandAligned: true,
    confidence: 0.85,
  };
}
