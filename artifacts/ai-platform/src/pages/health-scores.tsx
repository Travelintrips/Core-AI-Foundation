/**
 * Customer Health Score — Sprint P2.5
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Heart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const HEADERS = () => {
  const k = import.meta.env.VITE_ADMIN_API_KEY;
  return { "Content-Type": "application/json", ...(k ? { "x-admin-api-key": k } : {}) };
};
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: HEADERS(), ...init });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

type HealthScore = {
  id: number; customerProfileId: number;
  paymentScore: number; activityScore: number; repeatOrderScore: number;
  reviewScore: number; responseTimeScore: number; overallScore: number;
  healthStatus: string; lastCalculatedAt: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  healthy: { label: "Healthy", color: "text-green-400", bg: "bg-green-500/10 border-green-500/20" },
  potential: { label: "Potential", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
  at_risk: { label: "At Risk", color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20" },
  lost: { label: "Lost", color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
};

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 75 ? "bg-green-500" : value >= 50 ? "bg-blue-500" : value >= 25 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
      <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-mono w-8 text-right">{value}</span>
    </div>
  );
}

export default function HealthScoresPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["customer-health"],
    queryFn: () => apiFetch<{ items: HealthScore[]; total: number }>("/api/ai/customer-health"),
    refetchInterval: 60_000,
  });

  const recalcMutation = useMutation({
    mutationFn: (profileId: number) =>
      apiFetch(`/api/ai/customer-health/${profileId}/recalculate`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer-health"] });
      toast({ title: "Health score recalculated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const counts = data?.items.reduce((acc, s) => {
    acc[s.healthStatus] = (acc[s.healthStatus] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>) ?? {};

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Heart className="size-6 text-rose-400" />Customer Health Score</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Monitor customer engagement and retention risk</p>
        </div>
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-4 gap-4">
        {(["healthy","potential","at_risk","lost"] as const).map((s) => {
          const cfg = STATUS_CONFIG[s];
          return (
            <Card key={s} className={`border ${cfg.bg}`}>
              <CardContent className="p-4 text-center">
                <p className={`text-3xl font-bold ${cfg.color}`}>{counts[s] ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">{cfg.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Score list */}
      <Card>
        <CardHeader><CardTitle className="text-base">All Customers ({data?.total ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-muted-foreground text-sm">Loading…</div>
          ) : data?.items.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              No health scores yet.<br />
              <span className="text-xs">Use the Recalculate button on individual customers to generate scores.</span>
            </div>
          ) : (
            <div className="space-y-4">
              {data?.items.map((s) => {
                const cfg = STATUS_CONFIG[s.healthStatus] ?? STATUS_CONFIG.potential;
                return (
                  <div key={s.id} className="rounded-lg border border-border p-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="font-medium text-sm">Customer #{s.customerProfileId}</span>
                          <Badge className={`${cfg.bg} ${cfg.color} border`}>{cfg.label}</Badge>
                          <span className="text-xs text-muted-foreground ml-auto">Overall: <strong className={cfg.color}>{s.overallScore}/100</strong></span>
                        </div>
                        <div className="space-y-1.5">
                          <ScoreBar label="Payment" value={s.paymentScore} />
                          <ScoreBar label="Activity" value={s.activityScore} />
                          <ScoreBar label="Repeat Order" value={s.repeatOrderScore} />
                          <ScoreBar label="Review" value={s.reviewScore} />
                          <ScoreBar label="Response Time" value={s.responseTimeScore} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          Last calculated: {new Date(s.lastCalculatedAt).toLocaleString("id-ID")}
                        </p>
                      </div>
                      <Button
                        size="icon" variant="ghost"
                        onClick={() => recalcMutation.mutate(s.customerProfileId)}
                        disabled={recalcMutation.isPending}
                        title="Recalculate"
                      >
                        <RefreshCw className={`size-4 ${recalcMutation.isPending ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
