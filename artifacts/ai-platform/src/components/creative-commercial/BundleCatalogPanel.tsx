/**
 * BundleCatalogPanel.tsx — Team 03
 */

import { useState, useEffect } from "react";

const BASE = "/api/ai/creative-commercial";

interface BundleItem {
  serviceId: number;
  serviceCode: string;
  serviceName: string;
  unitPrice: number;
}

interface ServiceBundle {
  bundleCode: string;
  bundleName: string;
  description: string;
  items: BundleItem[];
  totalListPrice: number;
  bundlePrice: number;
  savingsAmount: number;
  savingsPercent: number;
  targetSegments: string[];
  requiresApproval: boolean;
}

function formatIDR(v: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v);
}

export default function BundleCatalogPanel() {
  const [bundles, setBundles] = useState<ServiceBundle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${BASE}/bundles`, {

    })
      .then((r) => r.json())
      .then((d) => setBundles(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-400 py-8 text-center text-sm">Loading bundles…</div>;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {bundles.map((b) => (
        <div key={b.bundleCode} className="rounded-xl bg-gray-900 p-5 ring-1 ring-gray-800 flex flex-col gap-3">
          <div className="flex items-start justify-between">
            <h3 className="font-semibold text-white text-sm">{b.bundleName}</h3>
            {b.requiresApproval && (
              <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-amber-700/40 shrink-0">
                Approval Required
              </span>
            )}
          </div>

          <p className="text-xs text-gray-400">{b.description}</p>

          <div className="space-y-1">
            {b.items.map((item) => (
              <div key={item.serviceId} className="flex justify-between text-xs">
                <span className="text-gray-400">{item.serviceName}</span>
                <span className="text-gray-500">{formatIDR(item.unitPrice)}</span>
              </div>
            ))}
          </div>

          <div className="rounded-lg bg-gray-800 p-3 space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>List Price</span>
              <span className="line-through">{formatIDR(b.totalListPrice)}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold">
              <span className="text-emerald-400">Bundle Price</span>
              <span className="text-emerald-400">{formatIDR(b.bundlePrice)}</span>
            </div>
            <div className="flex justify-between text-xs text-violet-400">
              <span>Savings</span>
              <span>{formatIDR(b.savingsAmount)} ({b.savingsPercent}%)</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {b.targetSegments.map((s) => (
              <span key={s} className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400 ring-1 ring-gray-700">
                {s}
              </span>
            ))}
          </div>
        </div>
      ))}

      {bundles.length === 0 && (
        <div className="col-span-full text-center py-8 text-sm text-gray-500">
          No bundles available. Bundle catalog may not be seeded yet.
        </div>
      )}
    </div>
  );
}
