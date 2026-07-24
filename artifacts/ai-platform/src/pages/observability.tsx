/**
 * Observability — AI Observability & Cost Intelligence
 *
 * Tabs:
 *   1. Overview   — KPI cards + per-provider, per-model, per-agent cost bars
 *   2. Logs       — filterable execution log table
 *   3. Workflows  — aggregated workflow cost rows
 *   4. Pricing    — editable ai_provider_pricing table
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertCircle, BarChart2, CheckCircle, ChevronDown,
  CircleDollarSign, Clock, Cpu, Database, Edit3, Plus, RefreshCw,
  Search, Server, TrendingDown, TrendingUp, XCircle, Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ── API helpers ───────────────────────────────────────────────────────────────

const API_BASE = "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(opts?.headers as Record<string, string>) };
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  if (key) headers["x-admin-api-key"] = key;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExecutionLog {
  id: number;
  jobId: number | null;
  workflowId: number | null;
  orderId: string | null;
  agentName: string | null;
  providerName: string | null;
  modelName: string | null;
  requestType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: string | null;
  latencyMs: number | null;
  status: string;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
}

interface WorkflowCost {
  id: number;
  workflowId: number | null;
  jobId: number | null;
  orderId: string | null;
  totalAgents: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostUsd: string | null;
  processingTimeMs: number | null;
  createdAt: string;
}

interface ProviderPricing {
  id: number;
  provider: string;
  model: string;
  inputPricePer1m: string;
  outputPricePer1m: string;
  cachedInputPrice: string | null;
  reasoningPrice: string | null;
  currency: string;
  active: boolean;
  effectiveDate: string | null;
  updatedAt: string;
}

interface CostSummary {
  totals: {
    calls: number;
    tokens: number;
    costUsd: number;
    avgLatencyMs: number;
    errorCount: number;
  };
  byProvider: Array<{ provider: string | null; calls: number; totalTokens: number; totalCostUsd: number; avgLatencyMs: number }>;
  byModel:    Array<{ model: string | null; provider: string | null; calls: number; totalTokens: number; totalCostUsd: number }>;
  byAgent:    Array<{ agent: string | null; calls: number; totalTokens: number; totalCostUsd: number; avgLatencyMs: number }>;
  byOrder:    Array<{ orderId: string | null; calls: number; totalTokens: number; totalCostUsd: number }>;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtTokens(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(n: number | string | null | undefined) {
  const v = n == null ? null : Number(n);
  if (v == null || isNaN(v)) return "—";
  if (v === 0) return "$0.000000";
  if (v < 0.000001) return `<$0.000001`;
  if (v < 0.01) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(4)}`;
}

function fmtMs(ms: number | null | undefined) {
  if (ms == null) return "—";
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)}s`;
  return `${ms}ms`;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "success") return <Badge className="bg-green-500/15 text-green-400 border-green-500/30">{status}</Badge>;
  if (s === "failed")  return <Badge className="bg-red-500/15 text-red-400 border-red-500/30">{status}</Badge>;
  if (s === "timeout") return <Badge className="bg-orange-500/15 text-orange-400 border-orange-500/30">{status}</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card className="bg-card border border-border">
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
            <p className={cn("text-2xl font-bold", color ?? "text-foreground")}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={cn("p-2 rounded-lg", color ? "bg-current/10" : "bg-muted")}>
            <Icon className={cn("size-5", color ?? "text-muted-foreground")} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Simple horizontal bar chart ───────────────────────────────────────────────

function BarList<T extends Record<string, unknown>>({
  data, nameKey, valueKey, label, format,
}: {
  data: T[];
  nameKey: keyof T;
  valueKey: keyof T;
  label: string;
  format?: (v: number) => string;
}) {
  if (!data.length) return <p className="text-sm text-muted-foreground py-4 text-center">No data yet</p>;
  const max = Math.max(...data.map((r) => Number(r[valueKey]) || 0));
  return (
    <div className="space-y-2">
      {data.slice(0, 8).map((row, i) => {
        const name  = String(row[nameKey] ?? "—");
        const value = Number(row[valueKey]) || 0;
        const pct   = max > 0 ? (value / max) * 100 : 0;
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-32 truncate shrink-0" title={name}>{name || "—"}</span>
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-mono text-foreground w-20 text-right shrink-0">
              {format ? format(value) : value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ summary, onInit }: { summary: CostSummary | undefined; onInit: () => void }) {
  const { totals, byProvider, byModel, byAgent, byOrder } = summary ?? {
    totals: { calls: 0, tokens: 0, costUsd: 0, avgLatencyMs: 0, errorCount: 0 },
    byProvider: [], byModel: [], byAgent: [], byOrder: [],
  };

  const errorRate = totals.calls > 0 ? ((totals.errorCount / totals.calls) * 100).toFixed(1) : "0.0";

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard icon={Zap}             label="Total Calls"     value={totals.calls.toLocaleString()} />
        <KpiCard icon={Cpu}             label="Total Tokens"    value={fmtTokens(totals.tokens)} />
        <KpiCard icon={CircleDollarSign} label="Estimated Cost" value={fmtCost(totals.costUsd)} color="text-emerald-400" />
        <KpiCard icon={Clock}           label="Avg Latency"     value={fmtMs(totals.avgLatencyMs)} />
        <KpiCard icon={AlertCircle}     label="Error Rate"      value={`${errorRate}%`}
          sub={`${totals.errorCount} errors`} color={totals.errorCount > 0 ? "text-red-400" : undefined} />
      </div>

      {/* Init banner when no data */}
      {totals.calls === 0 && (
        <Card className="border-dashed border-muted-foreground/30 bg-muted/20">
          <CardContent className="py-8 text-center">
            <Activity className="size-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="font-medium mb-1">No execution data yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              Logs appear automatically once AI agents run. Click below to initialize tables and seed default pricing.
            </p>
            <Button variant="outline" onClick={onInit}>
              <Database className="size-4 mr-2" /> Initialize Observability Tables
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Breakdown grids */}
      {totals.calls > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-sm">Cost by Provider</CardTitle></CardHeader>
            <CardContent>
              <BarList data={byProvider} nameKey="provider" valueKey="totalCostUsd" label="Cost" format={(v) => fmtCost(v)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Cost by Agent</CardTitle></CardHeader>
            <CardContent>
              <BarList data={byAgent} nameKey="agent" valueKey="totalCostUsd" label="Cost" format={(v) => fmtCost(v)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Tokens by Model</CardTitle></CardHeader>
            <CardContent>
              <BarList data={byModel} nameKey="model" valueKey="totalTokens" label="Tokens" format={(v) => fmtTokens(v)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Cost by Order / Service Request</CardTitle></CardHeader>
            <CardContent>
              <BarList data={byOrder} nameKey="orderId" valueKey="totalCostUsd" label="Cost" format={(v) => fmtCost(v)} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Provider detail table */}
      {byProvider.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Provider Breakdown</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Est. Cost</TableHead>
                  <TableHead className="text-right">Avg Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byProvider.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{row.provider ?? "—"}</TableCell>
                    <TableCell className="text-right text-xs">{row.calls.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-xs font-mono">{fmtTokens(row.totalTokens)}</TableCell>
                    <TableCell className="text-right text-xs font-mono text-emerald-400">{fmtCost(row.totalCostUsd)}</TableCell>
                    <TableCell className="text-right text-xs">{fmtMs(row.avgLatencyMs)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Tab: Execution Logs ───────────────────────────────────────────────────────

function LogsTab() {
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("all");
  const [status, setStatus]   = useState("all");
  const [page, setPage]       = useState(0);
  const limit = 50;

  const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
  if (provider !== "all") params.set("provider", provider);
  if (status   !== "all") params.set("status",   status);

  const { data, isLoading, refetch } = useQuery<{ items: ExecutionLog[]; total: number }>({
    queryKey: ["obs-logs", provider, status, page],
    queryFn:  () => apiFetch(`/api/ai/observability/execution-logs?${params}`),
    refetchInterval: 30_000,
  });

  const filtered = (data?.items ?? []).filter((r) =>
    !search ||
    (r.agentName   ?? "").includes(search) ||
    (r.modelName   ?? "").includes(search) ||
    (r.providerName ?? "").includes(search) ||
    (r.orderId     ?? "").includes(search) ||
    String(r.jobId ?? "").includes(search),
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input placeholder="Search agent, model, order…" className="pl-8 h-8 text-sm"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Provider" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="anthropic">Anthropic</SelectItem>
            <SelectItem value="google">Google</SelectItem>
            <SelectItem value="mistral">Mistral</SelectItem>
            <SelectItem value="replicate">Replicate</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="timeout">Timeout</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="h-8" onClick={() => refetch()}>
          <RefreshCw className="size-3.5 mr-1" /> Refresh
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{data?.total ?? 0} total</span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">ID</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Provider / Model</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Est. Cost</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Job / Order</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">No logs yet — logs appear once AI agents run.</TableCell></TableRow>
              )}
              {filtered.map((log) => (
                <TableRow key={log.id} className="text-xs">
                  <TableCell className="font-mono text-muted-foreground">{log.id}</TableCell>
                  <TableCell>{log.agentName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{log.providerName ?? "—"}</span>
                      <span className="text-muted-foreground font-mono">{log.modelName ?? "—"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <div className="flex flex-col items-end gap-0.5">
                      <span>{fmtTokens(log.totalTokens)}</span>
                      <span className="text-muted-foreground text-[10px]">
                        {fmtTokens(log.promptTokens)}↑ {fmtTokens(log.completionTokens)}↓
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-emerald-400">{fmtCost(log.estimatedCostUsd)}</TableCell>
                  <TableCell className="text-right">{fmtMs(log.latencyMs)}</TableCell>
                  <TableCell>
                    {statusBadge(log.status)}
                    {log.retryCount > 0 && (
                      <span className="ml-1 text-[10px] text-orange-400">×{log.retryCount}</span>
                    )}
                    {log.errorMessage && (
                      <p className="text-[10px] text-red-400 mt-0.5 max-w-[180px] truncate" title={log.errorMessage}>
                        {log.errorMessage}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {log.jobId ? `job #${log.jobId}` : ""}
                    {log.orderId ? <span className="block text-[10px]">{log.orderId}</span> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(log.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {(data?.total ?? 0) > limit && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</Button>
          <span className="text-sm text-muted-foreground self-center">
            Page {page + 1} of {Math.ceil((data?.total ?? 0) / limit)}
          </span>
          <Button variant="outline" size="sm"
            disabled={(page + 1) * limit >= (data?.total ?? 0)}
            onClick={() => setPage(page + 1)}>Next →</Button>
        </div>
      )}
    </div>
  );
}

// ── Tab: Workflow Costs ───────────────────────────────────────────────────────

function WorkflowCostsTab() {
  const { data, isLoading } = useQuery<{ items: WorkflowCost[]; total: number }>({
    queryKey: ["obs-workflow-costs"],
    queryFn:  () => apiFetch("/api/ai/observability/workflow-costs"),
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Workflow / Job</TableHead>
              <TableHead>Order</TableHead>
              <TableHead className="text-right">Agents</TableHead>
              <TableHead className="text-right">Prompt Tokens</TableHead>
              <TableHead className="text-right">Completion Tokens</TableHead>
              <TableHead className="text-right">Total Tokens</TableHead>
              <TableHead className="text-right">Total Cost</TableHead>
              <TableHead className="text-right">Processing Time</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
            )}
            {!isLoading && (data?.items ?? []).length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground text-sm">No workflow cost records yet.</TableCell></TableRow>
            )}
            {(data?.items ?? []).map((row) => (
              <TableRow key={row.id} className="text-xs">
                <TableCell className="font-mono text-muted-foreground">{row.id}</TableCell>
                <TableCell className="font-mono">
                  {row.workflowId ? `wf#${row.workflowId}` : row.jobId ? `job#${row.jobId}` : "—"}
                </TableCell>
                <TableCell>{row.orderId ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-right">{row.totalAgents}</TableCell>
                <TableCell className="text-right font-mono">{fmtTokens(row.totalPromptTokens)}</TableCell>
                <TableCell className="text-right font-mono">{fmtTokens(row.totalCompletionTokens)}</TableCell>
                <TableCell className="text-right font-mono">{fmtTokens(row.totalTokens)}</TableCell>
                <TableCell className="text-right font-mono text-emerald-400">{fmtCost(row.totalCostUsd)}</TableCell>
                <TableCell className="text-right">{fmtMs(row.processingTimeMs)}</TableCell>
                <TableCell className="text-muted-foreground">{fmtDate(row.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Pricing edit dialog ───────────────────────────────────────────────────────

interface PricingFormState {
  provider: string;
  model: string;
  inputPricePer1m: string;
  outputPricePer1m: string;
  cachedInputPrice: string;
  reasoningPrice: string;
  active: boolean;
}

function PricingDialog({
  open, onClose, initial,
}: {
  open: boolean;
  onClose: () => void;
  initial: ProviderPricing | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [form, setForm] = useState<PricingFormState>(() => ({
    provider:         initial?.provider         ?? "",
    model:            initial?.model            ?? "",
    inputPricePer1m:  initial?.inputPricePer1m  ?? "2.50",
    outputPricePer1m: initial?.outputPricePer1m ?? "10.00",
    cachedInputPrice: initial?.cachedInputPrice ?? "",
    reasoningPrice:   initial?.reasoningPrice   ?? "",
    active:           initial?.active           ?? true,
  }));

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        provider:         form.provider,
        model:            form.model,
        inputPricePer1m:  Number(form.inputPricePer1m),
        outputPricePer1m: Number(form.outputPricePer1m),
        cachedInputPrice: form.cachedInputPrice ? Number(form.cachedInputPrice) : null,
        reasoningPrice:   form.reasoningPrice   ? Number(form.reasoningPrice)   : null,
        active:           form.active,
      };
      if (initial) {
        return apiFetch(`/api/ai/observability/provider-pricing/${initial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      return apiFetch("/api/ai/observability/provider-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["obs-pricing"] });
      toast({ title: "Pricing saved" });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const field = (label: string, key: keyof PricingFormState, placeholder?: string) => (
    <div className="grid grid-cols-4 items-center gap-3">
      <Label className="text-right text-xs col-span-1">{label}</Label>
      <Input
        className="col-span-3 h-8 text-sm"
        placeholder={placeholder}
        value={String(form[key])}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        disabled={key === "provider" || key === "model" ? !!initial : false}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Pricing" : "Add Model Pricing"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {field("Provider", "provider", "openai")}
          {field("Model", "model", "gpt-4o")}
          {field("Input ($/1M tok)", "inputPricePer1m", "2.50")}
          {field("Output ($/1M tok)", "outputPricePer1m", "10.00")}
          {field("Cached input", "cachedInputPrice", "optional")}
          {field("Reasoning", "reasoningPrice", "optional")}
          <div className="grid grid-cols-4 items-center gap-3">
            <Label className="text-right text-xs col-span-1">Active</Label>
            <input type="checkbox" className="col-span-1"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Tab: Provider Pricing ─────────────────────────────────────────────────────

function PricingTab() {
  const { data, isLoading } = useQuery<{ items: ProviderPricing[]; total: number }>({
    queryKey: ["obs-pricing"],
    queryFn:  () => apiFetch("/api/ai/observability/provider-pricing"),
  });
  const { toast } = useToast();
  const qc = useQueryClient();

  const [dialogOpen, setDialogOpen]   = useState(false);
  const [editing, setEditing]         = useState<ProviderPricing | null>(null);
  const [search, setSearch]           = useState("");

  const seedMut = useMutation({
    mutationFn: () => apiFetch<{ inserted: number; message: string }>("/api/ai/observability/seed-pricing", { method: "POST" }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["obs-pricing"] });
      toast({ title: r.message });
    },
    onError: (err: Error) => toast({ title: "Seed failed", description: err.message, variant: "destructive" }),
  });

  const filtered = (data?.items ?? []).filter(
    (r) => !search || r.provider.includes(search) || r.model.includes(search),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input placeholder="Search provider or model…" className="pl-8 h-8 text-sm"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={() => seedMut.mutate()} disabled={seedMut.isPending}>
          <Database className="size-3.5 mr-1" /> {seedMut.isPending ? "Seeding…" : "Seed Defaults"}
        </Button>
        <Button size="sm" className="h-8" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus className="size-3.5 mr-1" /> Add Model
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{data?.total ?? 0} models</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Input $/1M</TableHead>
                <TableHead className="text-right">Output $/1M</TableHead>
                <TableHead className="text-right">Cached $/1M</TableHead>
                <TableHead className="text-right">Reasoning $/1M</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
              )}
              {filtered.map((row) => (
                <TableRow key={row.id} className="text-xs">
                  <TableCell className="font-medium">{row.provider}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{row.model}</TableCell>
                  <TableCell className="text-right font-mono">${Number(row.inputPricePer1m).toFixed(3)}</TableCell>
                  <TableCell className="text-right font-mono">${Number(row.outputPricePer1m).toFixed(3)}</TableCell>
                  <TableCell className="text-right font-mono">{row.cachedInputPrice ? `$${Number(row.cachedInputPrice).toFixed(3)}` : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{row.reasoningPrice   ? `$${Number(row.reasoningPrice).toFixed(3)}`   : "—"}</TableCell>
                  <TableCell>
                    {row.active
                      ? <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-[10px]">Active</Badge>
                      : <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(row.updatedAt)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="size-6"
                      onClick={() => { setEditing(row); setDialogOpen(true); }}>
                      <Edit3 className="size-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PricingDialog open={dialogOpen} onClose={() => setDialogOpen(false)} initial={editing} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "overview" | "logs" | "workflows" | "pricing";

export default function ObservabilityPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const { toast } = useToast();
  const qc = useQueryClient();

  const summaryQ = useQuery<CostSummary>({
    queryKey: ["obs-cost-summary"],
    queryFn:  () => apiFetch("/api/ai/observability/cost-summary"),
    refetchInterval: 60_000,
  });

  const initMut = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; message: string; pricingRowsSeeded: number }>(
      "/api/ai/observability/init", { method: "POST" },
    ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["obs-cost-summary"] });
      qc.invalidateQueries({ queryKey: ["obs-pricing"] });
      toast({ title: "Tables initialized", description: `${r.pricingRowsSeeded} pricing rows seeded` });
    },
    onError: (err: Error) => toast({ title: "Init failed", description: err.message, variant: "destructive" }),
  });

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "overview",   label: "Overview",       icon: BarChart2  },
    { id: "logs",       label: "Execution Logs", icon: Activity   },
    { id: "workflows",  label: "Workflow Costs", icon: Server     },
    { id: "pricing",    label: "Model Pricing",  icon: CircleDollarSign },
  ];

  return (
    <div className="p-6 space-y-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Observability</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Token usage · Cost intelligence · Latency · Error tracking — per agent, model, workflow &amp; order
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-8"
          onClick={() => { summaryQ.refetch(); }}
          disabled={summaryQ.isFetching}>
          <RefreshCw className={cn("size-3.5 mr-1", summaryQ.isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border pb-0">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              tab === id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview"  && <OverviewTab summary={summaryQ.data} onInit={() => initMut.mutate()} />}
      {tab === "logs"      && <LogsTab />}
      {tab === "workflows" && <WorkflowCostsTab />}
      {tab === "pricing"   && <PricingTab />}
    </div>
  );
}
