/**
 * cw-notification-item.tsx — Notification list item (Team 2).
 */
import { Link } from "wouter";
import {
  Bell, CheckCircle2, AlertCircle, Info, ArrowRight, Check,
  Package, CreditCard, Download, RotateCcw,
} from "lucide-react";
import type { CWNotification, NotificationSeverity } from "@/hooks/creative-workspace";

function fmtRelative(iso: string) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return "Baru saja";
    if (m < 60) return `${m}m lalu`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}j lalu`;
    const d = Math.floor(h / 24);
    return `${d}h lalu`;
  } catch { return ""; }
}

const SEVERITY_CONFIG: Record<NotificationSeverity, { icon: React.ReactNode; dot: string; bg: string }> = {
  info:    { icon: <Info className="w-4 h-4" />,         dot: "bg-blue-500",    bg: "bg-blue-500/10 border-blue-500/15" },
  success: { icon: <CheckCircle2 className="w-4 h-4" />, dot: "bg-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/15" },
  warning: { icon: <AlertCircle className="w-4 h-4" />,  dot: "bg-amber-500",   bg: "bg-amber-500/10 border-amber-500/15" },
  action:  { icon: <Bell className="w-4 h-4" />,         dot: "bg-indigo-500",  bg: "bg-indigo-500/10 border-indigo-500/15" },
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  review_pending:    <Bell className="w-4 h-4 text-amber-400" />,
  payment_required:  <CreditCard className="w-4 h-4 text-red-400" />,
  download_ready:    <Download className="w-4 h-4 text-emerald-400" />,
  revision_in_progress: <RotateCcw className="w-4 h-4 text-indigo-400" />,
  order:             <Package className="w-4 h-4 text-blue-400" />,
};

export function CWNotificationItem({
  notification,
  onMarkRead,
}: {
  notification: CWNotification;
  onMarkRead?: (id: string) => void;
}) {
  const cfg = SEVERITY_CONFIG[notification.severity] ?? SEVERITY_CONFIG.info;
  const typeIcon = TYPE_ICON[notification.type] ?? cfg.icon;

  const content = (
    <div
      className={`relative group flex gap-3 p-3.5 rounded-xl border transition-all ${
        notification.read
          ? "bg-white/2 border-white/5"
          : `${cfg.bg} border`
      }`}
    >
      {/* Unread dot */}
      {!notification.read && (
        <span className={`absolute top-3 right-3 w-2 h-2 rounded-full ${cfg.dot}`} />
      )}

      {/* Icon */}
      <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0 mt-0.5">
        {typeIcon}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0 pr-4">
        <p className={`text-sm font-semibold leading-snug mb-0.5 ${notification.read ? "text-slate-300" : "text-white"}`}>
          {notification.title}
        </p>
        <p className="text-xs text-slate-400 leading-relaxed">{notification.message}</p>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-[11px] text-slate-600">{fmtRelative(notification.createdAt)}</span>
          {notification.actionLabel && notification.actionPath && (
            <span className="text-[11px] text-indigo-400 flex items-center gap-0.5">
              {notification.actionLabel} <ArrowRight className="w-3 h-3" />
            </span>
          )}
        </div>
      </div>

      {/* Mark read button */}
      {!notification.read && onMarkRead && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMarkRead(notification.id); }}
          className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white/8 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/15 transition-all"
          title="Tandai sudah dibaca"
        >
          <Check className="w-3 h-3 text-white" />
        </button>
      )}
    </div>
  );

  if (notification.actionPath) {
    return <Link href={notification.actionPath}>{content}</Link>;
  }
  return content;
}
