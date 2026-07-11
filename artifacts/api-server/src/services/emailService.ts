import nodemailer, { type Transporter } from "nodemailer";
import { logAudit } from "./aiAuditService.js";

/**
 * Thin SMTP wrapper around nodemailer. Configured via SMTP_HOST / SMTP_PORT /
 * SMTP_USER / SMTP_PASS / SMTP_FROM secrets. Never throws to callers — email
 * failures must not break the underlying business flow (quotation issuance,
 * status changes, etc). Callers should check the returned `ok` flag if they
 * want to surface delivery failure to the admin.
 */

let transporter: Transporter | null = null;
let transporterError: string | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  if (transporterError) return null;

  const host = process.env["SMTP_HOST"];
  const port = Number(process.env["SMTP_PORT"] ?? 587);
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];

  if (!host || !user || !pass) {
    transporterError = "SMTP not configured (missing SMTP_HOST/SMTP_USER/SMTP_PASS)";
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return transporter;
}

export function isEmailConfigured(): boolean {
  return getTransporter() !== null;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  module: string; // for audit logging, e.g. "catalog", "client-review"
  action: string; // e.g. "quotation_email_sent"
  resourceId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { to, subject, html, text, module, action, resourceId } = params;

  const t = getTransporter();
  if (!t) {
    const error = transporterError ?? "SMTP not configured";
    console.warn(`[email] Skipped sending "${subject}" to ${to}: ${error}`);
    await logAudit(module, action, resourceId, "email", "failure", { to, subject, error });
    return { ok: false, error };
  }

  const from = process.env["SMTP_FROM"] || process.env["SMTP_USER"];

  try {
    const info = await t.sendMail({ from, to, subject, html, text: text ?? htmlToText(html) });
    await logAudit(module, action, resourceId, "email", "success", { to, subject, messageId: info.messageId });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[email] Failed to send "${subject}" to ${to}:`, error);
    await logAudit(module, action, resourceId, "email", "failure", { to, subject, error });
    return { ok: false, error };
  }
}

function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
