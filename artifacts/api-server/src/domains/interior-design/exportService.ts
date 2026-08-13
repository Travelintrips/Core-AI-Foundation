/**
 * WP-11 Interior Design Export Engine.
 *
 * The compiler only accepts an approved, immutable snapshot. It produces
 * bounded PDF/CSV/ZIP bytes, uploads them to the canonical ai-assets bucket,
 * and stores metadata in export_packages. No client-provided tenant, storage
 * path, filename, or source contents are trusted.
 */
import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import JSZip from "jszip";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  aiEntityVersionsTable,
  aiJobsTable,
  creativeProjectsTable,
  db,
} from "@workspace/db";
import {
  exportPackagesTable,
  idConceptDraftsTable,
  type ExportPackage,
} from "./schema.js";
import { uploadToSupabase, getSupabasePublicUrl } from "../../lib/supabaseStorage.js";
import { generateDownloadToken } from "../../services/signedUrlService.js";
import { logAudit } from "../../services/aiAuditService.js";

export const INTERIOR_EXPORT_JOB_TYPE = "interior_design_export";
export const EXPORT_DOWNLOAD_TTL_SECONDS = 7 * 24 * 60 * 60;
export const EXPORT_MAX_ROWS = 200;
export const EXPORT_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const EXPORT_MAX_ZIP_BYTES = 50 * 1024 * 1024;

export const EXPORT_FORMATS = [
  "zip",
  "specification_pdf",
  "materials_csv",
  "materials_pdf",
  "furniture_csv",
  "furniture_pdf",
  "moodboard_pdf",
] as const;
export type InteriorExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_SECTIONS = ["specification", "materials", "furniture", "moodboard"] as const;
export type InteriorExportSection = (typeof EXPORT_SECTIONS)[number];

export interface ExportSource {
  projectUuid: string;
  tenantId: string;
  sourceVersionId: string | null;
  sourceVersionNumber: number | null;
  sourceVersionHash: string;
  snapshot: {
    concept: string | null;
    spacePlan: unknown;
    materials: unknown;
    furniture: unknown;
    lighting: unknown;
    moodboard: unknown;
    assetRefs: Array<{ itemType: string; itemId: string; storagePath: string | null }>;
  };
}

export interface CreateInteriorExportInput {
  projectUuid: string;
  tenantId: string;
  format?: InteriorExportFormat;
  includedSections?: InteriorExportSection[];
  sourceVersionId?: string;
  idempotencyKey?: string;
}

export interface ExportPackageView {
  id: number;
  projectUuid: string;
  sourceVersionId: string | null;
  sourceVersionNumber: number | null;
  sourceVersionHash: string;
  format: string;
  includedSections: string[];
  status: string;
  fileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  checksum: string | null;
  retryCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  downloadUrl?: string;
  downloadExpiresAt?: string;
}

export class ExportRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ExportRequestError";
    this.code = code;
    this.status = status;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseSourceVersionId(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ExportRequestError("INVALID_SOURCE_VERSION", "sourceVersionId must be a positive integer.");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) {
    throw new ExportRequestError("INVALID_SOURCE_VERSION", "sourceVersionId is outside the supported range.");
  }
  return id;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function hashSnapshot(snapshot: unknown): string {
  return createHash("sha256").update(stableStringify(snapshot)).digest("hex");
}

function publicSnapshot(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 4000);
  if (Array.isArray(value)) return value.slice(0, EXPORT_MAX_ROWS).map((item) => publicSnapshot(item, depth + 1));
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source).slice(0, 100)) {
    if (/(secret|password|token|api[_-]?key|authorization|client[_-]?(email|name)|phone)/i.test(key)) continue;
    result[key] = publicSnapshot(item, depth + 1);
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asItems(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, EXPORT_MAX_ROWS).filter((item): item is Record<string, unknown> =>
    Boolean(item && typeof item === "object" && !Array.isArray(item)),
  );
}

function safeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.slice(0, 1000);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(publicSnapshot(value));
}

