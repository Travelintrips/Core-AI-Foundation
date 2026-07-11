import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Loader2, Lightbulb, TrendingUp, AlertTriangle, Info, CheckCircle2, BarChart3, RefreshCw } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch<T>(path: string): Promise<T> {
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: key ? { "x-admin-api-key": key } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

type Insight = {
  title: string;
  body: string;
  type: "positive" | "warning" | "info" | "neutral";
  datapoint?: string;
};

const INSIGHT_STYLE: Record<string, { bg: string; border: string; icon: typeof Lightbulb; iconColor: string }> = {
  positive: { bg: "bg-green-50 dark:bg-green-950/20", border: "border-green-200 dark:border-green-800", icon: CheckCircle2, iconColor: "text-green-600" },
  warning: { bg: "bg-amber-50 dark:bg-amber-950/20", border: "border-amber-200 dark:border-amber-800", icon: AlertTriangle, iconColor: "text-amber-600" },
  info: { bg: "bg-blue-50 dark:bg-blue-950/20", border: "border-blue-200 dark:border-blue-800", icon: Info, iconColor: "text-blue-600" },
  neutral: { bg: "bg-muted/30", border: "border-border", icon: Lightbulb, iconColor: "text-muted-foreground" },
};

export default function AIInsightsPage() {
  const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery<{
    insights: Insight[];
    generatedAt: string;
  }>({
    queryKey: ["ai-insights"],
    queryFn: () => apiFetch("/api/ai/automation/insights"),
    staleTime: 5 * 60 * 1000,
  });

  const { data: segData } = useQuery<{ distribution: Record<string, number> }>({
    queryKey: ["automation", "segments"],
    queryFn: () => apiFetch("/api/ai/automation/segments"),
  });

  return (
    <Layout>
      <div className="p-6 md:p-8 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-amber-500" /> AI Insights
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Insight berbasis data nyata platform Anda — diperbarui otomatis.
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-24"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {data?.generatedAt && (
              <p className="text-xs text-muted-foreground mb-6">
                Dihasilkan: {new Date(data.generatedAt).toLocaleString("id-ID")}
              </p>
            )}

            {/* Insight cards */}
            <div className="space-y-4 mb-8">
              {data?.insights.map((insight, i) => {
                const style = INSIGHT_STYLE[insight.type] ?? INSIGHT_STYLE.neutral;
                const Icon = style.icon;
                return (
                  <div key={i} className={`rounded-2xl border p-5 ${style.bg} ${style.border}`}>
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-white/50 dark:bg-black/20`}>
                        <Icon className={`w-4 h-4 ${style.iconColor}`} />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-sm mb-1">{insight.title}</p>
                        <p className="text-sm text-foreground/80">{insight.body}</p>
                        {insight.datapoint && (
                          <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium bg-black/5 dark:bg-white/10 px-2 py-1 rounded-full">
                            <BarChart3 className="w-3 h-3" />
                            {insight.datapoint}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Segment breakdown */}
            {segData?.distribution && Object.keys(segData.distribution).length > 0 && (
              <div className="bg-card border border-border rounded-2xl p-6">
                <h2 className="font-semibold mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> Distribusi Segmen Customer
                </h2>
                <div className="space-y-2">
                  {Object.entries(segData.distribution)
                    .sort((a, b) => b[1] - a[1])
                    .map(([segment, count]) => {
                      const total = Object.values(segData.distribution).reduce((a, b) => a + b, 0);
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <div key={segment} className="flex items-center gap-3">
                          <span className="text-sm capitalize w-28 shrink-0">{segment}</span>
                          <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-12 text-right shrink-0">{count} ({pct}%)</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
