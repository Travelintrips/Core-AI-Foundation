import { useState } from "react";
import { Link } from "wouter";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useWorkspaceDownloads, useSignDownload } from "@/hooks/use-workspace";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { fmtDate, fmtFileSize } from "@/lib/workspace-format";
import {
  Loader2, Download, Lock, Search, FileImage, FileText,
  ArrowLeft, Archive, CheckCircle2, Clock, AlertCircle,
  PackageOpen, RefreshCw, ExternalLink,
} from "lucide-react";

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  company_profile:         "Company Profile",
  brand_strategy:          "Brand Strategy",
  copywriting:             "Copywriting",
  creative_consultation:   "Creative Consultation",
  brand_identity_guideline: "Brand Identity Guideline",
  pitch_deck:              "Pitch Deck",
};

const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function DocumentIcon({ isPdf, isPptx, isZip }: { isPdf: boolean; isPptx: boolean; isZip?: boolean }) {
  if (isZip) return <Archive className="w-4 h-4 text-emerald-600" />;
  if (isPptx) return <FileImage className="w-4 h-4 text-orange-500" />;
  if (isPdf) return <FileText className="w-4 h-4 text-primary" />;
  return <FileImage className="w-4 h-4 text-muted-foreground" />;
}

// ── ZIP delivery panel ────────────────────────────────────────────────────────

interface ZipDelivery {
  id?: number;
  status: string;
  fileSizeBytes?: number | null;
  checksum?: string | null;
  downloadToken?: string | null;
  expiresAt?: string | null;
  errorMessage?: string | null;
  retryCount?: number;
  updatedAt?: string;
}

