/**
 * creative-workspace/notifications.tsx — Notification center (Team 2).
 * Route: /creative-workspace/:token/notifications
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCheck, Loader2, Bell } from "lucide-react";
import { CWLayout } from "@/components/creative-workspace/cw-layout";
import { CWEmpty, CWError } from "@/components/creative-workspace/cw-empty";
import { CWNotificationItem } from "@/components/creative-workspace/cw-notification-item";
import {
  useCWNotifications,
  useCWMarkNotificationRead,
  useCWMarkAllRead,
} from "@/hooks/creative-workspace";
import type { CWNotification } from "@/hooks/creative-workspace";

const FILTER_TABS = [
  { key: "all",    label: "Semua" },
  { key: "unread", label: "Belum Dibaca" },
  { key: "action", label: "Perlu Tindakan" },
  { key: "info",   label: "Info" },
];

export default function CWNotificationsPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [filter, setFilter] = useState("all");

  const { data, isLoading, error, refetch } = useCWNotifications(token);
  const markRead = useCWMarkNotificationRead(token);
  const markAll  = useCWMarkAllRead(token);

  const items: CWNotification[] = data?.items ?? [];
  const filtered = items.filter((n) => {
    if (filter === "unread") return !n.read;
    if (filter === "action") return n.severity === "action";
    if (filter === "info")   return n.severity === "info" || n.severity === "success";
    return true;
  });

  return (
    <CWLayout token={token} title="Notifikasi" backHref={`/creative-workspace/${token}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Notifikasi</h1>
          {data && data.unreadCount > 0 && (
            <p className="text-sm text-slate-400">{data.unreadCount} belum dibaca</p>
          )}
        </div>
        {data && data.unreadCount > 0 && (
          <button
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            <CheckCheck className="w-4 h-4" />
            {markAll.isPending ? "…" : "Tandai Semua Dibaca"}
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              filter === tab.key
                ? "bg-indigo-500 text-white"
                : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-indigo-400" />
        </div>
      ) : error ? (
        <CWError onRetry={() => refetch()} />
      ) : filtered.length === 0 ? (
        <CWEmpty variant="notifications" />
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-2"
        >
          {filtered.map((n, i) => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <CWNotificationItem
                notification={n}
                onMarkRead={!n.read ? (id) => markRead.mutate(id) : undefined}
              />
            </motion.div>
          ))}
        </motion.div>
      )}
    </CWLayout>
  );
}
