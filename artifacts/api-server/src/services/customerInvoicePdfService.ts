/**
 * customerInvoicePdfService.ts — Server-generated PDF invoices & receipts.
 *
 * Uses pdfkit to render structured invoice documents from payment snapshots.
 * Storage: files are written to /tmp/customer-docs/ for this environment;
 * in production these should be moved to object storage (S3/GCS).
 *
 * NEVER return storage_path to the client. Issue signed document access tokens.
 * Snapshot locks in prices/amounts at generation time — never re-reads live data.
 *
 * Does NOT expose: AI cost, model name, provider key, token usage, gross margin,
 * queue/worker internals, storage credentials, or admin-only notes.
 */
import PDFDocument from "pdfkit";
import { createHmac, randomBytes } from "crypto";
import { createWriteStream, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { eq, and } from "drizzle-orm";
import {
  db,
  aiCustomerDocumentsTable,
  aiInvoicesTable,
  aiPaymentScheduleTable,
  creativeProjectsTable,
  aiServiceRequestsTable,
  aiServicesTable,
  aiServicePackagesTable,
  customerProfilesTable,
  type AiCustomerDocument,
} from "@workspace/db";

// ── Storage setup ─────────────────────────────────────────────────────────────

const DOCS_DIR = "/tmp/customer-docs";

function ensureDocsDir(): void {
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
}

// ── Signed access token for documents ────────────────────────────────────────

const SECRET = process.env["SESSION_SECRET"] ?? process.env["ADMIN_API_KEY"] ?? "insecure-dev-only-secret";

interface DocTokenPayload {
  id: string;
  docId: number;
  customerId: string; // email_hash
  exp: number;
}

export function generateDocumentAccessToken(docId: number, customerId: string, ttlSeconds = 3600): string {
  const payload: DocTokenPayload = {
    id: randomBytes(8).toString("hex"),
    docId,
    customerId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export interface DocTokenVerifyResult {
  valid: boolean;
  reason?: string;
  payload?: DocTokenPayload;
}

export function verifyDocumentAccessToken(token: string): DocTokenVerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "Malformed token" };
  const [encoded, sig] = parts as [string, string];
  const expectedSig = createHmac("sha256", SECRET).update(encoded).digest("base64url");
  if (sig !== expectedSig) return { valid: false, reason: "Invalid signature" };
  let payload: DocTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as DocTokenPayload;
  } catch {
    return { valid: false, reason: "Malformed payload" };
  }
  if (Math.floor(Date.now() / 1000) > payload.exp) return { valid: false, reason: "Token expired" };
  return { valid: true, payload };
}

// ── Invoice snapshot (frozen at generation time) ──────────────────────────────

export interface InvoiceSnapshot {
  documentNumber: string;
  documentType: "deposit_invoice" | "remaining_invoice" | "final_invoice" | "payment_receipt";
  issueDate: string;
  dueDate: string | null;
  customerName: string;
  companyName: string | null;
  customerEmail: string;
  taxId: string | null;
  address: string | null;
  projectNumber: string;
  serviceName: string;
  packageName: string | null;
  lineItems: { label: string; amount: number; currency: string }[];
  subtotal: number;
  discount: number;
  tax: number;
  grandTotal: number;
  amountPaid: number;
  remainingBalance: number;
  currency: string;
  paymentStatus: string;
  paymentReference: string | null;
  terms: string;
  generatedAt: string;
}