function ZipDeliveryPanel({ token, projectId }: { token: string; projectId: string }) {
  const { toast } = useToast();

  const { data: zipData, isLoading: zipLoading, refetch } = useQuery<ZipDelivery>({
    queryKey: ["workspace-zip", token, projectId],
    queryFn: async () => {
      const res = await fetch(`/api/public/customer/workspace/${token}/zip/${projectId}`);
      if (!res.ok) throw new Error("Failed to load ZIP status");
      return res.json();
    },
    refetchInterval: (q) => {
      const status = (q.state.data as ZipDelivery | undefined)?.status;
      return status === "queued" || status === "generating" ? 5000 : false;
    },
  });

  const requestMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/public/customer/workspace/${token}/zip/${projectId}/request`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as Record<string, string>).error ?? "Failed to request ZIP");
      }
      return res.json();
    },
    onSuccess: () => refetch(),
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const retryMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/public/customer/workspace/${token}/zip/${projectId}/retry`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to retry");
      return res.json();
    },
    onSuccess: () => refetch(),
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const status = zipData?.status ?? "none";

  const statusConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    none:       { label: "Not generated",  icon: <PackageOpen className="w-4 h-4" />,    color: "text-muted-foreground" },
    queued:     { label: "In queue…",      icon: <Clock className="w-4 h-4 animate-pulse" />, color: "text-amber-600" },
    generating: { label: "Generating…",    icon: <Loader2 className="w-4 h-4 animate-spin" />, color: "text-blue-600" },
    completed:  { label: "Ready",          icon: <CheckCircle2 className="w-4 h-4" />,   color: "text-green-600" },
    failed:     { label: "Failed",         icon: <AlertCircle className="w-4 h-4" />,    color: "text-rose-600" },
  };

  const cfg = statusConfig[status] ?? statusConfig.none;

  return (
    <div className="bg-emerald-50/50 border border-emerald-200 rounded-2xl p-4 mb-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center">
            <Archive className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <p className="font-medium text-sm">Complete Package (ZIP)</p>
            <p className={`text-xs flex items-center gap-1 ${cfg.color}`}>
              {cfg.icon}
              {cfg.label}
              {zipData?.fileSizeBytes && status === "completed" && (
                <span className="text-muted-foreground ml-1">· {fmtFileSize(zipData.fileSizeBytes)}</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status === "completed" && zipData?.downloadToken && (
            <a
              href={`/api/public/files/access/${zipData.downloadToken}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Download ZIP
            </a>
          )}
          {(status === "none" || status === "failed") && (
            <button
              onClick={() => status === "failed" ? retryMutation.mutate() : requestMutation.mutate()}
              disabled={requestMutation.isPending || retryMutation.isPending}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-full bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {status === "failed" ? <RefreshCw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
              {status === "failed" ? "Retry" : "Generate ZIP"}
            </button>
          )}
          {(status === "queued" || status === "generating") && (
            <button onClick={() => refetch()} className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {status === "completed" && zipData?.checksum && (
        <p className="text-[10px] text-muted-foreground mt-2 font-mono">SHA-256: {zipData.checksum.slice(0, 32)}…</p>
      )}
      {status === "failed" && zipData?.errorMessage && (
        <p className="text-xs text-rose-600 mt-2">{zipData.errorMessage}</p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function WorkspaceDownloadsPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const { data, isLoading } = useWorkspaceDownloads(token, { search, category: category || undefined });
  const signDownload = useSignDownload(token);
  const { toast } = useToast();

  async function handleDownload(id: number, locked: boolean) {
    if (locked) {
      toast({ title: "File locked", description: "This file unlocks once payment is verified.", variant: "destructive" });
      return;
    }
    if (id < 0) {
      toast({ title: "Invoice download", description: "Use the Invoices page to download invoice PDFs.", variant: "default" });
      return;
    }
    try {
      const res = await signDownload.mutateAsync(id);
      window.open(res.downloadUrl, "_blank");
    } catch (e) {
      toast({ title: "Could not generate link", description: (e as Error).message, variant: "destructive" });
    }
  }

  const items = data?.items ?? [];
  const completedUnlockedProjects = [...new Set(
    items.filter((d) => !d.locked && d.id > 0).map((d) => d.projectNumber),
  )];

  const CATEGORY_FILTERS = [
    { value: "", label: "All" },
    { value: "images", label: "Images" },
    { value: "source_files", label: "Documents" },
    { value: "invoice", label: "Invoices" },
    { value: "receipt", label: "Receipts" },
  ];

  return (
    <WorkspaceLayout token={token}>
      <Link href={`/workspace/${token}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group">
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        Kembali ke Dashboard
      </Link>

      <div className="mb-6">
        <h1 className="text-3xl font-serif font-medium mb-1">Download Center</h1>
        <p className="text-muted-foreground">All your files, secured with time-limited signed links.</p>
      </div>

      {/* ZIP delivery panels for completed unlocked projects */}
      {completedUnlockedProjects.map((projectId) => (
        <ZipDeliveryPanel key={projectId} token={token} projectId={projectId} />
      ))}

      {/* Search + filter */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files..."
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            data-testid="input-download-search"
          />
        </div>
        <div className="flex gap-2">
          {CATEGORY_FILTERS.map((c) => (
            <button
              key={c.value}
              onClick={() => setCategory(c.value)}
              className={`text-sm px-3 py-2 rounded-xl border transition-colors ${
                category === c.value
                  ? "bg-primary text-white border-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : items.length === 0 ? (
        <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
          <FileImage className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-xl font-medium mb-2">No files yet</h3>
          <p className="text-sm text-muted-foreground">Your deliverables will appear here once they are ready.</p>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-2xl divide-y divide-border/60">
          {items.map((d) => {
            const isPptx = d.mimeType === PPTX_MIME_TYPE;
            const isPdf = !isPptx && (d.mimeType === "application/pdf" || !!d.documentType);
            const docLabel = d.documentType ? (DOCUMENT_TYPE_LABELS[d.documentType] ?? d.documentType) : null;
            const isInvoice = d.category === "invoice" || d.category === "receipt";

            return (
              <div key={d.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    isPptx ? "bg-orange-500/10" : isPdf ? "bg-primary/10" : isInvoice ? "bg-muted" : "bg-muted"
                  }`}>
                    <DocumentIcon isPdf={isPdf} isPptx={isPptx} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{d.title}</p>
                      {isPptx && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-500/10 text-orange-600 shrink-0">PPTX</span>
                      )}
                      {isPdf && !isInvoice && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary shrink-0">PDF</span>
                      )}
                      {isInvoice && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground shrink-0">
                          {(d.category ?? "").toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">{d.projectName}</span>
                      <span className="text-xs text-muted-foreground/50">·</span>
                      <span className="text-xs text-muted-foreground">v{d.version}</span>
                      {d.pageCount != null && (
                        <>
                          <span className="text-xs text-muted-foreground/50">·</span>
                          <span className="text-xs text-muted-foreground">{d.pageCount} pages</span>
                        </>
                      )}
                      {d.slideCount != null && (
                        <>
                          <span className="text-xs text-muted-foreground/50">·</span>
                          <span className="text-xs text-muted-foreground">{d.slideCount} slides</span>
                        </>
                      )}
                      {d.fileSizeBytes != null && (
                        <>
                          <span className="text-xs text-muted-foreground/50">·</span>
                          <span className="text-xs text-muted-foreground">{fmtFileSize(d.fileSizeBytes)}</span>
                        </>
                      )}
                      {docLabel && (
                        <>
                          <span className="text-xs text-muted-foreground/50">·</span>
                          <span className="text-xs text-muted-foreground">{docLabel}</span>
                        </>
                      )}
                      <span className="text-xs text-muted-foreground/50">·</span>
                      <span className="text-xs text-muted-foreground">{fmtDate(d.createdAt)}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDownload(d.id, d.locked)}
                  className={`shrink-0 inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-full transition-colors ${
                    d.locked ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary/10 text-primary hover:bg-primary/20"
                  }`}
                  data-testid={`button-download-${d.id}`}
                >
                  {d.locked ? <><Lock className="w-3.5 h-3.5" /> Locked</> : <><Download className="w-3.5 h-3.5" /> Download</>}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Stats footer */}
      {items.length > 0 && (
        <div className="mt-4 text-xs text-muted-foreground text-center">
          {items.length} file{items.length !== 1 ? "s" : ""} · Downloads secured with signed URLs · Expires in 1 hour
        </div>
      )}
    </WorkspaceLayout>
  );
}
