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
    return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

export function fmtDateTime(date: string | null | undefined) {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export function stageColor(stage: string) {
  if (["completed", "converted_to_project", "delivered"].includes(stage))
    return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  if (["waiting_customer_approval", "quotation_ready", "waiting_review", "revision_requested"].includes(stage))
    return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  if (["cancelled"].includes(stage))
    return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  return "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300";
}
