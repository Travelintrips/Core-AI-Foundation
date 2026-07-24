/**
 * AbandonedCheckoutPanel.tsx — Team 03
 */

import { useState, useEffect } from "react";

const BASE = "/api/ai/creative-commercial";

interface AbandonedCheckout {
  customerId: number | null;
  sessionId: string | null;
  serviceId: number | null;
  abandonedAt: string;
  hoursSinceAbandonment: number;
}

interface AbandonmentStats {
  totalAbandoned: number;
  recoveredCount: number;
  recoveryRate: number;
  avgHoursBeforeAbandonment: number;
}

export default function AbandonedCheckoutPanel() {
  const [abandonments, setAbandonments] = useState<AbandonedCheckout[]>([]);
  const [stats, setStats] = useState<AbandonmentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowHours, setWindowHours] = useState(24);

  useEffect(() => {
    setLoading(true);
    fetch(`${BASE}/abandoned-checkouts?windowHours=${windowHours}&limit=50`, {

    })
      .then((r) => r.json())
      .then((d) => {
        setAbandonments(d.abandonments ?? []);
        setStats(d.stats ?? null);
      })
      .finally(() => setLoading(false));
  }, [windowHours]);

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-400">Window:</span>
        {[12, 24, 48, 168].map((h) => (
          <button
            key={h}
            onClick={() => setWindowHours(h)}
            className={`rounded px-2.5 py-1 text-xs font-medium ${windowHours === h ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
          >
            {h}h
          </button>
        ))}
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Abandoned", value: stats.totalAbandoned.toLocaleString(), color: "text-amber-400" },
            { label: "Recovered", value: stats.recoveredCount.toLocaleString(), color: "text-emerald-400" },
            { label: "Recovery Rate", value: `${stats.recoveryRate}%`, color: "text-violet-400" },
            { label: "Avg. Hours", value: stats.avgHoursBeforeAbandonment.toFixed(1), color: "text-gray-300" },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl bg-gray-900 p-3 ring-1 ring-gray-800">
              <p className="text-xs text-gray-500">{kpi.label}</p>
              <p className={`mt-0.5 text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
            </div>
          ))}
        </div>
      )}

      {loading && <div className="text-gray-400 py-6 text-center text-sm">Loading…</div>}

      {/* Table */}
      {!loading && abandonments.length > 0 && (
        <div className="rounded-xl bg-gray-900 ring-1 ring-gray-800">
          <table className="w-full text-xs text-gray-300">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500">
                <th className="px-4 py-2 text-left">Customer ID</th>
                <th className="px-4 py-2 text-left">Service</th>
                <th className="px-4 py-2 text-right">Hours Since</th>
                <th className="px-4 py-2 text-right">Abandoned At</th>
              </tr>
            </thead>
            <tbody>
              {abandonments.map((ab, i) => (
                <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-2">{ab.customerId ?? "—"}</td>
                  <td className="px-4 py-2">{ab.serviceId ?? "—"}</td>
                  <td className="px-4 py-2 text-right text-amber-400">{ab.hoursSinceAbandonment.toFixed(1)}h</td>
                  <td className="px-4 py-2 text-right text-gray-500">
                    {new Date(ab.abandonedAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && abandonments.length === 0 && (
        <div className="rounded-xl bg-gray-900 p-8 text-center ring-1 ring-gray-800">
          <p className="text-sm text-gray-500">No abandoned checkouts in the last {windowHours} hours. 🎉</p>
        </div>
      )}
    </div>
  );
}
