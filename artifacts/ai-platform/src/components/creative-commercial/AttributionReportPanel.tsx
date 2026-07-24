/**
 * AttributionReportPanel.tsx — Team 03
 * Displays attribution report with model selector.
 */

import { useState, useEffect } from "react";

const BASE = "/api/ai/creative-commercial";

type Model = "first_touch" | "last_touch" | "linear" | "time_decay";

interface AttributionReport {
  model: Model;
  periodDays: number;
  bySource: Record<string, { touchpoints: number; conversions: number; weightedConversions: number; revenue: number }>;
  topChannels: Array<{ source: string; weightedShare: number }>;
}

const MODEL_LABELS: Record<Model, string> = {
  first_touch: "First Touch",
  last_touch: "Last Touch",
  linear: "Linear",
  time_decay: "Time Decay",
};

export default function AttributionReportPanel() {
  const [data, setData] = useState<AttributionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<Model>("linear");
  const [periodDays, setPeriodDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${BASE}/attribution/report?model=${model}&periodDays=${periodDays}`, {
      headers: { "x-admin-api-key": import.meta.env.VITE_ADMIN_API_KEY ?? "" },
    })
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [model, periodDays]);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Model:</span>
          {(Object.keys(MODEL_LABELS) as Model[]).map((m) => (
            <button
              key={m}
              onClick={() => setModel(m)}
              className={`rounded px-2.5 py-1 text-xs font-medium ${model === m ? "bg-violet-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
            >
              {MODEL_LABELS[m]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Period:</span>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setPeriodDays(d)}
              className={`rounded px-2.5 py-1 text-xs font-medium ${periodDays === d ? "bg-violet-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="text-gray-400 py-8 text-center">Loading attribution data…</div>}
      {error && <div className="text-red-400 py-8 text-center">{error}</div>}

      {data && !loading && (
        <>
          {/* Top channels */}
          <div className="rounded-xl bg-gray-900 p-5 ring-1 ring-gray-800">
            <h3 className="mb-4 text-sm font-semibold text-gray-300">Top Channels — {MODEL_LABELS[model]}</h3>
            {data.topChannels.length === 0 ? (
              <p className="text-xs text-gray-500">No attribution data for this period.</p>
            ) : (
              <div className="space-y-3">
                {data.topChannels.map((ch) => (
                  <div key={ch.source}>
                    <div className="mb-1 flex justify-between text-xs text-gray-400">
                      <span className="capitalize">{ch.source}</span>
                      <span>{ch.weightedShare}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-800">
                      <div
                        className="h-2 rounded-full bg-emerald-500"
                        style={{ width: `${ch.weightedShare}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Source table */}
          <div className="rounded-xl bg-gray-900 p-5 ring-1 ring-gray-800">
            <h3 className="mb-4 text-sm font-semibold text-gray-300">All Sources</h3>
            <table className="w-full text-xs text-gray-300">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="pb-2 text-left">Source</th>
                  <th className="pb-2 text-right">Touchpoints</th>
                  <th className="pb-2 text-right">Conversions</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.bySource).map(([src, d]) => (
                  <tr key={src} className="border-b border-gray-800/50">
                    <td className="py-2 capitalize">{src}</td>
                    <td className="py-2 text-right">{d.touchpoints.toLocaleString()}</td>
                    <td className="py-2 text-right">{d.conversions.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
