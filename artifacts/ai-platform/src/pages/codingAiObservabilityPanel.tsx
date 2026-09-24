import { useEffect, useState } from "react";
import { Activity, CircleDollarSign, Clock3, Cpu, Gauge, Hash } from "lucide-react";

type Telemetry = {
  taskId: string;
  latest: {
    executionId: string | null;
    status: string | null;
    nextAction: string | null;
    provider: string | null;
    model: string | null;
    totalTokens: number;
    latencyMs: number | null;
    packageHash: string | null;
    candidatePatchSha256: string | null;
    policyStatus: string | null;
    failureKind: string | null;
    errorMessage: string | null;
    estimatedCostUsd: number | null;
  } | null;
  totals: {
    executions: number;
    successful: number;
    failed: number;
    modelInvocations: number;
    totalTokens: number;
    totalLatencyMs: number;
    estimatedCostUsd: number;
  };
};

function compactHash(value: string | null | undefined): string {
  return value ? value.slice(0, 12) : "—";
}

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(6)}`;
}

export function CodingAiObservabilityPanel({ taskId }: { taskId: string }) {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(
          `/api/ai/coding/tasks/${taskId}/observability`,
          { credentials: "include", headers: { Accept: "application/json" } },
        );
        if (!response.ok) return;
        const body = await response.json() as Telemetry;
        if (!cancelled) setTelemetry(body);
      } catch {
        // Observability is non-blocking by design.
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [taskId]);

  if (!telemetry?.latest) return null;

  const latest = telemetry.latest;
  return (
    <div
      className="mt-3 rounded-lg border border-violet-300/15 bg-violet-300/[0.025] p-3"
      data-testid="panel-ai-observability"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-violet-300">
          <Activity className="size-3" />
          AI execution telemetry
        </div>
        <div className="font-mono text-[9px] text-slate-500">
          {latest.status ?? latest.nextAction ?? "—"}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded border border-white/[0.06] bg-[#07101d] p-2">
          <div className="flex items-center gap-1 text-[9px] uppercase text-slate-600"><Cpu className="size-3" />Model</div>
          <div className="mt-1 truncate font-mono text-[9px] text-violet-200">{latest.provider ?? "—"} / {latest.model ?? "—"}</div>
        </div>
        <div className="rounded border border-white/[0.06] bg-[#07101d] p-2">
          <div className="flex items-center gap-1 text-[9px] uppercase text-slate-600"><Gauge className="size-3" />Tokens</div>
          <div className="mt-1 font-mono text-[10px] text-slate-300">{latest.totalTokens}</div>
        </div>
        <div className="rounded border border-white/[0.06] bg-[#07101d] p-2">
          <div className="flex items-center gap-1 text-[9px] uppercase text-slate-600"><Clock3 className="size-3" />Latency</div>
          <div className="mt-1 font-mono text-[10px] text-slate-300">{latest.latencyMs == null ? "—" : `${latest.latencyMs} ms`}</div>
        </div>
        <div className="rounded border border-white/[0.06] bg-[#07101d] p-2">
          <div className="flex items-center gap-1 text-[9px] uppercase text-slate-600"><CircleDollarSign className="size-3" />Est. cost</div>
          <div className="mt-1 font-mono text-[10px] text-slate-300">{money(latest.estimatedCostUsd)}</div>
        </div>
        <div className="rounded border border-white/[0.06] bg-[#07101d] p-2">
          <div className="flex items-center gap-1 text-[9px] uppercase text-slate-600"><Hash className="size-3" />Package</div>
          <div className="mt-1 font-mono text-[10px] text-slate-300" title={latest.packageHash ?? undefined}>{compactHash(latest.packageHash)}</div>
        </div>
        <div className="rounded border border-white/[0.06] bg-[#07101d] p-2">
          <div className="text-[9px] uppercase text-slate-600">Policy / patch</div>
          <div className="mt-1 font-mono text-[9px] text-slate-300">
            {latest.policyStatus ?? "—"} · {compactHash(latest.candidatePatchSha256)}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] text-slate-500">
        <span>executions {telemetry.totals.executions}</span>
        <span>success {telemetry.totals.successful}</span>
        <span>failed {telemetry.totals.failed}</span>
        <span>model calls {telemetry.totals.modelInvocations}</span>
        <span>total tokens {telemetry.totals.totalTokens}</span>
        <span>total cost {money(telemetry.totals.estimatedCostUsd)}</span>
      </div>

      {(latest.failureKind || latest.errorMessage) && (
        <div className="mt-2 rounded border border-rose-300/15 bg-rose-300/[0.03] p-2 text-[9px] text-rose-200">
          <span className="font-mono text-rose-300">{latest.failureKind ?? "EXECUTION_FAILED"}</span>
          {latest.errorMessage ? <span className="text-slate-400"> · {latest.errorMessage}</span> : null}
        </div>
      )}
    </div>
  );
}
