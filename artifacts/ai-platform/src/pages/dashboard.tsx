import { useGetAnalyticsOverview, useGetAnalyticsUsage, useGetProviderBreakdown, useListAuditLogs } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Box, Database, FileText, GitMerge, Layers, Cpu, Code2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { format } from "date-fns";
import { useLang } from "@/lib/i18n";

export default function Dashboard() {
  const { t } = useLang();
  const { data: overview, isLoading: overviewLoading } = useGetAnalyticsOverview();
  const { data: usage, isLoading: usageLoading } = useGetAnalyticsUsage({ days: 7 });
  const { data: providerBreakdown, isLoading: providerBreakdownLoading } = useGetProviderBreakdown();
  const { data: auditLogs, isLoading: auditLogsLoading } = useListAuditLogs({ limit: 5 });

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("pages.dashboard.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("pages.dashboard.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4">
        <StatCard title={t("pages.dashboard.stats.providers")} value={overview?.totalProviders} icon={Layers} loading={overviewLoading} />
        <StatCard title={t("pages.dashboard.stats.models")} value={overview?.totalModels} icon={Box} loading={overviewLoading} />
        <StatCard title={t("pages.dashboard.stats.workflows")} value={overview?.totalWorkflows} icon={GitMerge} loading={overviewLoading} />
        <StatCard title={t("pages.dashboard.stats.prompts")} value={overview?.totalPrompts} icon={FileText} loading={overviewLoading} />
        <StatCard title={t("pages.dashboard.stats.knowledge")} value={overview?.totalKnowledgeBases} icon={Database} loading={overviewLoading} />
        <StatCard title={t("pages.dashboard.stats.memory")} value={overview?.totalMemoryEntries} icon={Cpu} loading={overviewLoading} />
        <StatCard title={t("pages.dashboard.stats.tokens")} value={overview?.totalTokensUsed?.toLocaleString()} icon={Code2} loading={overviewLoading} />
        <StatCard title={t("pages.dashboard.stats.executions")} value={overview?.totalExecutions?.toLocaleString()} icon={Activity} loading={overviewLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="col-span-2 border-border/50 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground">{t("pages.dashboard.charts.tokenUsage")}</CardTitle>
          </CardHeader>
          <CardContent className="pl-0">
            <div className="h-[300px] w-full">
              {usageLoading ? (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground font-mono text-sm">{t("pages.dashboard.loading.telemetry")}</div>
              ) : usage && usage.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={usage} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      stroke="hsl(var(--muted-foreground))" 
                      fontSize={12} 
                      tickLine={false} 
                      axisLine={false}
                      tickFormatter={(val) => format(new Date(val), 'MMM d')}
                    />
                    <YAxis 
                      stroke="hsl(var(--muted-foreground))" 
                      fontSize={12} 
                      tickLine={false} 
                      axisLine={false}
                      tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                    />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '4px' }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                    />
                    <Line type="monotone" dataKey="tokensUsed" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4, fill: 'hsl(var(--background))', strokeWidth: 2 }} activeDot={{ r: 6, fill: 'hsl(var(--primary))' }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground font-mono text-sm">{t("pages.dashboard.empty.telemetry")}</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground">{t("pages.dashboard.charts.providerDistribution")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              {providerBreakdownLoading ? (
                 <div className="w-full h-full flex items-center justify-center text-muted-foreground font-mono text-sm">{t("pages.dashboard.loading.breakdown")}</div>
              ) : providerBreakdown && providerBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={providerBreakdown} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis dataKey="providerName" type="category" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <RechartsTooltip 
                      cursor={{fill: 'hsl(var(--muted))'}}
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '4px' }}
                    />
                    <Bar dataKey="tokensUsed" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                 <div className="w-full h-full flex items-center justify-center text-muted-foreground font-mono text-sm">{t("pages.dashboard.empty.provider")}</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground">{t("pages.dashboard.charts.recentAudit")}</CardTitle>
        </CardHeader>
        <CardContent>
          {auditLogsLoading ? (
            <div className="py-8 text-center text-muted-foreground font-mono text-sm">{t("pages.dashboard.loading.activity")}</div>
          ) : auditLogs?.items && auditLogs.items.length > 0 ? (
            <div className="space-y-4">
              {auditLogs.items.map((log) => (
                <div key={log.id} className="flex items-start justify-between py-3 border-b border-border/50 last:border-0 group">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">{log.module}</span>
                      <span className="font-mono text-xs text-muted-foreground">{log.action}</span>
                    </div>
                    <span className="text-sm text-foreground/80">{t("pages.dashboard.actor")}: {log.actorId || 'system'}</span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs font-mono text-muted-foreground">{format(new Date(log.createdAt), 'MMM d, HH:mm:ss')}</span>
                    <span className={`text-[10px] uppercase tracking-wider font-mono ${log.status === 'success' ? 'text-green-400' : log.status === 'failure' ? 'text-destructive' : 'text-yellow-400'}`}>{log.status}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
             <div className="py-8 text-center text-muted-foreground font-mono text-sm">{t("pages.dashboard.empty.activity")}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, loading }: { title: string; value?: string | number; icon: any; loading: boolean }) {
  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <CardContent className="p-4 flex flex-col items-start gap-4">
        <div className="flex justify-between items-center w-full">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-mono">{title}</span>
          <Icon className="size-4 text-primary/50" />
        </div>
        <div className="text-2xl font-bold tracking-tight">
          {loading ? <div className="h-8 w-16 bg-muted animate-pulse rounded" /> : (value || 0)}
        </div>
      </CardContent>
    </Card>
  );
}
