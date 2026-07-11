import { useState } from "react";
import { Link } from "wouter";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useWorkspaceProjects } from "@/hooks/use-workspace";
import { fmtMoney, fmtDate, stageColor } from "@/lib/workspace-format";
import { Search, Loader2, FolderKanban } from "lucide-react";

export default function WorkspaceProjectsPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const { data, isLoading } = useWorkspaceProjects(token, { search, sort });

  return (
    <WorkspaceLayout token={token}>
      <div className="mb-6">
        <h1 className="text-3xl font-serif font-medium mb-1">My Projects</h1>
        <p className="text-muted-foreground">All your creative and service projects in one place.</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by brand, service..."
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            data-testid="input-project-search"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="px-3 py-2.5 rounded-xl border border-border bg-card text-sm"
          data-testid="select-project-sort"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="delivery_date">Delivery date</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
          <FolderKanban className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-xl font-medium mb-2">No projects found</h3>
          <p className="text-muted-foreground">Try adjusting your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.items.map((p) => (
            <Link key={p.projectNumber} href={`/workspace/${token}/projects/${p.projectNumber}`} className="group block">
              <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm h-full flex flex-col group-hover:border-primary/30 group-hover:shadow-md transition-all">
                <div className="flex justify-between items-start gap-3 mb-4">
                  <div className="min-w-0">
                    <h3 className="font-serif font-medium text-lg truncate">{p.brandName}</h3>
                    <p className="text-sm text-muted-foreground truncate">{p.serviceName}</p>
                  </div>
                  <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${stageColor(p.currentStage)}`}>
                    {p.currentStageLabel}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mb-4">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${p.progressPercent}%` }} />
                </div>
                <div className="flex items-center justify-between mt-auto pt-3 border-t border-border/50 text-xs text-muted-foreground">
                  <span>Updated {fmtDate(p.updatedAt)}</span>
                  {p.total ? <span className="font-semibold text-foreground">{fmtMoney(p.total, p.currency)}</span> : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </WorkspaceLayout>
  );
}