/** Build a frozen snapshot from a creative project invoice + payment schedule. */
export async function buildInvoiceSnapshot(
  invoiceId: number,
  customerEmailHash: string,
  clientEmail: string,
  clientName: string,
  documentType: InvoiceSnapshot["documentType"],
): Promise<InvoiceSnapshot | null> {
  const [inv] = await db.select().from(aiInvoicesTable).where(eq(aiInvoicesTable.id, invoiceId));
  if (!inv) return null;

  const [project] = await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.id, inv.projectId));
  if (!project) return null;

  const schedule = inv.paymentScheduleId
    ? (await db.select().from(aiPaymentScheduleTable).where(eq(aiPaymentScheduleTable.id, inv.paymentScheduleId)))[0]
    : undefined;

  // Service info (service-catalog flow)
  let serviceName = "Creative AI Service";
  let packageName: string | null = null;
  if (project.serviceRequestId) {
    const [sr] = await db.select().from(aiServiceRequestsTable).where(eq(aiServiceRequestsTable.id, project.serviceRequestId));
    if (sr) {
      const [svc] = await db.select().from(aiServicesTable).where(eq(aiServicesTable.id, sr.serviceId));
      serviceName = svc?.serviceName ?? serviceName;
      if (sr.packageId) {
        const [pkg] = await db.select().from(aiServicePackagesTable).where(eq(aiServicePackagesTable.id, sr.packageId));
        packageName = pkg?.packageName ?? null;
      }
    }
  }

  // Customer profile for billing address
  const [profile] = await db.select().from(customerProfilesTable).where(eq(customerProfilesTable.emailHash, customerEmailHash));

  // Payment totals
  const allSchedules = await db.select().from(aiPaymentScheduleTable).where(eq(aiPaymentScheduleTable.projectId, inv.projectId));
  const grandTotal = allSchedules.reduce((s, p) => s + Number(p.amount), 0);
  const amountPaid = allSchedules.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0);
  const remainingBalance = grandTotal - amountPaid;

  // Line items: use frozen snapshot from invoice if available, otherwise derive
  const lineItems: InvoiceSnapshot["lineItems"] = inv.lineItemsJson?.length
    ? inv.lineItemsJson.map((li) => ({ label: li.label, amount: li.amount, currency: inv.currency }))
    : [{ label: `${serviceName}${packageName ? ` — ${packageName}` : ""}`, amount: Number(inv.amount), currency: inv.currency }];

  const now = new Date();
  const docNumber = generateDocumentNumber(documentType, invoiceId, now);

  return {
    documentNumber: docNumber,
    documentType,
    issueDate: now.toISOString().split("T")[0]!,
    dueDate: schedule?.dueDate ? schedule.dueDate.toISOString().split("T")[0]! : null,
    customerName: clientName,
    companyName: profile?.companyName ?? null,
    customerEmail: clientEmail,
    taxId: profile?.taxId ?? null,
    address: profile?.address ?? null,
    projectNumber: project.projectId,
    serviceName,
    packageName,
    lineItems,
    subtotal: Number(inv.amount),
    discount: 0,
    tax: 0,
    grandTotal,
    amountPaid,
    remainingBalance,
    currency: inv.currency,
    paymentStatus: schedule?.status ?? inv.status,
    paymentReference: null,
    terms: "Pembayaran dilakukan sesuai jadwal yang disepakati.",
    generatedAt: now.toISOString(),
  };
}

function generateDocumentNumber(type: string, invoiceId: number, date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const prefix = type === "payment_receipt" ? "RCP" : "INV";
  return `${prefix}-${year}${month}-${String(invoiceId).padStart(4, "0")}`;
}

// ── PDF rendering ─────────────────────────────────────────────────────────────

function fmtMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency, minimumFractionDigits: 0 }).format(amount);
}