export function escapeCsvCell(value: unknown): string {
  let text = safeText(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/["\n\r,]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
}

function csvFromItems(items: Record<string, unknown>[], preferredHeaders: string[]): Buffer {
  const keys = Array.from(new Set([
    ...preferredHeaders,
    ...items.flatMap((item) => Object.keys(item).filter((key) => !/(secret|password|token|api[_-]?key|email|phone)/i.test(key))),
  ])).slice(0, 40);
  const lines = [keys.map(escapeCsvCell).join(",")];
  for (const item of items) lines.push(keys.map((key) => escapeCsvCell(item[key])).join(","));
  const body = `${lines.join("\n")}\n`;
  const result = Buffer.from(body, "utf8");
  if (result.byteLength > EXPORT_MAX_FILE_BYTES) throw new ExportRequestError("RESOURCE_CAP", "CSV export exceeds the maximum size.", 422);
  return result;
}

function pdfBuffer(title: string, lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 48, info: { Title: title, Author: "Creative AI Studio" } });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => {
      const result = Buffer.concat(chunks);
      if (result.byteLength > EXPORT_MAX_FILE_BYTES) reject(new ExportRequestError("RESOURCE_CAP", "PDF export exceeds the maximum size.", 422));
      else resolve(result);
    });
    document.on("error", reject);
    document.fontSize(18).fillColor("#15202b").text(title);
    document.moveDown(0.8);
    document.fontSize(9).fillColor("#303942");
    for (const line of lines.slice(0, 1200)) document.text(line.slice(0, 4000), { paragraphGap: 4 });
    document.end();
  });
}

function flattenLines(label: string, value: unknown): string[] {
  const safe = publicSnapshot(value);
  const text = JSON.stringify(safe, null, 2) ?? "—";
  return [`${label}:`, ...text.split("\n").slice(0, 240)];
}

function safeFilename(projectUuid: string, format: InteriorExportFormat): string {
  const suffix: Record<InteriorExportFormat, string> = {
    zip: "package.zip",
    specification_pdf: "specification.pdf",
    materials_csv: "materials.csv",
    materials_pdf: "materials.pdf",
    furniture_csv: "furniture.csv",
    furniture_pdf: "furniture.pdf",
    moodboard_pdf: "moodboard.pdf",
  };
  return `interior-design-${projectUuid.slice(0, 8)}-${suffix[format]}`;
}

function mimeFor(format: InteriorExportFormat): string {
  if (format === "zip") return "application/zip";
  if (format.endsWith("_csv")) return "text/csv; charset=utf-8";
  return "application/pdf";
}

function sectionList(format: InteriorExportFormat, requested?: InteriorExportSection[]): InteriorExportSection[] {
  const selected = requested?.length ? Array.from(new Set(requested)) : [...EXPORT_SECTIONS];
  const required: InteriorExportSection | undefined =
    format.startsWith("materials") ? "materials" :
    format.startsWith("furniture") ? "furniture" :
    format === "specification_pdf" ? "specification" :
    format === "moodboard_pdf" ? "moodboard" : undefined;
  return required && !selected.includes(required) ? [...selected, required] : selected;
}

