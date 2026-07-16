/**
 * RepeatOrderPanel.tsx — Team 03
 */

import { useState, useEffect } from "react";

const BASE = "/api/ai/creative-commercial";

interface Candidate {
  customerProfileId: number;
  lastCompletedServiceName: string | null;
  daysSinceLastOrder: number;
  triggerType: "seasonal" | "growth" | "inactive";
}

interface Stats {
  totalRepeatCustomers: number;
  avgDaysBetweenOrders: number;
  repeatRate: number;
}

const TRIGGER_COLORS: Record<string, string> = {
  seasonal: "bg-violet-900/40 text-violet-300 ring-violet-700/40",
  growth:   "bg-emerald-900/40 text-emerald-300 ring-emerald-700/40",
  inactive: "bg-amber-900/40 text-amber-300 ring-amber-700/40",
};

export default function RepeatOrderPanel() {
  const [data, setData] = useState<{ candidates: Candidate[]; stats: Stats } | null>(null);
  const [loading, setLoading] = useState(true);
  const [inactiveDays, setInactiveDays] = useState(60);

  useEffect(() => {
    setLoading(true);
    fetch(`${BASE}/repeat-order-candidates?inactiveDays=${inactiveDays}&limit=50`, {
      headers: { "x-admin-api-key": import.meta.env.VITE_ADMIN_API_KEY ?? "" },
    })
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [inactiveDays]);

  const stats = data?.stats;
  const candidates = (data?.candidates ?? []) as Candidate[];

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-400">Inactive since:</span>
        {[30, 60, 90, 180].map((d) => (
          <button
            key={d}
            onClick={() => setInactiveDays(d)}
            className={`rounded px-2.5 py-1 text-xs font-medium ${inactiveDays === d ? "bg-violet-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Repeat Customers", value: stats.totalRepeatCustomers.toLocaleString(), color: "text-violet-400" },
            { label: "Avg Days Between Orders", value: stats.avgDaysBetweenOrders.toFixed(0), color: "text-gray-300" },
            { label: "Repeat Rate", value: `${stats.repeatRate}%`, color: "text-emerald-400" },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl bg-gray-900 p-3 ring-1 ring-gray-800">
              <p className="text-xs text-gray-500">{kpi.label}</p>
              <p className={`mt-0.5 text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
            </div>
          ))}
        </div>
      )}

      {loading && <div className="text-gray-400 py-6 text-center text-sm">Loading…</div>}

      {!loading && candidates.length > 0 && (
        <div className="rounded-xl bg-gray-900 ring-1 ring-gray-800">
          <table className="w-full text-xs text-gray-300">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500">
                <th className="px-4 py-2 text-left">Customer ID</th>
                <th className="px-4 py-2 text-left">Last Service</th>
                <th className="px-4 py-2 text-center">Trigger</th>
                <th className="px-4 py-2 text-right">Days Inactive</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.customerProfileId} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-2">{c.customerProfileId}</td>
                  <td className="px-4 py-2">{c.lastCompletedServiceName ?? "—"}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${TRIGGER_COLORS[c.triggerType]}`}>
                      {c.triggerType}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">{c.daysSinceLastOrder}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && candidates.length === 0 && (
        <div className="rounded-xl bg-gray-900 p-8 text-center ring-1 ring-gray-800">
          <p className="text-sm text-gray-500">No repeat-order candidates in this window.</p>
        </div>
      )}
    </div>
  );
}
