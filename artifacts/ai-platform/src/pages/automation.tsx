import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import {
  Zap, Play, Pause, RefreshCw, Loader2, CheckCircle2, XCircle,
  BarChart3, Users, ToggleLeft, ToggleRight, PlusCircle,
  Clock, TrendingUp, Shield, Bell,
} from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(key ? { "x-admin-api-key": key } : {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body.error as string) ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type AutomationRule = {
  id: number;
  ruleCode: string;
  ruleName: string;
  description: string | null;
  triggerEvent: string;
  actionType: string;
  priority: number;
  isEnabled: boolean;
  executionCount: number;
  lastExecutedAt: string | null;
};

type AutomationStats = {
  totalRules: number;
  enabledRules: number;
  totalExecutions: number;
  byAction: Record<string, number>;
};

type CustomerSegment = {
  id: number;
  customerProfileId: number;
  segment: string;
  segmentScore: number;
  segmentReason: string | null;
  calculatedAt: string;
};

type SegmentDistribution = Record<string, number>;

const ACTION_ICON: Record<string, typeof Zap> = {
  recommend_coupon: TrendingUp,
  send_reminder: Bell,
  vip_promotion: Shield,
  upgrade_commission: BarChart3,
  recalculate_health: RefreshCw,
  resegment_customer: Users,
};

const SEGMENT_COLOR: Record<string, string> = {
  vip: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  high_value: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  returning: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  high_potential: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  new: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  at_risk: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  inactive: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  lost: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  enterprise: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
};

export default function AutomationPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"rules" | "segments" | "executions">("rules");

  const { data: stats } = useQuery<AutomationStats>({
    queryKey: ["automation", "stats"],
    queryFn: () => apiFetch<AutomationStats>("/api/ai/automation/stats"),
    refetchInterval: 30_000,
  });

  const { data: rules = [], isLoading: rulesLoading } = useQuery<AutomationRule[]>({
    queryKey: ["automation", "rules"],
    queryFn: () => apiFetch<AutomationRule[]>("/api/ai/automation/rules"),
  });

  const { data: segData } = useQuery<{ distribution: SegmentDistribution; segments: CustomerSegment[] }>({
    queryKey: ["automation", "segments"],
    queryFn: () => apiFetch("/api/ai/automation/segments"),
    enabled: activeTab === "segments",
  });

  const seedRules = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/api/ai/automation/seed", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["automation"] }),
  });

  const toggleRule = useMutation({
    mutationFn: (id: number) => apiFetch<{ id: number; isEnabled: boolean }>(`/api/ai/automation/rules/${id}/toggle`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["automation", "rules"] }),
  });

  const recalculateSegments = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; processed: number; errors: number }>("/api/ai/automation/segments/recalculate", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["automation", "segments"] }),
  });

  return (
    <Layout>
      <div className="p-6 md:p-8 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" /> Automation Center
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Commercial rule engine — menjalankan promosi, reminder, dan segmentasi otomatis.
            </p>
          </div>
          <button
            onClick={() => seedRules.mutate()}
            disabled={seedRules.isPending}
            className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted/50 transition-colors"
          >
            {seedRules.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
            Seed Default Rules
          </button>
        </div>

        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <StatCard icon={Zap} label="Total Rules" value={stats.totalRules} />
            <StatCard icon={Play} label="Active Rules" value={stats.enabledRules} color="text-green-500" />
            <StatCard icon={CheckCircle2} label="Executions" value={stats.totalExecutions} />
            <StatCard icon={BarChart3} label="Action Types" value={Object.keys(stats.byAction).length} />
          </div>
        )}

        {/* Action breakdown */}
        {stats && Object.keys(stats.byAction).length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4 mb-6">
            <p className="text-xs font-medium text-muted-foreground mb-3">EXECUTIONS BY ACTION</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.byAction).map(([action, count]) => {
                const Icon = ACTION_ICON[action] ?? Zap;
                return (
                  <div key={action} className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/50 rounded-full text-xs">
                    <Icon className="w-3 h-3 text-primary" />
                    <span className="text-muted-foreground">{action}</span>
                    <span className="font-semibold">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-border">
          {(["rules", "segments", "executions"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "rules" ? "Automation Rules" : tab === "segments" ? "Customer Segments" : "Execution Log"}
            </button>
          ))}
        </div>

        {/* Rules tab */}
        {activeTab === "rules" && (
          <div className="space-y-2">
            {rulesLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : rules.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                <Zap className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p>Belum ada rules. Klik "Seed Default Rules" untuk memulai.</p>
              </div>
            ) : (
              rules.map((rule) => {
                const Icon = ACTION_ICON[rule.actionType] ?? Zap;
                return (
                  <div key={rule.id} className="flex items-start gap-4 bg-card border border-border rounded-xl p-4">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${rule.isEnabled ? "bg-primary/10" : "bg-muted"}`}>
                      <Icon className={`w-4 h-4 ${rule.isEnabled ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{rule.ruleName}</p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${rule.isEnabled ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>
                          {rule.isEnabled ? "Aktif" : "Nonaktif"}
                        </span>
                      </div>
                      {rule.description && <p className="text-xs text-muted-foreground mt-0.5">{rule.description}</p>}
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[10px] text-muted-foreground">Trigger: <code className="bg-muted px-1 rounded">{rule.triggerEvent}</code></span>
                        <span className="text-[10px] text-muted-foreground">·</span>
                        <span className="text-[10px] text-muted-foreground">Executed: {rule.executionCount}×</span>
                        {rule.lastExecutedAt && (
                          <>
                            <span className="text-[10px] text-muted-foreground">·</span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              {new Date(rule.lastExecutedAt).toLocaleDateString("id-ID")}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleRule.mutate(rule.id)}
                      disabled={toggleRule.isPending}
                      className="shrink-0 p-1 rounded hover:bg-muted/50 transition-colors"
                      title={rule.isEnabled ? "Nonaktifkan" : "Aktifkan"}
                    >
                      {rule.isEnabled
                        ? <ToggleRight className="w-5 h-5 text-primary" />
                        : <ToggleLeft className="w-5 h-5 text-muted-foreground" />}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Segments tab */}
        {activeTab === "segments" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">Segmentasi otomatis berdasarkan order history & health score.</p>
              <button
                onClick={() => recalculateSegments.mutate()}
                disabled={recalculateSegments.isPending}
                className="flex items-center gap-2 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted/50 transition-colors"
              >
                {recalculateSegments.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Recalculate All
              </button>
            </div>

            {/* Distribution */}
            {segData?.distribution && (
              <div className="flex flex-wrap gap-2 mb-5">
                {Object.entries(segData.distribution).sort((a, b) => b[1] - a[1]).map(([seg, count]) => (
                  <div key={seg} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${SEGMENT_COLOR[seg] ?? "bg-muted text-muted-foreground"}`}>
                    <span className="capitalize">{seg}</span>
                    <span className="font-bold">{count}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Segments list */}
            {segData?.segments && segData.segments.length > 0 ? (
              <div className="border border-border rounded-xl overflow-hidden">
                <div className="divide-y divide-border">
                  {segData.segments.map((seg) => (
                    <div key={seg.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/20 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">Profile #{seg.customerProfileId}</p>
                        {seg.segmentReason && <p className="text-xs text-muted-foreground truncate">{seg.segmentReason}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${SEGMENT_COLOR[seg.segment] ?? "bg-muted text-muted-foreground"}`}>
                          {seg.segment}
                        </span>
                        <span className="text-xs text-muted-foreground">Score: {seg.segmentScore}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground text-sm">
                <Users className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p>Belum ada data segmen. Klik "Recalculate All" untuk memulai.</p>
              </div>
            )}
          </div>
        )}

        {/* Executions tab */}
        {activeTab === "executions" && <ExecutionsTab />}
      </div>
    </Layout>
  );
}

function ExecutionsTab() {
  const { data: executions = [], isLoading } = useQuery({
    queryKey: ["automation", "executions"],
    queryFn: () => apiFetch<Array<{
      id: number; ruleId: number; triggerEventType: string | null;
      customerProfileId: number | null; status: string; executedAt: string;
    }>>("/api/ai/automation/executions?limit=50"),
  });

  return (
    <div>
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : executions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <BarChart3 className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p>Belum ada eksekusi automation.</p>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="divide-y divide-border">
            {executions.map((ex) => (
              <div key={ex.id} className="flex items-center gap-4 px-4 py-3">
                <div className={`w-2 h-2 rounded-full shrink-0 ${ex.status === "success" ? "bg-green-500" : ex.status === "skipped" ? "bg-muted-foreground" : "bg-red-500"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground truncate">Rule #{ex.ruleId} · {ex.triggerEventType ?? "unknown"}</p>
                  {ex.customerProfileId && <p className="text-xs text-muted-foreground">Customer #{ex.customerProfileId}</p>}
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    ex.status === "success" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : ex.status === "skipped" ? "bg-muted text-muted-foreground"
                    : "bg-red-100 text-red-700"
                  }`}>
                    {ex.status}
                  </span>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {new Date(ex.executedAt).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: typeof Zap; label: string; value: number; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <Icon className={`w-4 h-4 mb-2 ${color ?? "text-muted-foreground"}`} />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