async function getApprovedSource(
  projectUuid: string,
  tenantId: string,
  sourceVersionId?: string,
): Promise<ExportSource> {
  if (!isUuid(projectUuid)) throw new ExportRequestError("INVALID_PROJECT_UUID", "projectUuid must be a valid UUID.");

  const [project] = await db
    .select({ projectUuid: creativeProjectsTable.projectId })
    .from(creativeProjectsTable)
    .where(and(eq(creativeProjectsTable.projectId, projectUuid), sql`${creativeProjectsTable.deletedAt} IS NULL`))
    .limit(1);
  if (!project) throw new ExportRequestError("PROJECT_NOT_FOUND", "Interior Design project not found.", 404);

  let snapshot: Record<string, unknown> | null = null;
  let resolvedVersionId: string | null = null;
  let resolvedVersionNumber: number | null = null;
  if (sourceVersionId) {
    const versionId = parseSourceVersionId(sourceVersionId);
    const [version] = await db
      .select()
      .from(aiEntityVersionsTable)
      .where(and(
        eq(aiEntityVersionsTable.id, versionId),
        eq(aiEntityVersionsTable.entityType, "design_spec"),
        eq(aiEntityVersionsTable.entityId, projectUuid),
        eq(aiEntityVersionsTable.tenantId, tenantId),
        eq(aiEntityVersionsTable.isApproved, true),
        isNull(aiEntityVersionsTable.deletedAt),
      ))
      .limit(1);
    if (!version) throw new ExportRequestError("VERSION_NOT_APPROVED", "The requested version is not an approved version owned by this project.", 409);
    snapshot = asRecord(version.contentSnapshot);
    resolvedVersionId = String(version.id);
    resolvedVersionNumber = version.versionNumber;
  } else {
    const [draft] = await db
      .select()
      .from(idConceptDraftsTable)
      .where(and(eq(idConceptDraftsTable.projectUuid, projectUuid), eq(idConceptDraftsTable.reviewState, "approved_for_rendering")))
      .limit(1);
    if (!draft || draft.approvedAt === null) {
      throw new ExportRequestError("VERSION_NOT_APPROVED", "Approve the Interior Design concept before exporting.", 409);
    }
    snapshot = {
      concept: draft.approvedVisualConcept,
      spacePlan: draft.approvedSpacePlan,
      materials: draft.approvedMaterials,
      furniture: draft.approvedFurniture,
      lighting: draft.approvedLighting,
      moodboard: null,
      assetRefs: [],
      metadata: { approvedAt: draft.approvedAt.toISOString(), draftId: draft.id },
    };
    const [version] = await db
      .select()
      .from(aiEntityVersionsTable)
      .where(and(
        eq(aiEntityVersionsTable.entityType, "design_spec"),
        eq(aiEntityVersionsTable.entityId, projectUuid),
        eq(aiEntityVersionsTable.tenantId, tenantId),
        eq(aiEntityVersionsTable.isApproved, true),
        isNull(aiEntityVersionsTable.deletedAt),
      ))
      .orderBy(desc(aiEntityVersionsTable.versionNumber))
      .limit(1);
    if (version) {
      const versionSnapshot = asRecord(version.contentSnapshot);
      if (Object.keys(versionSnapshot).length > 0) {
        snapshot = versionSnapshot;
        resolvedVersionId = String(version.id);
        resolvedVersionNumber = version.versionNumber;
      }
    }
  }

  const cleaned = publicSnapshot(snapshot) as Record<string, unknown>;
  return {
    projectUuid,
    tenantId,
    sourceVersionId: resolvedVersionId,
    sourceVersionNumber: resolvedVersionNumber,
    sourceVersionHash: hashSnapshot(cleaned),
    snapshot: {
      concept: typeof cleaned["concept"] === "string" ? cleaned["concept"] : null,
      spacePlan: cleaned["spacePlan"] ?? null,
      materials: cleaned["materials"] ?? null,
      furniture: cleaned["furniture"] ?? null,
      lighting: cleaned["lighting"] ?? null,
      moodboard: cleaned["moodboard"] ?? null,
      assetRefs: Array.isArray(cleaned["assetRefs"]) ? cleaned["assetRefs"].flatMap((item) => {
        const row = asRecord(item);
        return [{ itemType: safeText(row["itemType"]), itemId: safeText(row["itemId"]), storagePath: null }];
      }) : [],
    },
  };
}

