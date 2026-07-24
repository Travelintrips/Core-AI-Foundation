/**
 * PendingApprovalsPanel.tsx — Team 03
 * Lists and processes pending commercial automation approvals.
 */

import { useState, useEffect, useCallback } from "react";

const BASE = "/api/ai/creative-commercial";

interface Approval {
  id: number;
  customerProfileId: number;
  actionType: string;
  actionPayload: Record<string, unknown>;
  requestedBy: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  issue_bundle_discount: "Bundle Discount",
  issue_recovery_coupon: "Recovery Coupon",
  apply_vip_bundle_price: "VIP Bundle Price",
  issue_repeat_order_discount: "Repeat Order Discount",
};

export default function PendingApprovalsPanel() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${BASE}/approvals`, {

    })
      .then((r) => r.json())
      .then((d) => setApprovals(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: number) => {
    setProcessing(id);
    await fetch(`${BASE}/approvals/${id}/approve`, {
      method: "POST",

      body: JSON.stringify({ approvedBy: "admin" }),
    });
    setProcessing(null);
    load();
  };

  const reject = async (id: number) => {
    setProcessing(id);
    await fetch(`${BASE}/approvals/${id}/reject`, {
      method: "POST",

      body: JSON.stringify({ rejectedBy: "admin", reason: "rejected via dashboard" }),
    });
    setProcessing(null);
    load();
  };

  if (loading) return <div className="text-gray-400 py-8 text-center text-sm">Loading approvals…</div>;

  if (approvals.length === 0) {
    return (
      <div className="rounded-xl bg-gray-900 p-8 text-center ring-1 ring-gray-800">
        <p className="text-sm text-gray-500">No pending approvals. ✓</p>
        <p className="mt-1 text-xs text-gray-600">Financial actions needing manager sign-off will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">{approvals.length} pending approval{approvals.length !== 1 ? "s" : ""}</p>
      {approvals.map((a) => (
        <div key={a.id} className="rounded-xl bg-gray-900 p-4 ring-1 ring-gray-800">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="rounded bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-300 ring-1 ring-amber-700/40">
                  {ACTION_LABELS[a.actionType] ?? a.actionType}
                </span>
                <span className="text-xs text-gray-500">Customer #{a.customerProfileId}</span>
              </div>
              <pre className="mt-1 rounded bg-gray-800 px-3 py-2 text-xs text-gray-300">
                {JSON.stringify(a.actionPayload, null, 2)}
              </pre>
              <p className="text-xs text-gray-500">
                Requested by {a.requestedBy} · Expires {new Date(a.expiresAt).toLocaleString("id-ID")}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                disabled={processing === a.id}
                onClick={() => reject(a.id)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-400 ring-1 ring-gray-700 hover:bg-gray-800 disabled:opacity-50"
              >
                Reject
              </button>
              <button
                disabled={processing === a.id}
                onClick={() => approve(a.id)}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
