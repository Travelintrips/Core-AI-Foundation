/**
 * V4.5 AI Design Studio — service layer
 * Handles design projects, canvas state, version history, export, and AI regeneration.
 */
import { db } from "@workspace/db";
import { aiDesignProjects, aiDesignVersions } from "@workspace/db/schema";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultCanvas(w = 1920, h = 1080): CanvasState {
  return { width: w, height: h, background: "#ffffff", elements: [] };
}

// ── Project CRUD ──────────────────────────────────────────────────────────────

export interface ListProjectsOptions {
  status?: string;
  page?: number;
  pageSize?: number;
}

export async function listDesignProjects(opts: ListProjectsOptions = {}) {
  const { status, page = 1, pageSize = 20 } = opts;
  const offset = (page - 1) * pageSize;

  const where = status
    ? eq(aiDesignProjects.status, status)
    : undefined;

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

  if (rows.length === 0) {
    return { items: [], total: countResult[0]?.count ?? 0, page, pageSize };
  }

  // Batch-fetch version counts and current-version element counts in 2 queries
  // instead of 2*N per-project queries (N+1 elimination).
  const projectIds = rows.map((r) => r.id);
  const currentVersionIds = rows
    .map((r) => r.currentVersionId)
    .filter((id): id is number => id != null);

  const [versionCountRows, currentVersionRows] = await Promise.all([
    db
      .select({
        projectId: aiDesignVersions.projectId,
        count: sql<number>`count(*)::int`,
      })
      .from(aiDesignVersions)
      .where(inArray(aiDesignVersions.projectId, projectIds))
      .groupBy(aiDesignVersions.projectId),
    currentVersionIds.length > 0
      ? db
          .select({ id: aiDesignVersions.id, elementCount: aiDesignVersions.elementCount })
          .from(aiDesignVersions)
          .where(inArray(aiDesignVersions.id, currentVersionIds))
      : Promise.resolve([]),
  ]);

  const versionCountMap = new Map(versionCountRows.map((r) => [r.projectId, r.count]));
  const elementCountMap = new Map(currentVersionRows.map((r) => [r.id, r.elementCount]));

  const enriched = rows.map((p) => ({
    ...p,
    versionCount: versionCountMap.get(p.id) ?? 0,
    elementCount: p.currentVersionId != null ? (elementCountMap.get(p.currentVersionId) ?? 0) : 0,
  }));

  return {
    items: enriched,
    total: countResult[0]?.count ?? 0,
    page,
    pageSize,
  };
}

export async function getDesignProject(id: number) {
  const [project] = await db
    .select()
    .from(aiDesignProjects)
    .where(eq(aiDesignProjects.id, id))
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
    .where(eq(aiDesignProjects.id, project.id))
    .returning();

  return { ...(updated ?? project), versionCount: 1, elementCount: initState.elements.length };
}

export async function updateDesignProject(
  id: number,
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
    .where(eq(aiDesignProjects.id, id))
    .returning();

  if (!updated) return null;
  return { ...updated, versionCount: 0, elementCount: 0 };
}

export async function archiveDesignProject(id: number) {
  await db
    .update(aiDesignProjects)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(aiDesignProjects.id, id));
  return { ok: true };
}

// ── Canvas / Version management ───────────────────────────────────────────────

export async function getDesignCanvas(projectId: number) {
  const project = await getDesignProject(projectId);
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
  label?: string,
) {
  const project = await getDesignProject(projectId);
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
    .where(eq(aiDesignProjects.id, projectId));

  return {
    projectId,
    versionId: version.id,
    versionNumber: version.versionNumber,
    canvasState,
    savedAt: version.createdAt,
  };
}

export interface ListVersionsOptions {
  page?: number;
  pageSize?: number;
}

export async function listDesignVersions(
  projectId: number,
  opts: ListVersionsOptions = {},
) {
  const { page = 1, pageSize = 30 } = opts;
  const offset = (page - 1) * pageSize;

  const [rows, countResult] = await Promise.all([
    db
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
      .orderBy(desc(aiDesignVersions.versionNumber))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiDesignVersions)
      .where(eq(aiDesignVersions.projectId, projectId)),
  ]);

  return {
    items: rows,
    total: countResult[0]?.count ?? 0,
    page,
    pageSize,
  };
}

export async function getDesignVersion(projectId: number, versionId: number) {
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
) {
  const version = await getDesignVersion(projectId, versionId);
  if (!version) return null;

  const state = version.canvasState as CanvasState;
  return saveDesignCanvas(projectId, state, `Restored v${version.versionNumber}`);
}

// ── Export ────────────────────────────────────────────────────────────────────

export async function exportDesign(
  projectId: number,
  format: "png" | "pdf" | "svg" | "json",
  _scale = 1,
) {
  const canvas = await getDesignCanvas(projectId);
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

function canvasStateToSvg(state: CanvasState): string {
  const { width, height, background, elements } = state;
  const sorted = [...elements]
    .filter((e) => e.visible)
    .sort((a, b) => a.zIndex - b.zIndex);

  const elementsSvg = sorted
    .map((el) => {
      const transform = el.rotation
        ? ` transform="rotate(${el.rotation} ${el.x + el.width / 2} ${el.y + el.height / 2})"`
        : "";
      const opacity = el.opacity !== 1 ? ` opacity="${el.opacity}"` : "";

      if (el.type === "rect" || el.type === "frame") {
        return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="${el.fill ?? "#e5e7eb"}" stroke="${el.stroke ?? "none"}" stroke-width="${el.strokeWidth ?? 0}" rx="${el.borderRadius ?? 0}"${transform}${opacity}/>`;
      }
      if (el.type === "circle") {
        const cx = el.x + el.width / 2;
        const cy = el.y + el.height / 2;
        return `<ellipse cx="${cx}" cy="${cy}" rx="${el.width / 2}" ry="${el.height / 2}" fill="${el.fill ?? "#e5e7eb"}" stroke="${el.stroke ?? "none"}" stroke-width="${el.strokeWidth ?? 0}"${transform}${opacity}/>`;
      }
      if (el.type === "line") {
        return `<line x1="${el.x}" y1="${el.y}" x2="${el.x + el.width}" y2="${el.y + el.height}" stroke="${el.stroke ?? "#000000"}" stroke-width="${el.strokeWidth ?? 2}"${transform}${opacity}/>`;
      }
      if (el.type === "text") {
        return `<text x="${el.x}" y="${el.y + (el.fontSize ?? 16)}" font-size="${el.fontSize ?? 16}" font-family="${el.fontFamily ?? "sans-serif"}" fill="${el.color ?? "#000000"}"${transform}${opacity}>${(el.text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`;
      }
      if (el.type === "image" && el.src) {
        return `<image href="${el.src}" x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}"${transform}${opacity}/>`;
      }
      return "";
    })
    .join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${background}"/>
  ${elementsSvg}
</svg>`;
}

// ── AI Regenerate ─────────────────────────────────────────────────────────────

export async function aiRegenerateElement(
  _projectId: number,
  input: {
    elementId: string;
    elementType: "text" | "image" | "style";
    prompt: string;
    currentContent?: string;
    style?: string;
    tone?: string;
  },
) {
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
