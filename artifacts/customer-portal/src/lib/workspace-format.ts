export function fmtFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fmtMoney(amount: string | number | null | undefined, currency = "IDR") {
  if (amount === null || amount === undefined) return "—";
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(n)) return "—";
  if (currency === "IDR") return `Rp${Math.round(n).toLocaleString("id-ID")}`;
  return `${currency} ${n.toLocaleString()}`;
}

export function fmtDate(date: string | null | undefined) {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleDateString("id-ID", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

export function fmtDateTime(date: string | null | undefined) {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleString("id-ID", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export function stageColor(stage: string) {
  if (["completed", "converted_to_project", "delivered"].includes(stage))
    return "bg-emerald-100 text-emerald-800 border border-emerald-200";
  if (["waiting_customer_approval", "quotation_ready", "waiting_review", "revision_requested"].includes(stage))
    return "bg-amber-100 text-amber-800 border border-amber-200";
  if (["cancelled"].includes(stage))
    return "bg-red-100 text-red-800 border border-red-200";
  if (["running", "in_progress", "generating"].includes(stage))
    return "bg-orange-100 text-orange-800 border border-orange-200";
  return "bg-sky-100 text-sky-800 border border-sky-200";
}

export function stageLabel(stage: string) {
  const map: Record<string, string> = {
    pending: "Menunggu",
    running: "Berjalan",
    in_progress: "Dalam Proses",
    generating: "Generating",
    waiting_customer_approval: "Menunggu Persetujuan",
    quotation_ready: "Quotation Siap",
    waiting_review: "Menunggu Review",
    revision_requested: "Revisi Diminta",
    completed: "Selesai",
    converted_to_project: "Proyek Aktif",
    delivered: "Delivered",
    cancelled: "Dibatalkan",
  };
  return map[stage] ?? stage.replace(/_/g, " ");
}
