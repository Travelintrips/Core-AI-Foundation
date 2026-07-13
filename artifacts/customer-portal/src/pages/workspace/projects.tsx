import { useState, useMemo } from "react";
import { Link } from "wouter";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useWorkspaceProjects } from "@/hooks/use-workspace";
import { fmtMoney, fmtDate, stageColor } from "@/lib/workspace-format";
import { Search, Loader2, FolderKanban, ArrowRight, LayoutGrid, List, ArrowLeft } from "lucide-react";

const STATUS_TABS = [
  { key: "",          label: "All" },
  { key: "active",    label: "Active" },
  { key: "review",    label: "In Review" },
  { key: "pending",   label: "Pending" },
  { key: "completed", label: "Completed" },
];

type ViewMode = "grid" | "list";

export default function WorkspaceProjectsPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [status, setStatus] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const { data, isLoading } = useWorkspaceProjects(token, { search, sort, status });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const statusCounts = useMemo(() => {
    const all = items.length;
    const active = items.filter((p) => !["completed", "cancelled", "delivered"].includes(p.currentStage)).length;
    const review = items.filter((p) => ["waiting_review", "waiting_customer_approval", "quotation_ready"].includes(p.currentStage)).length;
    const pending = items.filter((p) => ["draft", "brief_submitted", "pending_payment"].includes(p.currentStage)).length;
    const completed = items.filter((p) => ["completed", "delivered"].includes(p.currentStage)).length;
    return { "": all, active, review, pending, completed };
  }, [items]);

  return (
    <WorkspaceLayout token={token}>
      <Link href={`/workspace/${token}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group">
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        Kembali ke Dashboard
      </Link>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-serif font-medium mb-1">My Orders</h1>
        <p className="text-muted-foreground">
          {total > 0 ? `${total} project${total !== 1 ? "s" : ""} total` : "All your creative and service projects in one place."}
        </p>
      </div>

      {/* Search + sort + view toggle */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
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
        <div className="flex rounded-xl border border-border bg-card overflow-hidden">
          <button
            onClick={() => setView("grid")}
            className={`px-3 py-2.5 transition-colors ${view === "grid" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            title="Grid view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setView("list")}
            className={`px-3 py-2.5 transition-colors ${view === "list" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            title="List view"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Status filter chips */}
      <div className="flex items-center gap-2 flex-wrap mb-6">
        {STATUS_TABS.map((tab) => {
          const count = statusCounts[tab.key as keyof typeof statusCounts] ?? 0;
          const isActive = status === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setStatus(tab.key)}
              data-testid={`tab-status-${tab.key || "all"}`}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-card-border text-muted-foreground hover:text-foreground hover:border-primary/30"
              }`}
            >
              {tab.label}
              {!isLoading && count > 0 && (
                <span className={`ml-1.5 text-xs font-semibold ${isActive ? "opacity-75" : "text-muted-foreground"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
          <FolderKanban className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-xl font-medium mb-2">No projects found</h3>
          <p className="text-muted-foreground mb-6">
            {search || status ? "Try adjusting your search or filter." : "Your projects will appear here once you place an order."}
          </p>
          {!search && !status && (
            <Link
              href="/services"
              className="inline-flex items-center gap-2 text-sm font-medium bg-foreground text-background px-5 py-2.5 rounded-full hover:bg-foreground/90 transition-colors"
            >
              Browse Services <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((p) => (
            <Link key={p.projectNumber} href={`/workspace/${token}/projects/${p.projectNumber}`} className="group block">
              <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm h-full flex flex-col group-hover:border-primary/30 group-hover:shadow-md transition-all">
                <div className="flex justify-between items-start gap-3 mb-4">
                  <div className="min-w-0">
                    <h3 className="font-serif font-medium text-lg truncate">{p.brandName}</h3>
                    <p className="text-sm text-muted-foreground truncate">{p.serviceName}</p>
                    {p.packageName && (
                      <p className="text-xs text-muted-foreground/70 truncate mt-0.5">{p.packageName}</p>
                    )}
                  </div>
                  <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${stageColor(p.currentStage)}`}>
                    {p.currentStageLabel}
                  </span>
                </div>

                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                    <span>Progress</span>
                    <span className="font-medium">{p.progressPercent}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${p.progressPercent}%` }} />
                  </div>
                </div>

                <div className="flex items-center justify-between mt-auto pt-3 border-t border-border/50 text-xs text-muted-foreground">
                  <span>Updated {fmtDate(p.updatedAt)}</span>
                  {p.deliveryDate && <span>Due {fmtDate(p.deliveryDate)}</span>}
                  {p.total ? <span className="font-semibold text-foreground">{fmtMoney(p.total, p.currency)}</span> : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        /* List view — table style */
        <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[1fr_160px_120px_120px_40px] gap-4 px-5 py-3 bg-muted/50 border-b border-border/60 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <span>Project</span>
            <span>Status</span>
            <span>Updated</span>
            <span className="text-right">Value</span>
            <span />
          </div>
          <div className="divide-y divide-border/40">
            {items.map((p) => (
              <Link key={p.projectNumber} href={`/workspace/${token}/projects/${p.projectNumber}`} className="group block">
                <div className="flex flex-col md:grid md:grid-cols-[1fr_160px_120px_120px_40px] gap-2 md:gap-4 px-5 py-4 hover:bg-muted/30 transition-colors">
                  <div className="min-w-0">
                    <p className="font-medium truncate group-hover:text-primary transition-colors">{p.brandName}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.serviceName}</p>
                  </div>
                  <div>
                    <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full ${stageColor(p.currentStage)}`}>
                      {p.currentStageLabel}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground self-center">{fmtDate(p.updatedAt)}</p>
                  <p className="text-sm font-semibold self-center text-right">
                    {p.total ? fmtMoney(p.total, p.currency) : "—"}
                  </p>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary self-center justify-self-end transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Summary bar */}
      {!isLoading && items.length > 0 && (
        <div className="mt-6 flex items-center gap-6 px-1 text-sm text-muted-foreground flex-wrap">
          <span>{total} total</span>
          {statusCounts.active > 0 && <span className="text-sky-600 dark:text-sky-400">{statusCounts.active} active</span>}
          {statusCounts.review > 0 && <span className="text-amber-600 dark:text-amber-400">{statusCounts.review} awaiting review</span>}
          {statusCounts.completed > 0 && <span className="text-green-600 dark:text-green-400">{statusCounts.completed} completed</span>}
        </div>
      )}
    </WorkspaceLayout>
  );
}
