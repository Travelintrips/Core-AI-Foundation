/**
 * Commercial Analytics Dashboard — Sprint P2.5
 * Revenue, conversion funnel, coupon usage, referrals, affiliates, AI insights
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart2, TrendingUp, Users, Tag, Percent, Award, Lightbulb,
  RefreshCw, DollarSign, ShoppingCart, Repeat, Star,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

function apiHeaders(): HeadersInit {

  return {};
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: apiHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

type CommercialAnalytics = {
  days: number;
  revenue: { total: number; mrr: number; arr: number; avgOrderValue: number };
  projects: { total: number; completed: number; conversionRate: number };
  customers: { total: number; newInPeriod: number };
  coupons: { totalUsed: number; totalDiscount: number };
  promotions: { activeCount: number };
  referrals: { total: number; converted: number };
  affiliates: { totalRevenue: number; totalCommission: number };
};

type FunnelAnalytics = {
  days: number;
  steps: Array<{ stage: string; count: number; conversionRate: number | null }>;
  repeatOrders: number;
  referralOrders: number;
  affiliateOrders: number;
};

type Insight = {
  category: string;
  message: string;
  score: number;
  action?: string;
};

function useDays() {
  return useState<"7" | "30" | "90">("30");
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function idrFmt(n: number) {
  return `Rp ${new Intl.NumberFormat("id-ID").format(Math.round(n))}`;
}

const STAGE_LABELS: Record<string, string> = {
  portfolio_view: "Portfolio View",
  portfolio_open: "Portfolio Open",
  preview_start: "Preview Start",
  preview_complete: "Preview Complete",
  package_select: "Package Select",
  checkout: "Checkout",
  payment: "Payment",
  project_created: "Project Created",
  project_completed: "Completed",
  repeat_order: "Repeat Order",
  referral: "Referral",
};

const COLORS = ["#22d3ee","#818cf8","#34d399","#f59e0b","#f87171"];

export default function CommercialPage() {
  const [days, setDays] = useDays();

  const { data: analytics, isLoading: analyticsLoading, refetch } = useQuery({
    queryKey: ["commercial-analytics", days],
    queryFn: () => apiFetch<CommercialAnalytics>(`/api/ai/commercial-analytics?days=${days}`),
    refetchInterval: 60_000,
  });

  const { data: funnel } = useQuery({
    queryKey: ["funnel-analytics", days],
    queryFn: () => apiFetch<FunnelAnalytics>(`/api/ai/funnel/analytics?days=${days}`),
  });

  const { data: insightsData } = useQuery({
    queryKey: ["commercial-insights"],
    queryFn: () => apiFetch<{ items: Insight[]; total: number }>("/api/ai/commercial-analytics/insights"),
  });

  const a = analytics;

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Commercial Analytics</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Revenue, conversion, and growth intelligence</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={days} onValueChange={(v) => setDays(v as "7" | "30" | "90")}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => refetch()}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Revenue", value: a ? idrFmt(a.revenue.total) : "—", icon: DollarSign, color: "text-green-400" },
          { label: "MRR", value: a ? idrFmt(a.revenue.mrr) : "—", icon: TrendingUp, color: "text-cyan-400" },
          { label: "ARR", value: a ? idrFmt(a.revenue.arr) : "—", icon: BarChart2, color: "text-indigo-400" },
          { label: "Avg Order", value: a ? idrFmt(a.revenue.avgOrderValue) : "—", icon: ShoppingCart, color: "text-orange-400" },
          { label: "Conversion Rate", value: a ? `${a.projects.conversionRate}%` : "—", icon: Percent, color: "text-emerald-400" },
          { label: "Total Customers", value: a ? fmt(a.customers.total) : "—", icon: Users, color: "text-blue-400" },
          { label: "Referrals Converted", value: a ? `${a.referrals.converted}/${a.referrals.total}` : "—", icon: Award, color: "text-yellow-400" },
          { label: "Active Promotions", value: a ? String(a.promotions.activeCount) : "—", icon: Tag, color: "text-pink-400" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{kpi.label}</p>
                  <p className="text-xl font-bold mt-1">{analyticsLoading ? "…" : kpi.value}</p>
                </div>
                <kpi.icon className={`size-5 ${kpi.color} mt-0.5`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Funnel + Insights Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Funnel */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sales Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            {funnel ? (
              <div className="space-y-2">
                {funnel.steps.map((step, i) => (
                  <div key={step.stage} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-36 shrink-0">
                      {STAGE_LABELS[step.stage] ?? step.stage}
                    </span>
                    <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{
                          width: `${funnel.steps[0].count > 0 ? Math.min((step.count / funnel.steps[0].count) * 100, 100) : 0}%`,
                          backgroundColor: COLORS[i % COLORS.length],
                        }}
                      />
                    </div>
                    <span className="text-xs font-mono w-12 text-right">{step.count.toLocaleString()}</span>
                    {step.conversionRate !== null && i > 0 && (
                      <Badge variant="outline" className="text-xs w-14 justify-center">
                        {step.conversionRate}%
                      </Badge>
                    )}
                  </div>
                ))}
                <div className="flex gap-6 mt-4 pt-3 border-t border-border text-xs text-muted-foreground">
                  <span><Repeat className="size-3 inline mr-1" />Repeat Orders: {funnel.repeatOrders}</span>
                  <span><Award className="size-3 inline mr-1" />Referral: {funnel.referralOrders}</span>
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground text-sm py-8">Loading funnel…</div>
            )}
          </CardContent>
        </Card>

        {/* AI Insights */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="size-4 text-yellow-400" />
              AI Insights
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {insightsData?.items.map((insight, i) => (
              <div key={i} className="rounded-lg border border-border p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">{insight.category}</Badge>
                  <span className="text-xs text-muted-foreground">Score: {insight.score}</span>
                </div>
                <p className="text-sm">{insight.message}</p>
                {insight.action && (
                  <p className="text-xs text-primary/80">→ {insight.action}</p>
                )}
              </div>
            )) ?? <div className="text-muted-foreground text-sm text-center py-4">Loading insights…</div>}
          </CardContent>
        </Card>
      </div>

      {/* Coupon + Affiliate Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Coupon Performance</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Total Used</span>
              <span className="font-bold">{a?.coupons.totalUsed ?? "—"}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Total Discount Given</span>
              <span className="font-bold">{a ? idrFmt(a.coupons.totalDiscount) : "—"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Affiliate Performance</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Affiliate Revenue</span>
              <span className="font-bold">{a ? idrFmt(a.affiliates.totalRevenue) : "—"}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Total Commission</span>
              <span className="font-bold">{a ? idrFmt(a.affiliates.totalCommission) : "—"}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
