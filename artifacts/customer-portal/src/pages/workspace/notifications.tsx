import { WorkspaceLayout } from "@/components/workspace-layout";
import { useWorkspaceNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from "@/hooks/use-workspace";
import { fmtDateTime } from "@/lib/workspace-format";
import { Loader2, Bell, CheckCheck } from "lucide-react";

export default function WorkspaceNotificationsPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const { data, isLoading } = useWorkspaceNotifications(token);
  const markRead = useMarkNotificationRead(token);
  const markAllRead = useMarkAllNotificationsRead(token);

  return (
    <WorkspaceLayout token={token}>
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-medium mb-1">Notifications</h1>
          <p className="text-muted-foreground">Project updates, payments, and reviews.</p>
        </div>
        {(data?.unreadCount ?? 0) > 0 && (
          <button
            onClick={() => markAllRead.mutate()}
            className="inline-flex items-center gap-1.5 text-sm font-medium bg-muted hover:bg-muted/70 px-3.5 py-2 rounded-full transition-colors"
            data-testid="button-mark-all-read"
          >
            <CheckCheck className="w-4 h-4" /> Mark all as read
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : !data || data.items.length === 0 ? (
        <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
          <Bell className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-xl font-medium mb-2">You're all caught up</h3>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-2xl divide-y divide-border/60">
          {data.items.map((n) => (
            <button
              key={n.key}
              onClick={() => !n.isRead && markRead.mutate(n.key)}
              className={`w-full text-left flex items-start gap-3 p-4 transition-colors ${n.isRead ? "" : "bg-primary/5 hover:bg-primary/10"}`}
              data-testid={`notification-${n.key}`}
            >
              <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.isRead ? "bg-transparent" : "bg-primary"}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${n.isRead ? "text-muted-foreground" : "font-medium"}`}>{n.message}</p>
                <p className="text-xs text-muted-foreground mt-1">{fmtDateTime(n.createdAt)}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </WorkspaceLayout>
  );
}
