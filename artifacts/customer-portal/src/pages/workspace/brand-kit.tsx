import { Link } from "wouter";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useWorkspaceBrandKit, useSignDownload } from "@/hooks/use-workspace";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Palette, Type, Eye, Download, Lock, ArrowLeft } from "lucide-react";

export default function WorkspaceBrandKitPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const { data, isLoading } = useWorkspaceBrandKit(token);
  const signDownload = useSignDownload(token);
  const { toast } = useToast();

  async function handleDownload(id: number, locked: boolean) {
    if (locked) {
      toast({ title: "File locked", description: "This asset unlocks once payment is verified.", variant: "destructive" });
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
        <h1 className="text-3xl font-serif font-medium mb-1">Brand Asset Library</h1>
        <p className="text-muted-foreground">Your brand direction and assets, organized by project.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : !data || data.items.length === 0 ? (
        <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
          <Palette className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-xl font-medium mb-2">No brand kits yet</h3>
          <p className="text-muted-foreground">Brand direction appears here once a project's creative direction is finalized.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {data.items.map((kit) => {
            const visual = kit.visualStyle as { mood?: string; approach?: string } | null;
            return (
              <div key={kit.projectNumber} className="bg-card border border-card-border rounded-2xl p-6">
                <h2 className="text-xl font-serif font-medium mb-4">{kit.brandName}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                  <div className="flex items-start gap-3">
                    <Palette className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Color Palette</p>
                      <p className="font-medium text-sm">{kit.colorPalette ?? "—"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Type className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Typography</p>
                      <p className="font-medium text-sm">{kit.typography ?? "—"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Eye className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Visual Style</p>
                      <p className="font-medium text-sm">{visual?.mood ?? visual?.approach ?? "—"}</p>
                    </div>
                  </div>
                </div>
                {kit.logos.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Logo files</p>
                    <div className="flex flex-wrap gap-2">
                      {kit.logos.map((logo) => (
                        <button
                          key={logo.id}
                          onClick={() => handleDownload(logo.id, logo.locked)}
                          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                            logo.locked ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary/10 text-primary hover:bg-primary/20"
                          }`}
                          data-testid={`button-download-logo-${logo.id}`}
                        >
                          {logo.locked ? <Lock className="w-3 h-3" /> : <Download className="w-3 h-3" />} {logo.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </WorkspaceLayout>
  );
}
