import { useState } from "react";
import { Link } from "wouter";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useWorkspaceProjectDetail, useSignDownload, useRepeatOrder } from "@/hooks/use-workspace";
import { fmtMoney, fmtDate, fmtDateTime, stageColor } from "@/lib/workspace-format";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, ArrowLeft, CheckCircle2, Circle, Download, Lock, FileText, Sparkles, RefreshCw,
} from "lucide-react";

const TABS = ["Overview", "Timeline", "Deliverables", "Reviews", "Payments", "Invoices"] as const;
type Tab = (typeof TABS)[number];

export default function WorkspaceProjectDetailPage({ params }: { params: { token: string; projectNumber: string } }) {
  const { token, projectNumber } = params;
  const [tab, setTab] = useState<Tab>("Overview");
  const { data, isLoading, error } = useWorkspaceProjectDetail(token, projectNumber);
  const signDownload = useSignDownload(token);
  const repeatOrder = useRepeatOrder(token);
  const { toast } = useToast();

  if (isLoading) {
    return (
      <WorkspaceLayout token={token}>
        <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      </WorkspaceLayout>
    );
  }

  if (error || !data) {
    return (
      <WorkspaceLayout token={token}>
        <div className="text-center py-24">
          <h2 className="text-2xl font-serif mb-2">Project not found</h2>
          <Link href={`/workspace/${token}/projects`} className="text-primary hover:underline">Back to projects</Link>
        </div>
      </WorkspaceLayout>
    );
  }

  const { overview } = data;

  async function handleDownload(assetId: number, locked: boolean) {
    if (locked) {
      toast({ title: "File locked", description: "This file unlocks once payment is verified.", variant: "destructive" });
      return;
    }
    try {
      const res = await signDownload.mutateAsync(assetId);
      window.open(res.downloadUrl, "_blank");
    } catch (e) {
      toast({ title: "Could not generate link", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function handleRepeatOrder(mode: "similar" | "duplicate" | "use_brief") {
    try {
      const res = await repeatOrder.mutateAsync({ projectNumber, mode });
      window.location.href = res.redirectTo;
    } catch (e) {
      toast({ title: "Could not start repeat order", description: (e as Error).message, variant: "destructive" });
    }
  }

  return (
    <WorkspaceLayout token={token}>
      <Link href={`/workspace/${token}/projects`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to projects
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-serif font-medium mb-1">{overview.brandName}</h1>
          <p className="text-muted-foreground">{overview.serviceName}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium px-3 py-1.5 rounded-full ${stageColor(overview.currentStage)}`}>
            {overview.currentStageLabel}
          </span>
          <button
            onClick={() => handleRepeatOrder("similar")}
            disabled={repeatOrder.isPending}
            className="inline-flex items-center gap-1.5 text-sm font-medium bg-foreground text-background px-4 py-2 rounded-full hover:bg-foreground/90 transition-colors disabled:opacity-50"
            data-testid="button-repeat-order"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Repeat Order
          </button>
        </div>
      </div>

      {data.recommendations.length > 0 && (
        <div className="mb-6 bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
          <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">You might also like</p>
            <p className="text-sm text-muted-foreground">{data.recommendations.join(", ")}</p>
          </div>
        </div>
      )}

      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`tab-${t.toLowerCase()}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            ["Business Type", overview.businessType],
            ["Target Market", overview.targetMarket],
            ["Product / Service", overview.productOrService],
            ["Goal", overview.goal],
            ["Style Preference", overview.stylePreference],
            ["Color Preference", overview.colorPreference],
            ["Delivery Date", overview.deliveryDate ? fmtDate(overview.deliveryDate) : "—"],
            ["Total", overview.total ? fmtMoney(overview.total, overview.currency) : "—"],
          ].filter(([, v]) => v).map(([label, value]) => (
            <div key={label} className="bg-card border border-card-border rounded-2xl p-5">
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className="font-medium">{value}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "Timeline" && (
        <div className="bg-card border border-card-border rounded-2xl p-6">
          <ol className="space-y-1">
            {data.timeline.map((s, i) => (
              <li key={i} className="flex items-center gap-3 py-2">
                {s.completed ? (
                  <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                ) : s.current ? (
                  <div className="w-5 h-5 rounded-full border-2 border-primary bg-primary/20 shrink-0" />
                ) : (
                  <Circle className="w-5 h-5 text-muted-foreground/40 shrink-0" />
                )}
                <span className={`text-sm ${s.current ? "font-semibold text-primary" : s.completed ? "text-foreground" : "text-muted-foreground"}`}>
                  {s.label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {tab === "Deliverables" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {data.deliverables.length === 0 ? (
            <p className="text-muted-foreground col-span-2 text-center py-12">No deliverables yet.</p>
          ) : data.deliverables.map((d) => (
            <div key={d.id} className="bg-card border border-card-border rounded-2xl p-5 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium truncate">{d.title}</p>
                <p className="text-xs text-muted-foreground">v{d.version} · {fmtDate(d.createdAt)}</p>
              </div>
              <button
                onClick={() => handleDownload(d.id, d.locked)}
                className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                  d.locked ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary/10 text-primary hover:bg-primary/20"
                }`}
                data-testid={`button-download-${d.id}`}
              >
                {d.locked ? <Lock className="w-4 h-4" /> : <Download className="w-4 h-4" />}
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "Reviews" && (
        <div className="bg-card border border-card-border rounded-2xl p-6">
          {data.reviews.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No review activity yet.</p>
          ) : (
            <ul className="space-y-4">
              {data.reviews.map((r, i) => (
                <li key={i} className="flex justify-between text-sm border-b border-border/50 pb-3 last:border-0 last:pb-0">
                  <span className="font-medium capitalize">{r.status.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground">{fmtDateTime(r.sharedAt ?? r.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "Payments" && (
        <div className="bg-card border border-card-border rounded-2xl p-6">
          {data.payments.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No payment schedule yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground border-b border-border">
                <th className="pb-2 font-medium">Installment</th><th className="pb-2 font-medium">Amount</th><th className="pb-2 font-medium">Status</th><th className="pb-2 font-medium">Due</th>
              </tr></thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2.5">{p.installmentLabel}</td>
                    <td className="py-2.5">{fmtMoney(p.amount, overview.currency)}</td>
                    <td className="py-2.5 capitalize">{p.status}</td>
                    <td className="py-2.5">{fmtDate(p.dueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "Invoices" && (
        <div className="bg-card border border-card-border rounded-2xl p-6">
          {data.invoices.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No invoices yet.</p>
          ) : (
            <ul className="space-y-3">
              {data.invoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between border-b border-border/50 pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{inv.invoiceNumber}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="capitalize text-muted-foreground">{inv.status}</span>
                    <span className="font-semibold">{fmtMoney(inv.total, overview.currency)}</span>
                    <Link href={`/workspace/${token}/invoices`} className="text-primary hover:underline text-xs">View</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </WorkspaceLayout>
  );
}
