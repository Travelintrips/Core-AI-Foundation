/**
 * V4.5 AI Design Studio — service layer
 * Handles design projects, canvas state, version history, export, and AI regeneration.
 */
import { db } from "@workspace/db";
import { aiDesignProjects, aiDesignVersions } from "@workspace/db/schema";
import type { AiDesignProject } from "@workspace/db/schema";
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

export interface DesignSceneState {
  id: string;
  domain: "interior" | "architecture" | "fashion";
  version: number;
  objects: Array<Record<string, unknown> & { id: string; kind: string; name: string }>;
  embellishments?: Array<Record<string, unknown> & { id: string; targetPartId: string }>;
  asset?: {
    mode: "2d-preview" | "real-3d";
    glbUrl?: string;
    gltfUrl?: string;
    previewUrl?: string;
    provider?: string;
  };
}

export interface CanvasState {
  width: number;
  height: number;
  background: string;
  elements: DesignElement[];
  /** Canonical editable 3D state. 2D canvas remains a derived/legacy projection. */
  designScene?: DesignSceneState;
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

function safeFontFamily(value: string | undefined, fallback = "sans-serif"): string {
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

function validateDesignScene(scene: DesignSceneState): void {
  if (!scene.id || !["interior", "architecture", "fashion"].includes(scene.domain)) throw new Error("INVALID_DESIGN_SCENE");
  if (!Number.isInteger(scene.version) || scene.version < 1) throw new Error("INVALID_DESIGN_SCENE_VERSION");
  if (!Array.isArray(scene.objects)) throw new Error("INVALID_DESIGN_SCENE_OBJECTS");
  const ids = new Set<string>();
  for (const object of scene.objects) {
    if (!object?.id || !object.kind || !object.name || ids.has(object.id)) throw new Error("INVALID_DESIGN_SCENE_OBJECT");
    ids.add(object.id);
  }
  if (scene.asset?.mode === "real-3d" && !scene.asset.glbUrl && !scene.asset.gltfUrl) throw new Error("REAL_3D_ASSET_URL_REQUIRED");
  for (const item of scene.embellishments ?? []) {
    if (!item?.id || !item.targetPartId || !ids.has(item.targetPartId)) throw new Error("INVALID_EMBELLISHMENT_TARGET");
  }
}

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

  if (rows.length === 0) {
    return { items: [], total: countResult[0]?.count ?? 0, page, pageSize };
  }

  const projectIds = rows.map((r: (typeof rows)[number]) => r.id);
  const currentVersionIds = rows
    .map((r: (typeof rows)[number]) => r.currentVersionId)
    .filter((v: number | null | undefined): v is number => v != null);

  const [versionCountRows, currentVersionRows] = await Promise.all([
    db.select({ projectId: aiDesignVersions.projectId, count: sql<number>`count(*)::int` }).from(aiDesignVersions).where(inArray(aiDesignVersions.projectId, projectIds)).groupBy(aiDesignVersions.projectId),
    currentVersionIds.length > 0
      ? db.select({ id: aiDesignVersions.id, elementCount: aiDesignVersions.elementCount }).from(aiDesignVersions).where(inArray(aiDesignVersions.id, currentVersionIds))
      : Promise.resolve([] as { id: number; elementCount: number | null }[]),
  ]);

  const versionCountMap = new Map(versionCountRows.map((r: { projectId: number; count: number }) => [r.projectId, r.count]));
  const elementCountMap = new Map(currentVersionRows.map((r: { id: number; elementCount: number | null }) => [r.id, r.elementCount]));
  const enriched = rows.map((p: (typeof rows)[number]) => ({ ...p, versionCount: versionCountMap.get(p.id) ?? 0, elementCount: p.currentVersionId != null ? (elementCountMap.get(p.currentVersionId) ?? 0) : 0 }));
  return { items: enriched, total: countResult[0]?.count ?? 0, page, pageSize };
}

export async function getDesignProject(id: number, tenantId: string) {
  const [project] = await db.select().from(aiDesignProjects).where(and(eq(aiDesignProjects.id, id), eq(aiDesignProjects.tenantId, tenantId))).limit(1);
  if (!project) return null;
  const [versionResult, currentVersion] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(aiDesignVersions).where(eq(aiDesignVersions.projectId, id)),
    project.currentVersionId ? db.select({ elementCount: aiDesignVersions.elementCount }).from(aiDesignVersions).where(eq(aiDesignVersions.id, project.currentVersionId)).limit(1) : Promise.resolve([{ elementCount: 0 }]),
  ]);
  return { ...project, versionCount: versionResult[0]?.count ?? 0, elementCount: currentVersion[0]?.elementCount ?? 0 };
}