function packageView(row: ExportPackage): ExportPackageView {
  const sections = Array.isArray(row.includedSections) ? row.includedSections.filter((v): v is string => typeof v === "string") : [];
  return {
    id: row.id,
    projectUuid: row.projectUuid,
    sourceVersionId: row.sourceVersionId ?? null,
    sourceVersionNumber: row.sourceVersionNumber ?? null,
    sourceVersionHash: row.sourceVersionHash,
    format: row.format,
    includedSections: sections,
    status: row.status,
    fileName: row.fileName ?? null,
    mimeType: row.mimeType ?? null,
    fileSizeBytes: row.fileSizeBytes ?? null,
    checksum: row.checksum ?? null,
    retryCount: row.retryCount,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

export async function getExportPackage(id: number, tenantId: string): Promise<ExportPackage | null> {
  const [row] = await db.select().from(exportPackagesTable)
    .where(and(eq(exportPackagesTable.id, id), eq(exportPackagesTable.tenantId, tenantId))).limit(1);
  return row ?? null;
}

export async function getExportPackageView(id: number, tenantId: string, includeDownload = false): Promise<ExportPackageView | null> {
  const row = await getExportPackage(id, tenantId);
  if (!row) return null;
  const view = packageView(row);
  if (includeDownload && row.status === "completed" && row.storagePath) {
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return view;
    const [project] = await db.select({ id: creativeProjectsTable.id }).from(creativeProjectsTable)
      .where(eq(creativeProjectsTable.projectId, row.projectUuid)).limit(1);
    if (project) {
      const ttl = EXPORT_DOWNLOAD_TTL_SECONDS;
      const rawUrl = getSupabasePublicUrl(row.storagePath);
      const token = generateDownloadToken(project.id, rawUrl, ttl);
      view.downloadUrl = `/api/public/interior-design/exports/${row.id}/download?token=${encodeURIComponent(token)}`;
      view.downloadExpiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    }
  }
  return view;
}

export async function listExportPackages(projectUuid: string, tenantId: string): Promise<ExportPackageView[]> {
  const rows = await db.select().from(exportPackagesTable)
    .where(and(eq(exportPackagesTable.projectUuid, projectUuid), eq(exportPackagesTable.tenantId, tenantId)))
    .orderBy(desc(exportPackagesTable.createdAt)).limit(20);
  return rows.map(packageView);
}

export async function createInteriorExport(input: CreateInteriorExportInput): Promise<{ package: ExportPackageView; created: boolean }> {
  const format = input.format ?? "zip";
  if (!EXPORT_FORMATS.includes(format)) throw new ExportRequestError("INVALID_FORMAT", "Unsupported Interior Design export format.");
  const sections = sectionList(format, input.includedSections);
  const source = await getApprovedSource(input.projectUuid, input.tenantId, input.sourceVersionId);
  const idempotencyKey = (input.idempotencyKey?.trim() || `approved:${source.sourceVersionHash}`).slice(0, 200);

  const existing = await db.select().from(exportPackagesTable).where(and(
    eq(exportPackagesTable.tenantId, input.tenantId),
    eq(exportPackagesTable.projectUuid, input.projectUuid),
    eq(exportPackagesTable.sourceVersionHash, source.sourceVersionHash),
    eq(exportPackagesTable.format, format),
    eq(exportPackagesTable.idempotencyKey, idempotencyKey),
  )).limit(1);
  if (existing[0]) {
    return { package: (await getExportPackageView(existing[0].id, input.tenantId, true))!, created: false };
  }

  const inserted = await db.insert(exportPackagesTable).values({
    tenantId: input.tenantId,
    projectUuid: input.projectUuid,
    sourceVersionId: source.sourceVersionId,
    sourceVersionNumber: source.sourceVersionNumber,
    sourceVersionHash: source.sourceVersionHash,
    format,
    includedSections: sections,
    status: "queued",
    idempotencyKey,
  }).onConflictDoNothing().returning();
  const row = inserted[0] ?? (await db.select().from(exportPackagesTable).where(and(
    eq(exportPackagesTable.tenantId, input.tenantId),
    eq(exportPackagesTable.projectUuid, input.projectUuid),
    eq(exportPackagesTable.sourceVersionHash, source.sourceVersionHash),
    eq(exportPackagesTable.format, format),
    eq(exportPackagesTable.idempotencyKey, idempotencyKey),
  )).limit(1))[0];
  if (!row) throw new Error("Unable to create export package.");
  if (!inserted[0]) return { package: (await getExportPackageView(row.id, input.tenantId, true))!, created: false };

  try {
    const [job] = await db.insert(aiJobsTable).values({
      jobCode: `IDEXP-${row.id}-${Date.now().toString(36)}`,
      jobType: INTERIOR_EXPORT_JOB_TYPE,
      priority: 40,
      status: "queued",
      payloadJson: { _tenantId: input.tenantId, packageId: row.id, projectUuid: input.projectUuid },
      maxRetry: 2,
      retryStrategy: "exponential",
    }).returning();
    if (!job) throw new Error("Unable to enqueue export job.");
    await db.update(exportPackagesTable).set({ jobId: job.id, updatedAt: new Date() }).where(eq(exportPackagesTable.id, row.id));
  } catch (error) {
    await db.update(exportPackagesTable).set({ status: "failed", errorCode: "QUEUE_FAILED", errorMessage: "Export queue unavailable.", updatedAt: new Date() })
      .where(eq(exportPackagesTable.id, row.id));
    throw error;
  }
  await logAudit("interior-design-export", "export_submitted", String(row.id), "export_package", "success", {
    tenantId: input.tenantId, projectUuid: input.projectUuid, format,
  });
  return { package: (await getExportPackageView(row.id, input.tenantId, false))!, created: true };
}

export async function cancelInteriorExport(id: number, tenantId: string): Promise<ExportPackageView | null> {
  const [row] = await db.update(exportPackagesTable).set({
    status: "cancelled", errorCode: "CANCELLED", errorMessage: null, updatedAt: new Date(),
  }).where(and(
    eq(exportPackagesTable.id, id),
    eq(exportPackagesTable.tenantId, tenantId),
    sql`${exportPackagesTable.status} IN ('queued', 'generating')`,
  )).returning();
  if (!row) return null;
  if (row.jobId) await db.update(aiJobsTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(aiJobsTable.id, row.jobId));
  return packageView(row);
}

export async function retryInteriorExport(id: number, tenantId: string): Promise<{ package: ExportPackageView; created: boolean }> {
  const row = await getExportPackage(id, tenantId);
  if (!row) throw new ExportRequestError("NOT_FOUND", "Export package not found.", 404);
  if (row.status !== "failed" && row.status !== "cancelled") {
    throw new ExportRequestError("INVALID_STATE", "Only failed or cancelled exports can be retried.", 409);
  }
  return createInteriorExport({
    projectUuid: row.projectUuid,
    tenantId,
    format: row.format as InteriorExportFormat,
    includedSections: Array.isArray(row.includedSections) ? row.includedSections.filter((v): v is InteriorExportSection => typeof v === "string" && EXPORT_SECTIONS.includes(v as InteriorExportSection)) : undefined,
    sourceVersionId: row.sourceVersionId ?? undefined,
    idempotencyKey: `${row.idempotencyKey}:retry:${row.retryCount + 1}`,
  });
}

export async function buildArtifacts(source: ExportSource, format: InteriorExportFormat, sections: string[]): Promise<{ buffer: Buffer; fileName: string; mimeType: string; manifest: Record<string, unknown> }> {
  const projectTitle = `Interior Design ${source.projectUuid.slice(0, 8)}`;
  const materials = asItems(source.snapshot.materials);
  const furniture = asItems(source.snapshot.furniture);
  const spec = await pdfBuffer(`${projectTitle} — Specification`, [
    "Approved source snapshot. This document is immutable for this export.",
    ...flattenLines("Concept", source.snapshot.concept),
    ...flattenLines("Space plan", source.snapshot.spacePlan),
    ...flattenLines("Lighting", source.snapshot.lighting),
  ]);
  const materialsCsv = csvFromItems(materials, ["id", "name", "area", "category", "materialType", "color", "finish", "brand", "productCode", "notes"]);
  const materialsPdf = await pdfBuffer(`${projectTitle} — Materials`, [
    `Rows: ${materials.length}`,
    ...materials.flatMap((item, index) => [`${index + 1}. ${safeText(item["name"] ?? item["material"] ?? item["component"])}`, ...flattenLines("Details", item)]),
  ]);
  const furnitureCsv = csvFromItems(furniture, ["id", "item", "zone", "quantity", "dimensions", "notes"]);
  const furniturePdf = await pdfBuffer(`${projectTitle} — Furniture`, [
    `Rows: ${furniture.length}`,
    ...furniture.flatMap((item, index) => [`${index + 1}. ${safeText(item["item"] ?? item["name"])}`, ...flattenLines("Details", item)]),
  ]);
  const moodboardPdf = await pdfBuffer(`${projectTitle} — Moodboard`, [
    "Moodboard references are derived from the approved snapshot.",
    ...flattenLines("Moodboard", source.snapshot.moodboard),
    `Approved asset references: ${source.snapshot.assetRefs.length}`,
  ]);

  const files: Array<{ name: string; buffer: Buffer; mimeType: string; section: string }> = [
    { name: "specification.pdf", buffer: spec, mimeType: "application/pdf", section: "specification" },
    { name: "materials.csv", buffer: materialsCsv, mimeType: "text/csv; charset=utf-8", section: "materials" },
    { name: "materials.pdf", buffer: materialsPdf, mimeType: "application/pdf", section: "materials" },
    { name: "furniture.csv", buffer: furnitureCsv, mimeType: "text/csv; charset=utf-8", section: "furniture" },
    { name: "furniture.pdf", buffer: furniturePdf, mimeType: "application/pdf", section: "furniture" },
    { name: "moodboard.pdf", buffer: moodboardPdf, mimeType: "application/pdf", section: "moodboard" },
  ];
  const selected = files.filter((file) => sections.includes(file.section));
  let output = selected[0]!;
  if (format === "specification_pdf") output = files[0]!;
  if (format === "materials_csv") output = files[1]!;
  if (format === "materials_pdf") output = files[2]!;
  if (format === "furniture_csv") output = files[3]!;
  if (format === "furniture_pdf") output = files[4]!;
  if (format === "moodboard_pdf") output = files[5]!;

  const entries = selected.map((file) => ({
    fileName: file.name,
    section: file.section,
    mimeType: file.mimeType,
    fileSizeBytes: file.buffer.byteLength,
    checksum: createHash("sha256").update(file.buffer).digest("hex"),
  }));
  if (format !== "zip") {
    return { buffer: output.buffer, fileName: output.name, mimeType: output.mimeType, manifest: { format, entries: [entries.find((entry) => entry.fileName === output.name)] } };
  }
  const zip = new JSZip();
  for (const file of selected) zip.file(file.name, file.buffer);
  const manifest = { schemaVersion: "interior-export-v1", projectUuid: source.projectUuid, sourceVersionId: source.sourceVersionId, sourceVersionNumber: source.sourceVersionNumber, sourceVersionHash: source.sourceVersionHash, files: entries };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (buffer.byteLength > EXPORT_MAX_ZIP_BYTES) throw new ExportRequestError("RESOURCE_CAP", "ZIP export exceeds the maximum size.", 422);
  return { buffer, fileName: "interior-design-package.zip", mimeType: "application/zip", manifest };
}

export async function executeInteriorExportJob(job: {
  id: number;
  payloadJson: unknown;
  retryCount?: number;
  maxRetry?: number;
}): Promise<Record<string, unknown>> {
  const payload = asRecord(job.payloadJson);
  const packageId = Number(payload["packageId"]);
  const tenantId = typeof payload["_tenantId"] === "string" ? payload["_tenantId"] : "";
  if (!Number.isInteger(packageId) || !tenantId) throw new Error("interior_design_export: invalid job payload");
  const [claimed] = await db.update(exportPackagesTable).set({ status: "generating", errorCode: null, errorMessage: null, updatedAt: new Date() })
    .where(and(eq(exportPackagesTable.id, packageId), eq(exportPackagesTable.tenantId, tenantId), eq(exportPackagesTable.status, "queued"))).returning();
  if (!claimed) {
    const current = await getExportPackage(packageId, tenantId);
    if (current?.status === "completed") return { packageId, status: "already_completed" };
    if (current?.status === "cancelled") return { packageId, status: "cancelled" };
    throw new Error("Export package is no longer claimable.");
  }
  try {
    const source = await getApprovedSource(claimed.projectUuid, tenantId, claimed.sourceVersionId ?? undefined);
    if (source.sourceVersionHash !== claimed.sourceVersionHash) throw new ExportRequestError("SOURCE_CHANGED", "Approved source changed; a new export request is required.", 409);
    const sections = Array.isArray(claimed.includedSections) ? claimed.includedSections.filter((v): v is string => typeof v === "string") : [...EXPORT_SECTIONS];
    const artifact = await buildArtifacts(source, claimed.format as InteriorExportFormat, sections);
    if (artifact.buffer.byteLength > EXPORT_MAX_FILE_BYTES && claimed.format !== "zip") throw new ExportRequestError("RESOURCE_CAP", "Export exceeds the maximum size.", 422);
    const current = await getExportPackage(packageId, tenantId);
    if (current?.status === "cancelled") return { packageId, status: "cancelled" };
    const storagePath = `exports/interior-design/${tenantId}/${claimed.projectUuid}/${packageId}/${artifact.fileName}`;
    await uploadToSupabase(storagePath, artifact.buffer, artifact.mimeType);
    const checksum = createHash("sha256").update(artifact.buffer).digest("hex");
    const expiresAt = new Date(Date.now() + EXPORT_DOWNLOAD_TTL_SECONDS * 1000);
    const [completed] = await db.update(exportPackagesTable).set({
      status: "completed", storagePath, fileName: artifact.fileName, mimeType: artifact.mimeType,
      fileSizeBytes: artifact.buffer.byteLength, checksum, manifestJson: artifact.manifest,
      expiresAt, errorCode: null, errorMessage: null, updatedAt: new Date(),
    }).where(and(eq(exportPackagesTable.id, packageId), eq(exportPackagesTable.tenantId, tenantId), eq(exportPackagesTable.status, "generating"))).returning();
    if (!completed) {
      const raced = await getExportPackage(packageId, tenantId);
      if (raced?.status === "cancelled") return { packageId, status: "cancelled" };
      throw new Error("Export package changed while finalizing.");
    }
    await logAudit("interior-design-export", "export_completed", String(packageId), "export_package", "success", {
      tenantId, projectUuid: claimed.projectUuid, fileSizeBytes: artifact.buffer.byteLength,
    });
    return { packageId, status: "completed", fileSizeBytes: artifact.buffer.byteLength, checksum };
  } catch (error) {
    const message = error instanceof ExportRequestError ? error.message : "Export generation failed.";
    const code = error instanceof ExportRequestError ? error.code : "GENERATION_FAILED";
    const shouldRetry = typeof job.retryCount === "number" && typeof job.maxRetry === "number" && job.retryCount < job.maxRetry;
    await db.update(exportPackagesTable).set({
      status: shouldRetry ? "queued" : "failed",
      errorCode: code, errorMessage: message.slice(0, 500), retryCount: sql`${exportPackagesTable.retryCount} + 1`, updatedAt: new Date(),
    }).where(and(eq(exportPackagesTable.id, packageId), eq(exportPackagesTable.tenantId, tenantId), sql`${exportPackagesTable.status} = 'generating'`));
    await logAudit("interior-design-export", "export_failed", String(packageId), "export_package", "failure", { tenantId, projectUuid: claimed.projectUuid, errorCode: code });
    throw error;
  }
}

export async function resolveDownloadRedirect(id: number, token: string): Promise<string | null> {
  const row = await db.select().from(exportPackagesTable).where(eq(exportPackagesTable.id, id)).limit(1);
  const packageRow = row[0];
  if (!packageRow || packageRow.status !== "completed" || !packageRow.storagePath) return null;
  if (packageRow.expiresAt && packageRow.expiresAt.getTime() <= Date.now()) return null;
  const project = await db.select({ id: creativeProjectsTable.id }).from(creativeProjectsTable).where(eq(creativeProjectsTable.projectId, packageRow.projectUuid)).limit(1);
  if (!project[0]) return null;
  const expected = getSupabasePublicUrl(packageRow.storagePath);
  const { verifyDownloadToken } = await import("../../services/signedUrlService.js");
  const verified = verifyDownloadToken(token);
  if (!verified.valid || verified.payload?.pid !== project[0].id || verified.payload.url !== expected) return null;
  return expected;
}