/** Versioned, read-only SOP guidance for Handshake. Never authorizes execution. */
export const SOP_CONTENT_KEY = "handshake.sop.content.v1";
export const SOP_REPLY_KEY = "handshake.reply.templates.v1";
export const SOP_POLICY_KEY = "handshake.sop2.policy.v1";

export const DEFAULT_SOP = Object.freeze({
  title: "Resource-First, Human-Last — SOP pemulihan blocker",
  steps: [
    "Catat blocker, correlation ID, resource yang gagal, dan dampaknya.",
    "Gunakan jalur resmi yang tersedia: GitHub, AI Core, OpenClaw atau Desktop Commander pada perangkat terotorisasi.",
    "Pulihkan koneksi dengan retry terbatas dan backoff; jangan melewati autentikasi atau pembatasan keamanan.",
    "Verifikasi hasil tindakan melalui sumber status resmi, callback, dan ACK terautentikasi; jangan klaim PASS sebelum bukti lengkap.",
    "Eskalasi hanya bila perlu persetujuan keamanan, operasi destruktif, perubahan PROD berisiko, atau semua jalur sah gagal.",
  ],
  constraints: [
    "Tidak mengizinkan perubahan PROD tanpa persetujuan.",
    "Tidak mengizinkan bypass autentikasi, rate limiter, atau kebijakan alat.",
    "SOP hanya panduan baca-saja, bukan otorisasi atau bukti keberhasilan E2E.",
  ],
  canonicalCommand: "/sop blocker",
});

export type EditableSop = { title: string; steps: string[] };
export type ReplyTemplate = { id: string; event: string; enabled: boolean; text: string };
const ALLOWED_EVENTS = new Set(["JOB_RECEIVED", "JOB_QUEUED", "JOB_BLOCKED", "JOB_RESUME_REQUESTED", "JOB_COMPLETED"]);
const ALLOWED_VARS = new Set(["job_id", "status", "worker", "blocker", "next_action", "checkpoint", "time_wib"]);
function isSingleLine(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim() === value &&
    value.length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
}
export function parseEditableSop(value: unknown): EditableSop | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!isSingleLine(v.title, 180) || !Array.isArray(v.steps) ||
      v.steps.length !== 5 || !v.steps.every(s => isSingleLine(s, 750))) return null;
  return { title: v.title, steps: [...v.steps] };
}
export function parseReplyTemplates(value: unknown): ReplyTemplate[] | null {
  if (!Array.isArray(value) || value.length > 40) return null;
  const ids = new Set<string>();
  const out: ReplyTemplate[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const t = item as Record<string, unknown>;
    if (typeof t.id !== "string" || !/^[a-zA-Z0-9_-]{1,50}$/.test(t.id) ||
        ids.has(t.id) || !ALLOWED_EVENTS.has(String(t.event)) ||
        typeof t.enabled !== "boolean" || !isSingleLine(t.text, 2000)) return null;
    ids.add(t.id);
    const tokens = [...t.text.matchAll(/{{\s*([^}]+)\s*}}/g)];
    if (tokens.some(m => !ALLOWED_VARS.has(m[1].trim()))) return null;
    if (t.text.replace(/{{\s*([^}]+)\s*}}/g, "").includes("{{")) return null;
    out.push({ id: t.id, event: String(t.event), enabled: t.enabled, text: t.text });
  }
  return out;
}
export function parseRecoveryPolicy(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.enabled !== "boolean" || !Number.isInteger(v.heartbeatGraceMinutes) ||
      Number(v.heartbeatGraceMinutes) < 2 || Number(v.heartbeatGraceMinutes) > 120 ||
      !Number.isInteger(v.maxRetries) || Number(v.maxRetries) < 0 || Number(v.maxRetries) > 10 ||
      typeof v.requireAcknowledgement !== "boolean") return null;
  return { enabled: v.enabled, heartbeatGraceMinutes: Number(v.heartbeatGraceMinutes),
    maxRetries: Number(v.maxRetries), requireAcknowledgement: v.requireAcknowledgement };
}
export function parseSettingJson(raw: string | undefined): unknown {
  if (raw === undefined) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export function renderReplyTemplate(
  templates: ReplyTemplate[] | null,
  event: string,
  variables: Record<string, string>,
): string | null {
  const selected = templates?.find(t => t.enabled && t.event === event);
  if (!selected) return null;
  return selected.text.replace(/{{\s*([^}]+)\s*}}/g, (_all, name: string) =>
    (variables[name.trim()] ?? "").slice(0, 2000));
}
