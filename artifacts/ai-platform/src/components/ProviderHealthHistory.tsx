import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, CheckCircle2, XCircle } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

interface HealthEntry {
  id: number;
  isActive: boolean;
  httpStatus: number | null;
  error: string | null;
  checkedAt: string;
}

interface Props {
  providerId: number;
  providerName: string;
}

function adminHeaders(): HeadersInit {
  const key = (import.meta as unknown as { env: Record<string, string> }).env?.["VITE_ADMIN_API_KEY"] ?? "";
  return key ? { "x-admin-api-key": key } : {};
}

async function fetchHealthHistory(providerId: number, limit = 50): Promise<HealthEntry[]> {
  const res = await fetch(`/api/ai/providers/${providerId}/health-history?limit=${limit}`, {
    headers: adminHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<HealthEntry[]>;
}

/** Tiny sparkline — renders a row of coloured squares representing pass/fail */
function Sparkline({ entries }: { entries: HealthEntry[] }) {
  // Most recent on the right
  const dots = [...entries].reverse().slice(-40);
  if (dots.length === 0) return null;
  return (
    <div className="flex items-center gap-px flex-wrap">
      {dots.map((e, i) => (
        <div
          key={i}
          title={`${format(new Date(e.checkedAt), "MMM d HH:mm")} — ${e.isActive ? "OK" : "FAIL"}`}
          className={cn(
            "size-2 rounded-sm",
            e.isActive ? "bg-green-500" : "bg-red-500",
          )}
        />
      ))}
    </div>
  );
}

export function ProviderHealthHistory({ providerId, providerName: _providerName }: Props) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<HealthEntry[]>({
    queryKey: ["provider-health-history", providerId],
    queryFn: () => fetchHealthHistory(providerId, 50),
    enabled: open,
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 font-mono text-[10px] text-muted-foreground uppercase tracking-wider hover:text-foreground"
        >
          {open ? <ChevronDown className="size-3 mr-1" /> : <ChevronRight className="size-3 mr-1" />}
          History
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        {isLoading ? (
          <div className="text-[11px] text-muted-foreground font-mono py-1">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="text-[11px] text-muted-foreground font-mono py-1">
            No history yet — run a health check to start recording.
          </div>
        ) : (
          <div className="space-y-2">
            {/* Sparkline overview */}
            <div className="space-y-1">
              <div className="text-[10px] font-mono text-muted-foreground uppercase">
                Last {data.length} checks (oldest → newest)
              </div>
              <Sparkline entries={data} />
            </div>

            {/* Summary stats */}
            {(() => {
              const okCount = data.filter((e) => e.isActive).length;
              const failCount = data.filter((e) => !e.isActive).length;
              const pct = Math.round((okCount / data.length) * 100);
              return (
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-green-400 font-mono">✓ {okCount} ok</span>
                  <span className="text-red-400 font-mono">✗ {failCount} failed</span>
                  <span className="text-muted-foreground font-mono">{pct}% uptime</span>
                </div>
              );
            })()}

            {/* Recent entries list */}
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {data.slice(0, 20).map((entry) => (
                <div
                  key={entry.id}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1 rounded text-[11px] font-mono",
                    entry.isActive
                      ? "bg-green-500/5 border border-green-500/10"
                      : "bg-red-500/5 border border-red-500/10",
                  )}
                >
                  {entry.isActive ? (
                    <CheckCircle2 className="size-3 text-green-400 flex-shrink-0" />
                  ) : (
                    <XCircle className="size-3 text-red-400 flex-shrink-0" />
                  )}
                  <span className="text-muted-foreground">
                    {formatDistanceToNow(new Date(entry.checkedAt), { addSuffix: true })}
                  </span>
                  {entry.httpStatus != null && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-mono text-[9px] px-1 py-0 h-4",
                        entry.isActive
                          ? "border-green-500/30 text-green-400"
                          : "border-red-500/30 text-red-400",
                      )}
                    >
                      HTTP {entry.httpStatus}
                    </Badge>
                  )}
                  {entry.error && (
                    <span className="text-red-400/70 truncate max-w-[200px]" title={entry.error}>
                      {entry.error.slice(0, 60)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
