import { WorkspaceLayout } from "@/components/workspace-layout";
import { useWorkspaceInvoices } from "@/hooks/use-workspace";
import { fmtMoney, fmtDate } from "@/lib/workspace-format";
import { Loader2, Receipt, Printer } from "lucide-react";

function statusColor(status: string) {
  if (["paid", "settled"].includes(status)) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  if (["overdue"].includes(status)) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
}

export default function WorkspaceInvoicesPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const { data, isLoading } = useWorkspaceInvoices(token);

  return (
    <WorkspaceLayout token={token}>
      <div className="mb-6">
        <h1 className="text-3xl font-serif font-medium mb-1">Invoice Center</h1>
        <p className="text-muted-foreground">Track and print your billing history.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : !data || data.items.length === 0 ? (
        <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
          <Receipt className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-xl font-medium mb-2">No invoices yet</h3>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-2xl divide-y divide-border/60">
          {data.items.map((inv) => (
            <div key={inv.id} id={`invoice-${inv.id}`} className="p-5">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="font-medium">{inv.invoiceNumber}</p>
                  <p className="text-xs text-muted-foreground">{inv.brandName ?? "—"} · Issued {fmtDate(inv.issuedAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor(inv.status)}`}>{inv.status}</span>
                  <span className="font-semibold">{fmtMoney(inv.total, inv.currency)}</span>
                  <button
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-muted hover:bg-muted/70 transition-colors"
                    data-testid={`button-print-invoice-${inv.id}`}
                  >
                    <Printer className="w-3.5 h-3.5" /> Print / Save PDF
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </WorkspaceLayout>
  );
}
