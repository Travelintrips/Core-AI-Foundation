/** Versioned, read-only operational SOP. Never grants additional authority. */
export const AI_CORE_BLOCKER_SOP_VERSION = "resource-first-human-last/1";
export const AI_CORE_BLOCKER_SOP = Object.freeze({
  id: "resource-first-human-last",
  version: AI_CORE_BLOCKER_SOP_VERSION,
  title: "Resource-First, Human-Last — SOP pemulihan blocker",
  steps: [
    "Catat blocker, correlation ID, resource yang gagal, dan dampaknya.",
    "Gunakan jalur resmi yang tersedia: GitHub, AI Core, OpenClaw atau Desktop Commander pada perangkat terotorisasi.",
    "Pulihkan koneksi dengan retry terbatas dan backoff; jangan melewati autentikasi atau pembatasan keamanan.",
    "Verifikasi hasil tindakan melalui sumber status resmi, callback, dan ACK terautentikasi; jangan klaim PASS sebelum bukti lengkap.",
    "Eskalasi hanya bila perlu persetujuan keamanan, operasi destruktif, perubahan PROD berisiko, atau semua jalur sah gagal.",
  ] as const,
  constraints: [
    "Tidak mengizinkan perubahan PROD tanpa persetujuan.",
    "Tidak mengizinkan bypass autentikasi, rate limiter, atau kebijakan alat.",
    "SOP hanya panduan baca-saja, bukan otorisasi atau bukti keberhasilan E2E.",
  ] as const,
  canonicalCommand: "/sop blocker",
});
export function renderAiCoreBlockerSop(sop: { title: string; steps: readonly string[] } = AI_CORE_BLOCKER_SOP): string {
  return [
    sop.title + ":",
    ...sop.steps.map((step, index) => String(index + 1) + ". " + step),
    "SOP ini hanya respons baca-saja; tidak membuat job, tidak membuktikan delivery ke sesi ChatGPT, dan tidak memberikan persetujuan baru.",
  ].join("\n");
}
