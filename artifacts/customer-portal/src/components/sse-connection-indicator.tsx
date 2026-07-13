/**
 * SseConnectionIndicator — compact SSE connection status badge.
 *
 * Displays in the Workspace AI Intelligence panel.
 * Never shows "Live" before a heartbeat or event is received.
 * Uses aria-live="polite" for accessible status announcements.
 */

import { Loader2, Clock, AlertTriangle, WifiOff } from "lucide-react";
import type { ConnectionStatus } from "@/hooks/use-runtime-event-stream";

interface SseConnectionIndicatorProps {
  status: ConnectionStatus;
  lastEventAt: Date | null;
  isStale: boolean;
  error: string | null;
}

function fmtAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function SseConnectionIndicator({
  status,
  lastEventAt,
  isStale,
  error,
}: SseConnectionIndicatorProps) {
  // "Live" — only after a heartbeat or event has been received
  if (status === "live" && !isStale) {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label="Connection live"
        className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full select-none"
        style={{
          background: "rgba(16,185,129,0.15)",
          color: "#10B981",
          border: "1px solid rgba(16,185,129,0.25)",
        }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
        Live
      </span>
    );
  }

  if (status === "connecting") {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label="Connecting to live updates"
        className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full select-none"
        style={{
          background: "rgba(59,130,246,0.12)",
          color: "#3B82F6",
          border: "1px solid rgba(59,130,246,0.2)",
        }}
      >
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        Connecting
      </span>
    );
  }

  if (status === "reconnecting") {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label="Reconnecting to live updates"
        className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full select-none"
        style={{
          background: "rgba(245,158,11,0.12)",
          color: "#F59E0B",
          border: "1px solid rgba(245,158,11,0.2)",
        }}
      >
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        Reconnecting
      </span>
    );
  }

  // Stale — show when last event
  if (isStale && lastEventAt) {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label={`Last updated ${fmtAgo(lastEventAt)}`}
        className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full select-none"
        style={{
          background: "rgba(100,116,139,0.12)",
          color: "#94A3B8",
          border: "1px solid rgba(100,116,139,0.18)",
        }}
      >
        <Clock className="w-2.5 h-2.5" />
        Updated {fmtAgo(lastEventAt)}
      </span>
    );
  }

  // Error or offline
  if (error || status === "offline") {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label="Updates delayed"
        className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full select-none"
        style={{
          background: "rgba(100,116,139,0.12)",
          color: "#64748B",
          border: "1px solid rgba(100,116,139,0.18)",
        }}
      >
        <AlertTriangle className="w-2.5 h-2.5" />
        Updates delayed
      </span>
    );
  }

  // Unavailable
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label="Live updates unavailable"
      className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full select-none"
      style={{
        background: "rgba(100,116,139,0.10)",
        color: "#64748B",
        border: "1px solid rgba(100,116,139,0.15)",
      }}
    >
      <WifiOff className="w-2.5 h-2.5" />
      Offline
    </span>
  );
}
