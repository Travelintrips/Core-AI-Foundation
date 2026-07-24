/**
 * FunnelProjectionPanel.tsx — Team 03
 * Fetches and displays funnel projection data from /ai/creative-commercial/funnel/projection
 */

import { useState, useEffect } from "react";

const BASE = "/api/ai/creative-commercial";

interface FunnelStageData {
  stage: string;
  count: number;
  conversionRate: number;
  dropOffRate: number;
}

interface FunnelProjection {
  periodDays: number;
  stages: FunnelStageData[];
  projectedRevenue: number;
  projectedOrders: number;
  bySource: Record<string, { visitors: number; conversions: number; revenue: number }>;
}

const STAGE_LABELS: Record<string, string> = {
  visitor: "Visitor",
  page_view: "Page View",
  service_view: "Service View",
  checkout_started: "Checkout Started",
  submitted: "Form Submitted",
  quoted: "Quoted",
  payment_verified: "Payment Verified",
  completed: "Completed",
};

function formatIDR(value: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

export default function FunnelProjectionPanel() {
  const [data, setData] = useState<FunnelProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periodDays, setPeriodDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${BASE}/funnel/projection?periodDays=${periodDays}`, {
      headers: { "x-admin-api-key": import.meta.env.VITE_ADMIN_API_KEY ?? "" },
    })
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [periodDays]);

  if (loading) return <div className="text-gray-400 py-8 text-center">Loading funnel data…</div>;
  if (error) return <div className="text-red-400 py-8 text-center">{error}</div>;
  if (!data) return null;

  const maxCount = Math.max(...data.stages.map((s) => s.count), 1);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-400">Period:</span>
        {[7, 14, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setPeriodDays(d)}
            className={`rounded px-3 py-1 text-xs font-medium ${periodDays === d ? "bg-violet-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-gray-900 p-4 ring-1 ring-gray-800">
          <p className="text-xs text-gray-400">Projected Orders</p>
          <p className="mt-1 text-2xl font-bold text-white">{data.projectedOrders.toLocaleString()}</p>
        </div>
        <div className="rounded-xl bg-gray-900 p-4 ring-1 ring-gray-800">
          <p className="text-xs text-gray-400">Projected Revenue</p>
          <p className="mt-1 text-2xl font-bold text-emerald-400">{formatIDR(data.projectedRevenue)}</p>
        </div>
        <div className="rounded-xl bg-gray-900 p-4 ring-1 ring-gray-800">
          <p className="text-xs text-gray-400">Overall Conversion</p>
          <p className="mt-1 text-2xl font-bold text-violet-400">
            {data.stages.length > 0 && data.stages[0]!.count > 0
              ? `${((data.stages[data.stages.length - 1]!.count / data.stages[0]!.count) * 100).toFixed(1)}%`
              : "—"}
          </p>
        </div>
      </div>

      {/* Funnel stages */}
      <div className="rounded-xl bg-gray-900 p-5 ring-1 ring-gray-800">
        <h3 className="mb-4 text-sm font-semibold text-gray-300">Funnel Stages</h3>
        <div className="space-y-3">
          {data.stages.map((stage) => (
            <div key={stage.stage}>
              <div className="mb-1 flex justify-between text-xs text-gray-400">
                <span>{STAGE_LABELS[stage.stage] ?? stage.stage}</span>
                <span>{stage.count.toLocaleString()} · {(stage.conversionRate * 100).toFixed(1)}% → next</span>
              </div>
              <div className="h-2 rounded-full bg-gray-800">
                <div
                  className="h-2 rounded-full bg-violet-500"
                  style={{ width: `${(stage.count / maxCount) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* By source */}
      {Object.keys(data.bySource).length > 0 && (
        <div className="rounded-xl bg-gray-900 p-5 ring-1 ring-gray-800">
          <h3 className="mb-4 text-sm font-semibold text-gray-300">By Traffic Source</h3>
          <div className="space-y-2">
            {Object.entries(data.bySource).map(([source, d]) => (
              <div key={source} className="flex items-center justify-between text-sm">
                <span className="text-gray-300">{source}</span>
                <div className="flex gap-4 text-xs text-gray-400">
                  <span>{d.visitors.toLocaleString()} visitors</span>
                  <span>{d.conversions.toLocaleString()} conv.</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