export type DesignProjectSourceType = "interior" | "fashion";

export async function getOrCreateDesignProjectForSource(sourceType: DesignProjectSourceType, sourceId: string | number, tenantId: string, name: string): Promise<AiDesignProject> {
  const normalizedSourceId = String(sourceId);
  const [existing] = await db.select().from(aiDesignProjects).where(and(eq(aiDesignProjects.tenantId, tenantId), eq(aiDesignProjects.sourceType, sourceType), eq(aiDesignProjects.sourceId, normalizedSourceId))).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(aiDesignProjects)
    .values({ tenantId, name, sourceType, sourceId: normalizedSourceId, status: "active" })
    .onConflictDoNothing({
      target: [aiDesignProjects.tenantId, aiDesignProjects.sourceType, aiDesignProjects.sourceId],
    })
    .returning();
  if (created) return created;

  // A concurrent resolver may have inserted the same source binding first.
  // Re-read the unique tenant/source row instead of surfacing a false 500.
  const [winner] = await db
    .select()
    .from(aiDesignProjects)
    .where(and(
      eq(aiDesignProjects.tenantId, tenantId),
      eq(aiDesignProjects.sourceType, sourceType),
      eq(aiDesignProjects.sourceId, normalizedSourceId),
    ))
    .limit(1);
  if (!winner) throw new Error("DESIGN_PROJECT_CREATE_FAILED");
  return winner;
}

export async function createDesignProject(input: { tenantId: string; name: string; description?: string; canvasWidth?: number; canvasHeight?: number; templateId?: number; brandDnaId?: number; tags?: string[]; initialState?: CanvasState; }) {
  const w = input.canvasWidth ?? 1920;
  const h = input.canvasHeight ?? 1080;
  const [project] = await db.insert(aiDesignProjects).values({ tenantId: input.tenantId, name: input.name, description: input.description, canvasWidth: w, canvasHeight: h, templateId: input.templateId, brandDnaId: input.brandDnaId, tags: input.tags ?? [], status: "draft" }).returning();
  if (!project) throw new Error("Failed to create design project");
  const initState = input.initialState ?? defaultCanvas(w, h);
  const [version] = await db.insert(aiDesignVersions).values({ projectId: project.id, versionNumber: 1, label: "Initial", canvasState: initState, elementCount: initState.elements.length }).returning();
  if (!version) throw new Error("Failed to create initial version");
  const [updated] = await db.update(aiDesignProjects).set({ currentVersionId: version.id, updatedAt: new Date() }).where(eq(aiDesignProjects.id, project.id)).returning();
  return { ...(updated ?? project), versionCount: 1, elementCount: initState.elements.length };
}

export async function updateDesignProject(id: number, tenantId: string, input: { name?: string; description?: string; status?: string; tags?: string[]; thumbnailUrl?: string; }) {
  const [updated] = await db.update(aiDesignProjects).set({ ...input, updatedAt: new Date() }).where(and(eq(aiDesignProjects.id, id), eq(aiDesignProjects.tenantId, tenantId))).returning();
  if (!updated) return null;
  return { ...updated, versionCount: 0, elementCount: 0 };
}

export async function archiveDesignProject(id: number, tenantId: string) {
  const [updated] = await db.update(aiDesignProjects).set({ status: "archived", updatedAt: new Date() }).where(and(eq(aiDesignProjects.id, id), eq(aiDesignProjects.tenantId, tenantId))).returning();
  if (!updated) return null;
  return { ok: true };
}

// ── Canvas / Version management ───────────────────────────────────────────────

