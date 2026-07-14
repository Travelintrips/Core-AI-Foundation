import { useState } from "react";
import { Link } from "wouter";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useWorkspaceDownloads, useSignDownload } from "@/hooks/use-workspace";
import { useToast } from "@/hooks/use-toast";
import { fmtDate, fmtFileSize } from "@/lib/workspace-format";
import { Loader2, Download, Lock, Search, FileImage, FileText, ArrowLeft } from "lucide-react";

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  company_profile:         "Company Profile",
  brand_strategy:          "Brand Strategy",
  copywriting:             "Copywriting",
  creative_consultation:   "Creative Consultation",
  brand_identity_guideline: "Brand Identity Guideline",
  pitch_deck:              "Pitch Deck",
};

const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function DocumentIcon({ isPdf, isPptx }: { isPdf: boolean; isPptx: boolean }) {
  if (isPptx) return <FileImage className="w-4 h-4 text-orange-500" />;
  if (isPdf) return <FileText className="w-4 h-4 text-primary" />;
  return <FileImage className="w-4 h-4 text-muted-foreground" />;
}

export default function WorkspaceDownloadsPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [search, setSearch] = useState("");
  const { data, isLoading } = useWorkspaceDownloads(token, { search });
  const signDownload = useSignDownload(token);
  const { toast } = useToast();

  async function handleDownload(id: number, locked: boolean) {
    if (locked) {
      toast({ title: "File locked", description: "This file unlocks once payment is verified.", variant: "destructive" });
      return;
    }
    try {
      const res = await signDownload.mutateAsync(id);
      window.open(res.downloadUrl, "_blank");
    } catch (e) {
      toast({ title: "Could not generate link", description: (e as Error).message, variant: "destructive" });
    }
  }

  return (
    <WorkspaceLayout token={token}>
      <Link href={`/workspace/${token}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group">
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        Kembali ke Dashboard
      </Link>
      <div className="mb-6">
        <h1 className="text-3xl font-serif font-medium mb-1">Download Center</h1>
        <p className="text-muted-foreground">All your files, secured with time-limited links.</p>
      </div>

      <div className="relative mb-6 max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files..."
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          data-testid="input-download-search"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : !data || data.items.length === 0 ? (
        <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
          <FileImage className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-xl font-medium mb-2">No files yet</h3>
          <p className="text-sm text-muted-foreground">Your deliverables will appear here once they are ready.</p>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-2xl divide-y divide-border/60">
          {data.items.map((d) => {
            const isPptx = d.mimeType === PPTX_MIME_TYPE;
            const isPdf = !isPptx && (d.mimeType === "application/pdf" || !!d.documentType);
            const docLabel = d.documentType ? (DOCUMENT_TYPE_LABELS[d.documentType] ?? d.documentType) : null;
            return (
              <div key={d.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isPptx ? "bg-orange-500/10" : isPdf ? "bg-primary/10" : "bg-muted"}`}>
                    <DocumentIcon isPdf={isPdf} isPptx={isPptx} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{d.title}</p>
                      {isPptx && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-500/10 text-orange-600 shrink-0">
                          PPTX
                        </span>
                      )}
                      {isPdf && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary shrink-0">
                          PDF
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
    </WorkspaceLayout>
  );
}
