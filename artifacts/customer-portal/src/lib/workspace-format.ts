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
  // Terminal / completed
  if (["completed", "order_completed", "converted_to_project", "delivered", "files_unlocked"].includes(stage))
    return "bg-emerald-100 text-emerald-800 border border-emerald-200";
  // Files ready / near-complete
  if (["deliverable_ready", "commercial_completed"].includes(stage))
    return "bg-emerald-100 text-emerald-800 border border-emerald-200";
  // Workflow / production completing
  if (["workflow_completed", "production_completed"].includes(stage))
    return "bg-violet-100 text-violet-800 border border-violet-200";
  // Action required — review / approval / quotation
  if (["waiting_customer_approval", "quotation_ready", "waiting_review", "waiting_client_review",
       "waiting_customer_review", "revision_requested", "revision", "sent", "issued", "quoted",
       "waiting_payment", "pending_payment", "waiting_remaining_payment"].includes(stage))
    return "bg-amber-100 text-amber-800 border border-amber-200";
  // Payment verification
  if (["waiting_payment_verification", "waiting_commercial_gate", "deposit_paid",
       "payment_verified", "remaining_paid"].includes(stage))
    return "bg-blue-100 text-blue-800 border border-blue-200";
  // Cancelled / failed
  if (["cancelled", "failed"].includes(stage))
    return "bg-red-100 text-red-800 border border-red-200";
  // Active production
  if (["running", "in_progress", "generating", "generating_document", "generating_presentation",
       "ready_to_build", "building", "orchestrating", "internal_review"].includes(stage))
    return "bg-orange-100 text-orange-800 border border-orange-200";
  // Pre-production (draft, brief, pending queue)
  return "bg-sky-100 text-sky-800 border border-sky-200";
}

export function stageLabel(stage: string) {
  const map: Record<string, string> = {
    // Pre-production
    draft: "Waiting Brief",
    brief_in_progress: "Waiting Brief",
    brief_submitted: "Brief Submitted",
    brief_completed: "Brief Submitted",
    pending: "Menunggu",
    // Commercial gate
    waiting_customer_approval: "Menunggu Persetujuan",
    quotation_ready: "Quotation Siap",
    sent: "Waiting Approval",
    issued: "Waiting Approval",
    quoted: "Quotation Ready",
    waiting_payment: "Waiting Payment",
    pending_payment: "Waiting Payment",
    waiting_remaining_payment: "Waiting Payment",
    waiting_payment_verification: "Payment Verification",
    waiting_commercial_gate: "Payment Verification",
    deposit_paid: "Payment Verification",
    // Production
    payment_verified: "In Production",
    remaining_paid: "In Production",
    ready_to_build: "In Production",
    building: "In Production",
    orchestrating: "In Production",
    internal_review: "In Production",
    running: "Berjalan",
    in_progress: "Dalam Proses",
    generating: "Generating",
    generating_document: "Preparing Document",
    generating_presentation: "Preparing Presentation",
    // Review / revision
    waiting_review: "Menunggu Review",
    waiting_client_review: "Menunggu Review",
    waiting_customer_review: "Menunggu Review",
    revision_requested: "Revisi Diminta",
    revision: "Revisi",
    // Delivery
    workflow_completed: "Preparing Files",
    production_completed: "Preparing Files",
    deliverable_ready: "Files Ready",
    commercial_completed: "Files Ready",
    files_unlocked: "Files Unlocked",
    // Terminal
    completed: "Selesai",
    order_completed: "Selesai",
    converted_to_project: "Proyek Aktif",
    delivered: "Delivered",
    cancelled: "Dibatalkan",
    failed: "Failed",
  };
  return map[stage] ?? stage.replace(/_/g, " ");
}