export async function getDesignCanvas(projectId: number, tenantId: string) {
  const project = await getDesignProject(projectId, tenantId);
  if (!project) return null;
  if (!project.currentVersionId) return { projectId, versionId: 0, versionNumber: 0, canvasState: defaultCanvas(project.canvasWidth, project.canvasHeight), savedAt: project.updatedAt };
  const [version] = await db.select().from(aiDesignVersions).where(eq(aiDesignVersions.id, project.currentVersionId)).limit(1);
  if (!version) return null;
  return { projectId, versionId: version.id, versionNumber: version.versionNumber, canvasState: version.canvasState as CanvasState, savedAt: version.createdAt };
}

export async function saveDesignCanvas(projectId: number, canvasState: CanvasState, tenantId: string, label?: string) {
  const project = await getDesignProject(projectId, tenantId);
  if (!project) return null;
  if (canvasState.designScene) validateDesignScene(canvasState.designScene);
  const [lastVersion] = await db.select({ versionNumber: aiDesignVersions.versionNumber }).from(aiDesignVersions).where(eq(aiDesignVersions.projectId, projectId)).orderBy(desc(aiDesignVersions.versionNumber)).limit(1);
  const nextVersionNumber = (lastVersion?.versionNumber ?? 0) + 1;
  const [version] = await db.insert(aiDesignVersions).values({ projectId, versionNumber: nextVersionNumber, label: label ?? null, canvasState, elementCount: canvasState.elements.length }).returning();
  if (!version) throw new Error("Failed to save version");
  await db.update(aiDesignProjects).set({ currentVersionId: version.id, updatedAt: new Date() }).where(and(eq(aiDesignProjects.id, projectId), eq(aiDesignProjects.tenantId, tenantId)));
  return { versionId: version.id, versionNumber: nextVersionNumber, savedAt: version.createdAt };
}

export async function listDesignVersions(
  projectId: number,
  tenantId: string,
  opts: { page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 30));
  const offset = (page - 1) * pageSize;

  // Keep the ownership check lightweight: pagination must stay O(pageSize),
  // independent of the number of versions on the project.
  const [project] = await db
    .select({ id: aiDesignProjects.id })
    .from(aiDesignProjects)
    .where(and(eq(aiDesignProjects.id, projectId), eq(aiDesignProjects.tenantId, tenantId)))
    .limit(1);
  if (!project) return null;

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: aiDesignVersions.id,
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

  return { items, versions: items, total: countResult[0]?.count ?? 0, page, pageSize };
}

export async function getDesignVersion(projectId: number, versionId: number, tenantId: string) {
  const project = await getDesignProject(projectId, tenantId);
  if (!project) return null;
  const [version] = await db.select().from(aiDesignVersions).where(and(eq(aiDesignVersions.id, versionId), eq(aiDesignVersions.projectId, projectId))).limit(1);
  return version ?? null;
}

export async function restoreDesignVersion(projectId: number, versionId: number, tenantId: string) {
  const project = await getDesignProject(projectId, tenantId);
  if (!project) return null;
  const version = await getDesignVersion(projectId, versionId, tenantId);
  if (!version) return null;
  await db.update(aiDesignProjects).set({ currentVersionId: versionId, updatedAt: new Date() }).where(and(eq(aiDesignProjects.id, projectId), eq(aiDesignProjects.tenantId, tenantId)));
  return { ok: true, versionId, versionNumber: version.versionNumber };
}

// ── Export ────────────────────────────────────────────────────────────────────

