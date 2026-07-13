import { CheckCircle2, Clock, AlertCircle, XCircle } from "lucide-react";
import { formatMoney, formatDate } from "@/lib/commercial-format";

export type ScheduleInstallment = {
  id: number;
  paymentType: string;
  amount: string | number;
  currency: string;
  status: string; // pending | partially_paid | paid | failed | refunded | cancelled
  reference?: string | null;
  dueDate?: string | null;
  paidAt?: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  deposit: "Deposit",
  remaining_balance: "Pelunasan",
  full_payment: "Pembayaran Penuh",
  custom_installment: "Cicilan",
  subscription_charge: "Tagihan Langganan",
};

function stepMeta(status: string): { label: string; icon: React.ReactNode; cls: string } {
  switch (status) {
    case "paid":
      return { label: "Lunas", icon: <CheckCircle2 className="w-4 h-4" />, cls: "text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30" };
    case "partially_paid":
      return { label: "Sebagian Dibayar", icon: <Clock className="w-4 h-4" />, cls: "text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30" };
    case "failed":
      return { label: "Gagal", icon: <XCircle className="w-4 h-4" />, cls: "text-destructive bg-destructive/10" };
    case "refunded":
      return { label: "Dikembalikan", icon: <XCircle className="w-4 h-4" />, cls: "text-muted-foreground bg-muted" };
    case "cancelled":
      return { label: "Dibatalkan", icon: <XCircle className="w-4 h-4" />, cls: "text-muted-foreground bg-muted" };
    default:
      return { label: "Menunggu Pembayaran", icon: <AlertCircle className="w-4 h-4" />, cls: "text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30" };
  }
}

/**
 * Ordered list of payment installments with a progress summary. Only shows
 * dueDate/paidAt when the API actually returned them (both are real columns
 * on ai_payment_schedule and are included in the checkout response — no
 * fabricated dates).
 */
export function PaymentScheduleTimeline({ installments }: { installments: ScheduleInstallment[] }) {
  if (installments.length === 0) return null;

  const paidCount = installments.filter((i) => i.status === "paid").length;
  const currency = installments[0]?.currency ?? "IDR";
  const totalPaid = installments.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.amount), 0);
  const totalAll = installments.reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold text-sm">Jadwal Pembayaran</h3>
        <span className="text-xs text-muted-foreground">
          {paidCount}/{installments.length} lunas
        </span>
      </div>
      {totalAll > 0 && (
        <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-5 mt-2">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, (totalPaid / totalAll) * 100)}%` }} />
        </div>
      )}

      <ol className="space-y-3">
        {installments.map((inst, idx) => {
          const meta = stepMeta(inst.status);
          const due = formatDate(inst.dueDate);
          const paid = formatDate(inst.paidAt);
          return (
            <li key={inst.id} className="flex items-start gap-3 rounded-xl border border-border/60 p-3.5">
              <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${meta.cls}`}>{meta.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-medium">
                    {TYPE_LABEL[inst.paymentType] ?? inst.paymentType}
                    <span className="text-muted-foreground font-normal"> · Termin {idx + 1}</span>
                  </p>
                  <span className="font-semibold text-sm tabular-nums">{formatMoney(inst.amount, inst.currency)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {meta.label}
                  {inst.status === "paid" && paid ? ` · dibayar ${paid}` : due ? ` · jatuh tempo ${due}` : ""}
                  {inst.reference ? ` · ref: ${inst.reference}` : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