function renderPdf(snapshot: InvoiceSnapshot): Promise<{ buffer: Buffer; fileSize: number }> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => {
      const buffer = Buffer.concat(chunks);
      resolve({ buffer, fileSize: buffer.length });
    });
    doc.on("error", reject);

    const black = "#1a1a1a";
    const grey = "#6b7280";
    const accent = "#2563eb";
    const lineY = () => doc.y;

    // Header
    doc.fontSize(22).fillColor(accent).text("Creative AI Studio", 50, 50);
    doc.fontSize(9).fillColor(grey).text("creativestudio.id  ·  halo@creativestudio.id", 50, 78);

    // Document type label
    const typeLabel: Record<string, string> = {
      deposit_invoice: "INVOICE DEPOSIT",
      remaining_invoice: "INVOICE PELUNASAN",
      final_invoice: "INVOICE FINAL",
      payment_receipt: "TANDA TERIMA PEMBAYARAN",
    };
    doc.fontSize(14).fillColor(black).text(typeLabel[snapshot.documentType] ?? "INVOICE", 350, 50, { align: "right", width: 200 });
    doc.fontSize(9).fillColor(grey)
      .text(`No: ${snapshot.documentNumber}`, 350, 70, { align: "right", width: 200 })
      .text(`Tgl: ${snapshot.issueDate}`, 350, 82, { align: "right", width: 200 });
    if (snapshot.dueDate) {
      doc.text(`Jatuh Tempo: ${snapshot.dueDate}`, 350, 94, { align: "right", width: 200 });
    }

    // Divider
    doc.moveTo(50, 115).lineTo(545, 115).strokeColor("#e5e7eb").stroke();

    // Bill To
    doc.fontSize(9).fillColor(grey).text("TAGIHAN KEPADA", 50, 125);
    doc.fontSize(10).fillColor(black).text(snapshot.companyName ?? snapshot.customerName, 50, 140);
    doc.fontSize(9).fillColor(grey).text(snapshot.customerEmail, 50, 153);
    if (snapshot.address) doc.text(snapshot.address, 50, 165, { width: 220 });
    if (snapshot.taxId) doc.text(`NPWP: ${snapshot.taxId}`, 50, doc.y + 3);

    // Project ref
    doc.fontSize(9).fillColor(grey).text("REFERENSI PROYEK", 350, 125);
    doc.fontSize(10).fillColor(black).text(snapshot.projectNumber, 350, 140);
    doc.fontSize(9).fillColor(grey).text(snapshot.serviceName, 350, 153);
    if (snapshot.packageName) doc.text(snapshot.packageName, 350, 165);

    // Line items table
    const tableTop = Math.max(lineY() + 30, 210);
    doc.moveTo(50, tableTop).lineTo(545, tableTop).strokeColor("#e5e7eb").stroke();
    doc.fontSize(9).fillColor(grey)
      .text("DESKRIPSI", 50, tableTop + 8)
      .text("JUMLAH", 450, tableTop + 8, { align: "right", width: 95 });
    doc.moveTo(50, tableTop + 22).lineTo(545, tableTop + 22).strokeColor("#e5e7eb").stroke();

    let rowY = tableTop + 28;
    for (const item of snapshot.lineItems) {
      doc.fontSize(10).fillColor(black).text(item.label, 50, rowY, { width: 370 });
      doc.text(fmtMoney(item.amount, item.currency), 450, rowY, { align: "right", width: 95 });
      rowY = doc.y + 4;
    }

    doc.moveTo(50, rowY + 8).lineTo(545, rowY + 8).strokeColor("#e5e7eb").stroke();
    rowY += 18;

    // Totals
    const totalsLeft = 350;
    const totalsValueRight = 545;

    function totalRow(label: string, value: number, bold = false): void {
      doc.fontSize(9).fillColor(bold ? black : grey)
        .text(label, totalsLeft, rowY)
        .text(fmtMoney(value, snapshot.currency), totalsLeft, rowY, { align: "right", width: totalsValueRight - totalsLeft });
      rowY += 16;
    }

    totalRow("Subtotal", snapshot.subtotal);
    if (snapshot.discount > 0) totalRow("Diskon", -snapshot.discount);
    if (snapshot.tax > 0) totalRow("PPN", snapshot.tax);
    totalRow("Total", snapshot.grandTotal, true);

    if (snapshot.documentType !== "payment_receipt") {
      doc.moveTo(totalsLeft, rowY).lineTo(totalsValueRight, rowY).strokeColor("#e5e7eb").stroke();
      rowY += 10;
      totalRow("Sudah Dibayar", snapshot.amountPaid);
      doc.fontSize(11).fillColor(accent)
        .text("Sisa Tagihan", totalsLeft, rowY)
        .text(fmtMoney(snapshot.remainingBalance, snapshot.currency), totalsLeft, rowY, { align: "right", width: totalsValueRight - totalsLeft });
      rowY += 20;
    } else {
      doc.moveTo(totalsLeft, rowY).lineTo(totalsValueRight, rowY).strokeColor("#e5e7eb").stroke();
      rowY += 10;
      doc.fontSize(11).fillColor("#16a34a")
        .text("LUNAS", totalsLeft, rowY)
        .text(fmtMoney(snapshot.amountPaid, snapshot.currency), totalsLeft, rowY, { align: "right", width: totalsValueRight - totalsLeft });
    }

    // Terms & footer
    const footerY = 720;
    doc.moveTo(50, footerY).lineTo(545, footerY).strokeColor("#e5e7eb").stroke();
    doc.fontSize(8).fillColor(grey)
      .text(snapshot.terms, 50, footerY + 10, { width: 350 })
      .text(`Generated: ${new Date(snapshot.generatedAt).toLocaleString("id-ID")}`, 350, footerY + 10, { align: "right", width: 195 });

    doc.end();
  });
}