export function canvasStateToSvg(state: CanvasState, scale = 1): string {
  const w = safeNum(state.width) * scale;
  const h = safeNum(state.height) * scale;
  const elementsSvg = state.elements.filter((el) => el.visible).sort((a, b) => a.zIndex - b.zIndex).map((el) => {
    const x = safeNum(el.x) * scale, y = safeNum(el.y) * scale, ew = safeNum(el.width) * scale, eh = safeNum(el.height) * scale;
    const transform = `rotate(${safeNum(el.rotation)} ${x + ew / 2} ${y + eh / 2})`;
    const opacity = Math.max(0, Math.min(1, safeNum(el.opacity, 1)));
    if (el.type === "text") return `<text x="${x}" y="${y + safeNum(el.fontSize, 16) * scale}" font-size="${safeNum(el.fontSize, 16) * scale}" font-family="${xmlEscape(safeFontFamily(el.fontFamily, "sans-serif"))}" font-weight="${xmlEscape(String(el.fontWeight ?? "normal"))}" fill="${safeCssColor(el.color, "#000000")}" opacity="${opacity}" transform="${transform}">${xmlEscape(el.text ?? "")}</text>`;
    if (el.type === "image") { const href = safeHttpsUrl(el.src); if (!href) return ""; return `<image x="${x}" y="${y}" width="${ew}" height="${eh}" href="${xmlEscape(href)}" opacity="${opacity}" transform="${transform}" preserveAspectRatio="xMidYMid meet"/>`; }
    if (el.type === "circle") return `<ellipse cx="${x + ew / 2}" cy="${y + eh / 2}" rx="${ew / 2}" ry="${eh / 2}" fill="${safeCssColor(el.fill, "#cccccc")}" stroke="${safeCssColor(el.stroke, "none")}" stroke-width="${safeNum(el.strokeWidth) * scale}" opacity="${opacity}" transform="${transform}"/>`;
    return `<rect x="${x}" y="${y}" width="${ew}" height="${eh}" rx="${safeNum(el.borderRadius) * scale}" fill="${safeCssColor(el.fill, "#cccccc")}" stroke="${safeCssColor(el.stroke, "none")}" stroke-width="${safeNum(el.strokeWidth) * scale}" opacity="${opacity}" transform="${transform}"/>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${safeCssColor(state.background, "#ffffff")}"/>${elementsSvg}</svg>`;
}

export async function exportDesign(projectId: number, tenantId: string, format: string, scale: number) {
  const canvas = await getDesignCanvas(projectId, tenantId);
  if (!canvas) return null;
  const state = canvas.canvasState;
  if (format === "json") return { format: "json", data: state, filename: `design-${projectId}-v${canvas.versionNumber}.json` };
  const svg = canvasStateToSvg(state, scale);
  return { format: "svg", data: svg, filename: `design-${projectId}-v${canvas.versionNumber}.svg`, width: safeNum(state.width) * scale, height: safeNum(state.height) * scale };
}

// ── AI Regeneration ───────────────────────────────────────────────────────────

export async function aiRegenerateElement(projectId: number, tenantId: string, input: { elementId: string; prompt: string; preserve?: string[]; }) {
  const canvas = await getDesignCanvas(projectId, tenantId);
  if (!canvas) return null;
  const idx = canvas.canvasState.elements.findIndex((e) => e.id === input.elementId);
  if (idx === -1) throw new Error("Element not found");
  const element = canvas.canvasState.elements[idx]!;
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "system", content: "You are a design assistant. Given a design element and user instruction, return a JSON object with only the properties to change. Allowed properties: name, x, y, width, height, rotation, opacity, fill, stroke, strokeWidth, borderRadius, text, fontSize, fontFamily, fontWeight, textAlign, color. Never include id, type, zIndex, locked, visible, or src." }, { role: "user", content: `Element: ${JSON.stringify(element)}\nInstruction: ${input.prompt}\nPreserve: ${(input.preserve ?? []).join(", ")}\nReturn only valid JSON.` }], response_format: { type: "json_object" }, temperature: 0.4, max_tokens: 1000 });
  let changes: Record<string, unknown>;
  try { changes = JSON.parse(response.choices[0]?.message?.content ?? "{}"); } catch { changes = {}; }
  const forbidden = new Set(["id", "type", "zIndex", "locked", "visible", "src"]);
  for (const key of forbidden) delete changes[key];
  for (const key of input.preserve ?? []) delete changes[key];
  const updatedElement = { ...element, ...changes } as DesignElement;
  const newElements = [...canvas.canvasState.elements]; newElements[idx] = updatedElement;
  const newState: CanvasState = { ...canvas.canvasState, elements: newElements };
  const saveResult = await saveDesignCanvas(projectId, newState, tenantId, `AI: ${input.prompt.slice(0, 60)}`);
  return { element: updatedElement, versionId: saveResult?.versionId, versionNumber: saveResult?.versionNumber, changes };
}
