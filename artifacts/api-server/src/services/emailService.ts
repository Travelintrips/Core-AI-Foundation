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

const DEFAULT_SMTP_HOST = "smtp.hostinger.com";
const DEFAULT_SMTP_PORT = 465;
const DEFAULT_SMTP_USER = "info@cstlogistic.co.id";

function resolveSmtpRuntimeConfig() {
  const host = process.env["SMTP_HOST"]?.trim() || DEFAULT_SMTP_HOST;
  const port = Number(process.env["SMTP_PORT"] ?? DEFAULT_SMTP_PORT);
  const user =
    process.env["SMTP_USER"]?.trim() ||
    process.env["SMTP_FROM"]?.trim() ||
    DEFAULT_SMTP_USER;
  const pass = process.env["SMTP_PASS"]?.trim() || "";
  const from = process.env["SMTP_FROM"]?.trim() || user;
  return { host, port, user, pass, from };
}

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  if (transporterError) return null;

  const { host, port, user, pass } = resolveSmtpRuntimeConfig();

  if (!pass) {
    transporterError = "SMTP not configured (missing SMTP_PASS)";
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

export async function verifyEmailTransport(): Promise<{ ok: boolean; error?: string }> {
  const t = getTransporter();
  if (!t) {
    return { ok: false, error: transporterError ?? "SMTP not configured" };
  }

  try {
    await t.verify();
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[email] SMTP verification failed:", error);
    return { ok: false, error };
  }
}

export type EmailTransportDiagnosticCategory =
  | "OK"
  | "MISSING_CONFIG"
  | "AUTH_FAILED"
  | "CONNECTION_TIMEOUT"
  | "CONNECTION_REFUSED"
  | "TLS_ERROR"
  | "DNS_ERROR"
  | "UNKNOWN";

export interface EmailTransportDiagnostic {
  configured: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  userConfigured: boolean;
  fromConfigured: boolean;
  ok: boolean;
  category: EmailTransportDiagnosticCategory;
}

export function classifyEmailTransportError(error: string | undefined): EmailTransportDiagnosticCategory {
  const value = (error ?? "").toLowerCase();
  if (!value) return "UNKNOWN";
  if (value.includes("smtp not configured") || value.includes("missing smtp_")) return "MISSING_CONFIG";
  if (
    value.includes("535") ||
    value.includes("authentication failed") ||
    value.includes("invalid login") ||
    value.includes("bad credentials") ||
    value.includes("auth failed")
  ) return "AUTH_FAILED";
  if (value.includes("timeout") || value.includes("etimedout")) return "CONNECTION_TIMEOUT";
  if (value.includes("econnrefused") || value.includes("connection refused")) return "CONNECTION_REFUSED";
  if (
    value.includes("certificate") ||
    value.includes("tls") ||
    value.includes("ssl") ||
    value.includes("self signed")
  ) return "TLS_ERROR";
  if (
    value.includes("enotfound") ||
    value.includes("eai_again") ||
    value.includes("getaddrinfo") ||
    value.includes("dns")
  ) return "DNS_ERROR";
  return "UNKNOWN";
}

export async function getEmailTransportDiagnostic(): Promise<EmailTransportDiagnostic> {
  const { host, port, user, pass, from } = resolveSmtpRuntimeConfig();
  const userConfigured = Boolean(user);
  const passConfigured = Boolean(pass);
  const fromConfigured = Boolean(from);
  const configured = passConfigured;

  const verified = await verifyEmailTransport();
  return {
    configured,
    host,
    port,
    secure: port === 465,
    userConfigured,
    fromConfigured,
    ok: verified.ok,
    category: verified.ok ? "OK" : classifyEmailTransportError(verified.error),
  };
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

  const { from } = resolveSmtpRuntimeConfig();

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