// ── Save document record ──────────────────────────────────────────────────────

export interface SavedDocument {
  document: AiCustomerDocument;
  storagePath: string;
}

export async function saveDocumentRecord(
  snapshot: InvoiceSnapshot,
  pdfBuffer: Buffer,
  fileSize: number,
  customerEmailHash: string,
  invoiceId: number,
  projectId: string | null,
  paymentScheduleId: number | null,
): Promise<SavedDocument> {
  ensureDocsDir();
  const fileName = `${snapshot.documentNumber.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
  const storagePath = join(DOCS_DIR, fileName);

  // Write to disk
  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(storagePath);
    ws.write(pdfBuffer);
    ws.end();
    ws.on("finish", resolve);
    ws.on("error", reject);
  });

  // Upsert document record (idempotent by documentNumber)
  const [existing] = await db
    .select()
    .from(aiCustomerDocumentsTable)
    .where(
      and(
        eq(aiCustomerDocumentsTable.customerId, customerEmailHash),
        eq(aiCustomerDocumentsTable.documentNumber, snapshot.documentNumber),
      ),
    );

  if (existing) {
    const [updated] = await db
      .update(aiCustomerDocumentsTable)
      .set({ storagePath, fileSize, status: "issued", generatedAt: new Date(), snapshotJson: snapshot as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(aiCustomerDocumentsTable.id, existing.id))
      .returning();
    return { document: updated!, storagePath };
  }

  const [inserted] = await db
    .insert(aiCustomerDocumentsTable)
    .values({
      customerId: customerEmailHash,
      clientEmail: snapshot.customerEmail,
      projectId,
      paymentScheduleId,
      documentType: snapshot.documentType,
      documentNumber: snapshot.documentNumber,
      fileName,
      storagePath,
      mimeType: "application/pdf",
      fileSize,
      status: "issued",
      snapshotJson: snapshot as unknown as Record<string, unknown>,
      generatedAt: new Date(),
    })
    .returning();

  return { document: inserted!, storagePath };
}

// ── Public generate helpers ───────────────────────────────────────────────────

type GenerateResult =
  | { ok: true; document: AiCustomerDocument; accessToken: string; expiresAt: string; documentNumber: string }
  | { ok: false; error: string };

async function generateDocument(
  invoiceId: number,
  customerEmailHash: string,
  clientEmail: string,
  clientName: string,
  documentType: InvoiceSnapshot["documentType"],
  projectId: string | null,
  paymentScheduleId: number | null,
): Promise<GenerateResult> {
  const snapshot = await buildInvoiceSnapshot(invoiceId, customerEmailHash, clientEmail, clientName, documentType);
  if (!snapshot) return { ok: false, error: "Invoice not found" };

  const { buffer, fileSize } = await renderPdf(snapshot);
  const { document } = await saveDocumentRecord(snapshot, buffer, fileSize, customerEmailHash, invoiceId, projectId, paymentScheduleId);

  const accessToken = generateDocumentAccessToken(document.id, customerEmailHash);
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

  return { ok: true, document, accessToken, expiresAt, documentNumber: snapshot.documentNumber };
}

export async function generateDepositInvoice(invoiceId: number, emailHash: string, email: string, name: string, projectId: string | null, scheduleId: number | null): Promise<GenerateResult> {
  return generateDocument(invoiceId, emailHash, email, name, "deposit_invoice", projectId, scheduleId);
}

export async function generateRemainingInvoice(invoiceId: number, emailHash: string, email: string, name: string, projectId: string | null, scheduleId: number | null): Promise<GenerateResult> {
  return generateDocument(invoiceId, emailHash, email, name, "remaining_invoice", projectId, scheduleId);
}

export async function generateFinalInvoice(invoiceId: number, emailHash: string, email: string, name: string, projectId: string | null, scheduleId: number | null): Promise<GenerateResult> {
  return generateDocument(invoiceId, emailHash, email, name, "final_invoice", projectId, scheduleId);
}

export async function generatePaymentReceipt(invoiceId: number, emailHash: string, email: string, name: string, projectId: string | null, scheduleId: number | null): Promise<GenerateResult> {
  return generateDocument(invoiceId, emailHash, email, name, "payment_receipt", projectId, scheduleId);
}

// ── Access token to file path ─────────────────────────────────────────────────

export async function resolveDocumentForDownload(
  token: string,
  requestingCustomerId: string,
): Promise<{ ok: true; storagePath: string; fileName: string; mimeType: string } | { ok: false; reason: string; status: 401 | 403 | 404 }> {
  const verified = verifyDocumentAccessToken(token);
  if (!verified.valid) return { ok: false, reason: verified.reason ?? "Invalid token", status: 401 };

  const { docId, customerId } = verified.payload!;

  // Ownership check — prevent cross-customer access
  if (customerId !== requestingCustomerId) {
    return { ok: false, reason: "Access denied", status: 403 };
  }

  const [doc] = await db.select().from(aiCustomerDocumentsTable).where(eq(aiCustomerDocumentsTable.id, docId));
  if (!doc || doc.customerId !== requestingCustomerId) return { ok: false, reason: "Document not found", status: 404 };
  if (doc.status === "voided") return { ok: false, reason: "Document has been voided", status: 404 };
  if (!doc.storagePath || !existsSync(doc.storagePath)) return { ok: false, reason: "Document file not found", status: 404 };

  return { ok: true, storagePath: doc.storagePath, fileName: doc.fileName, mimeType: doc.mimeType };
}

// ── List documents for customer ───────────────────────────────────────────────

export interface CustomerDocumentDto {
  id: number;
  documentType: string;
  documentNumber: string;
  fileName: string;
  mimeType: string;
  fileSize: number | null;
  status: string;
  generatedAt: string | null;
  projectId: string | null;
  paymentScheduleId: number | null;
}

export async function listCustomerDocuments(customerEmailHash: string, projectId?: string): Promise<CustomerDocumentDto[]> {
  const rows = await db
    .select()
    .from(aiCustomerDocumentsTable)
    .where(
      projectId
        ? and(eq(aiCustomerDocumentsTable.customerId, customerEmailHash), eq(aiCustomerDocumentsTable.projectId, projectId))
        : eq(aiCustomerDocumentsTable.customerId, customerEmailHash),
    );

  return rows
    .filter((d) => d.status !== "voided")
    .map((d) => ({
      id: d.id,
      documentType: d.documentType,
      documentNumber: d.documentNumber,
      fileName: d.fileName,
      mimeType: d.mimeType,
      fileSize: d.fileSize,
      status: d.status,
      generatedAt: d.generatedAt?.toISOString() ?? null,
      projectId: d.projectId,
      paymentScheduleId: d.paymentScheduleId,
    }));
}
