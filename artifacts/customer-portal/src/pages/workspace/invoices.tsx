import { useState } from "react";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useWorkspaceInvoices } from "@/hooks/use-workspace";
import { fmtMoney, fmtDate } from "@/lib/workspace-format";
import { Loader2, Receipt, FileText, Download, Printer, CreditCard, RefreshCw, AlertCircle, CheckCircle2, Clock } from "lucide-react";

interface GenerateResult {
  documentNumber: string;
  documentType: string;
  status: string;
  generatedAt: string | null;
  accessToken: string;
  expiresAt: string;
  downloadPath: string;
}

function statusConfig(status: string): { label: string; icon: React.ReactNode; cls: string } {
  const map: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
    paid:            { label: "Lunas",          icon: <CheckCircle2 className="w-3.5 h-3.5" />, cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
    settled:         { label: "Lunas",          icon: <CheckCircle2 className="w-3.5 h-3.5" />, cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
    partially_paid:  { label: "Sebagian",       icon: <Clock className="w-3.5 h-3.5" />,        cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
    overdue:         { label: "Jatuh Tempo",    icon: <AlertCircle className="w-3.5 h-3.5" />,  cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
    issued:          { label: "Diterbitkan",    icon: <FileText className="w-3.5 h-3.5" />,     cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
    draft:           { label: "Draft",          icon: <FileText className="w-3.5 h-3.5" />,     cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
    cancelled:       { label: "Dibatalkan",     icon: <AlertCircle className="w-3.5 h-3.5" />,  cls: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
    voided:          { label: "Void",           icon: <AlertCircle className="w-3.5 h-3.5" />,  cls: "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500" },
  };
  return map[status] ?? { label: status, icon: null, cls: "bg-muted text-muted-foreground" };
}

export default function WorkspaceInvoicesPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const { data, isLoading } = useWorkspaceInvoices(token);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [generatedDocs, setGeneratedDocs] = useState<Record<number, GenerateResult>>({});
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(invoiceId: number, docType?: string) {
    setGeneratingId(invoiceId);
    setError(null);
    try {
      const resp = await fetch(
        `/api/public/customer/workspace/${token}/invoices/${invoiceId}/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(docType ? { documentType: docType } : {}),
        },
      );
      if (!resp.ok) {
        const body = await resp.json() as { error?: string };
        throw new Error(body.error ?? "Gagal membuat dokumen");
      }
      const result = await resp.json() as GenerateResult;
      setGeneratedDocs((prev) => ({ ...prev, [invoiceId]: result }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat dokumen");
    } finally {
      setGeneratingId(null);
    }
  }

  function handleDownload(downloadPath: string) {
    // downloadPath already includes /api prefix from server
    window.open(downloadPath, "_blank");
  }

  return (
    <WorkspaceLayout token={token}>
      <div className="mb-6">
        <h1 className="text-3xl font-serif font-medium mb-1">Invoice Center</h1>
        <p className="text-muted-foreground">Lihat, unduh, dan kelola semua dokumen penagihan Anda.</p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
          <Receipt className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="text-xl font-medium mb-2">Belum ada invoice</h3>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto">
            Invoice akan muncul di sini setelah proyek Anda memiliki jadwal pembayaran.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.items.map((inv) => {
            const sc = statusConfig(inv.status);
            const generated = generatedDocs[inv.id];
            const isGenerating = generatingId === inv.id;

            return (
              <div
                key={inv.id}
                id={`invoice-${inv.id}`}
                className="bg-card border border-card-border rounded-2xl p-5"
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-base">{inv.invoiceNumber}</p>
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${sc.cls}`}>
                        {sc.icon}
                        {sc.label}
                      </span>
                    </div>
                    {inv.projectNumber && (
                      <p className="text-sm text-muted-foreground">{inv.brandName ?? inv.projectNumber}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {inv.issuedAt && `Diterbitkan: ${fmtDate(inv.issuedAt)}`}
                      {inv.dueAt && ` · Jatuh Tempo: ${fmtDate(inv.dueAt)}`}
                    </p>
                  </div>
                  <div className="text-right space-y-0.5">
                    <p className="text-xl font-bold">{fmtMoney(Number(inv.total), inv.currency)}</p>
                    {inv.paidAt && (
                      <p className="text-xs text-green-600 dark:text-green-400">
                        Dibayar {fmtDate(inv.paidAt)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Action row */}
                <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-border/50">
                  {generated ? (
                    <>
                      <button
                        onClick={() => handleDownload(generated.downloadPath)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Unduh PDF
                      </button>
                      <button
                        onClick={() => handleGenerate(inv.id)}
                        disabled={isGenerating}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-muted hover:bg-muted/70 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`} />
                        Buat Ulang
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleGenerate(inv.id)}
                      disabled={isGenerating}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {isGenerating ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FileText className="w-3.5 h-3.5" />
                      )}
                      {isGenerating ? "Membuat PDF..." : "Buat PDF"}
                    </button>
                  )}

                  <button
                    onClick={() => handleGenerate(inv.id, "payment_receipt")}
                    disabled={isGenerating || inv.status !== "paid"}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-muted hover:bg-muted/70 transition-colors disabled:opacity-50"
                  >
                    <Receipt className="w-3.5 h-3.5" />
                    Tanda Terima
                  </button>

                  {["issued", "partially_paid", "overdue"].includes(inv.status) && (
                    <button
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 hover:opacity-90 transition-opacity"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      Bayar Sekarang
                    </button>
                  )}

                  <button
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-muted hover:bg-muted/70 transition-colors ml-auto"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print
                  </button>
                </div>

                {generated && (
                  <p className="text-xs text-green-600 dark:text-green-400 mt-2 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    {generated.documentNumber} siap · Valid hingga {fmtDate(generated.expiresAt)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </WorkspaceLayout>
  );
}
