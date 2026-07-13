import { useState, useMemo } from "react";
import { Link } from "wouter";
import { WorkspaceLayout } from "@/components/workspace-layout";
import {
  useWorkspaceNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  type WorkspaceNotification,
} from "@/hooks/use-workspace";
import { fmtDate, fmtDateTime } from "@/lib/workspace-format";
import {
  Loader2, Bell, CheckCheck, Package, CreditCard, Wrench, Megaphone, LayoutGrid, ArrowLeft,
} from "lucide-react";

const CATEGORY_TABS = [
  { key: "",             label: "All",          icon: LayoutGrid },
  { key: "order",        label: "Orders",        icon: Package },
  { key: "billing",      label: "Billing",       icon: CreditCard },
  { key: "production",   label: "Production",    icon: Wrench },
  { key: "marketing",    label: "Marketing",     icon: Megaphone },
];

function categoryColor(category: string): string {
  switch (category) {
    case "order":       return "bg-blue-500";
    case "billing":     return "bg-amber-500";
    case "production":  return "bg-violet-500";
    case "marketing":   return "bg-emerald-500";
    default:            return "bg-primary";
  }
}

function categoryIcon(category: string): React.ReactNode {
  switch (category) {
    case "order":       return <Package className="w-4 h-4" />;
    case "billing":     return <CreditCard className="w-4 h-4" />;
    case "production":  return <Wrench className="w-4 h-4" />;
    case "marketing":   return <Megaphone className="w-4 h-4" />;
    default:            return <Bell className="w-4 h-4" />;
  }
}

function groupByDate(items: WorkspaceNotification[]): { label: string; items: WorkspaceNotification[] }[] {
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterdayStr = new Date(now.getTime() - 86400000).toDateString();

  const groups: Record<string, WorkspaceNotification[]> = {};
  for (const n of items) {
    const d = new Date(n.createdAt);
    const ds = d.toDateString();
    const key = ds === todayStr ? "Today" : ds === yesterdayStr ? "Yesterday" : fmtDate(n.createdAt);
    if (!groups[key]) groups[key] = [];
    groups[key].push(n);
  }
  return Object.entries(groups).map(([label, items]) => ({ label, items }));
}

function NotifRow({
  n,
  onRead,
}: {
  n: WorkspaceNotification;
  onRead: (key: string) => void;
}) {
  const dotColor = categoryColor(n.category);

  return (
    <button
      key={n.key}
      onClick={() => !n.isRead && onRead(n.key)}
      className={`w-full text-left flex items-start gap-4 px-5 py-4 transition-colors group ${
        n.isRead
          ? "hover:bg-muted/40"
          : "bg-primary/[0.04] hover:bg-primary/[0.07]"
      }`}
      data-testid={`notification-${n.key}`}
    >
      {/* Color stripe + icon */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-white ${dotColor}`}
      >
        {categoryIcon(n.category)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-sm leading-snug ${n.isRead ? "text-muted-foreground" : "font-medium text-foreground"}`}>
              {n.message}
            </p>
            {n.projectNumber && (
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                Project {n.projectNumber}
              </p>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {!n.isRead && (
              <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
            )}
            <p className="text-xs text-muted-foreground whitespace-nowrap">
              {fmtDateTime(n.createdAt)}
            </p>
          </div>
        </div>
      </div>
    </button>
  );
}

export default function WorkspaceNotificationsPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [activeCategory, setActiveCategory] = useState("");
  const { data, isLoading } = useWorkspaceNotifications(token, {
    category: activeCategory || undefined,
  });
  const markRead = useMarkNotificationRead(token);
  const markAllRead = useMarkAllNotificationsRead(token);

  const unreadCount = data?.unreadCount ?? 0;
  const allItems = data?.items ?? [];

  const grouped = useMemo(() => groupByDate(allItems), [allItems]);

  return (
    <WorkspaceLayout token={token}>
      <Link href={`/workspace/${token}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group">
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        Kembali ke Dashboard
      </Link>
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-medium mb-1">Notifications</h1>
          <p className="text-muted-foreground">
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"} · Project updates, payments, and reviews.
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="inline-flex items-center gap-1.5 text-sm font-medium bg-muted hover:bg-muted/70 px-3.5 py-2 rounded-full transition-colors disabled:opacity-50"
            data-testid="button-mark-all-read"
          >
            <CheckCheck className="w-4 h-4" />
            Mark all as read
          </button>
        )}
      </div>

      {/* Category filter tabs */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        {CATEGORY_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeCategory === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveCategory(tab.key)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-card-border text-muted-foreground hover:text-foreground hover:border-primary/30"
              }`}
              data-testid={`tab-notif-${tab.key || "all"}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.key === "" && unreadCount > 0 && (
                <span className="ml-1 min-w-5 h-5 px-1 rounded-full bg-white/20 text-[10px] font-semibold flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
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
      ) : allItems.length === 0 ? (
        <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
          <Bell className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-xl font-medium mb-2">
            {activeCategory ? "No notifications in this category" : "You're all caught up"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {activeCategory
              ? "Try switching to All to see everything."
              : "New updates will appear here as your projects progress."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ label, items }) => (
            <div key={label}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                {label}
              </p>
              <div className="bg-card border border-card-border rounded-2xl overflow-hidden divide-y divide-border/40">
                {items.map((n) => (
                  <NotifRow key={n.key} n={n} onRead={(key) => markRead.mutate(key)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </WorkspaceLayout>
  );
}
