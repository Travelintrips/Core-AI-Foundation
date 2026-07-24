/**
 * artifacts/ai-platform/src/pages/graphic-design/index.tsx — Team 15
 *
 * Admin panel for the Graphic Design domain.
 * Provides brief management, status updates, QC result review,
 * approval + dispatch controls, and a service/blueprint reference.
 *
 * Route: /admin/graphic-design
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BriefSummary {
  id:          string;
  serviceCode: string;
  status:      GdStatus;
  packageTier: string;
  brandName:   string;
  clientName:  string;
  createdAt:   string;
  updatedAt:   string;
  jobCount:    number;
}

type GdStatus =
  | "draft" | "pending_review" | "approved" | "in_production"
  | "qc_check" | "qc_failed" | "revision_requested" | "completed" | "cancelled";

interface ListResult { items: BriefSummary[]; total: number; page: number; pageSize: number; }
interface QcResult { qcScore: number; passed: boolean; warnings: string[]; failures: string[]; checks: QcCheck[]; }
interface QcCheck  { checkName: string; score: number; weight: number; passed: boolean; warnings: string[]; failures: string[]; }

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_URL = import.meta.env.BASE_URL ?? "/admin/";


function apiUrl(path: string): string {
  return `/api${path}`;
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Admin-Key": ADMIN_KEY, ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function formatIdr(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Status styling ────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<GdStatus, string> = {
  draft:               "bg-gray-100 text-gray-600",
  pending_review:      "bg-yellow-100 text-yellow-800",
  approved:            "bg-blue-100 text-blue-800",
  in_production:       "bg-indigo-100 text-indigo-700",
  qc_check:            "bg-cyan-100 text-cyan-800",
  qc_failed:           "bg-red-100 text-red-700",
  revision_requested:  "bg-orange-100 text-orange-800",
  completed:           "bg-green-100 text-green-800",
  cancelled:           "bg-gray-100 text-gray-500 line-through",
};

const STATUS_LABELS: Record<GdStatus, string> = {
  draft:               "Draft",
  pending_review:      "Pending Review",
  approved:            "Approved",
  in_production:       "In Production",
  qc_check:            "QC Check",
  qc_failed:           "QC Failed",
  revision_requested:  "Revision Requested",
  completed:           "Completed",
  cancelled:           "Cancelled",
};

const TERMINAL: GdStatus[] = ["completed", "cancelled"];

const NEXT_ACTIONS: Partial<Record<GdStatus, GdStatus[]>> = {
  pending_review:      ["approved", "revision_requested", "cancelled"],
  approved:            ["in_production", "cancelled"],
  in_production:       ["qc_check", "qc_failed"],
  qc_check:            ["completed", "revision_requested"],
  qc_failed:           ["revision_requested", "in_production"],
  revision_requested:  ["approved", "cancelled"],
};

const SERVICE_LABELS: Record<string, string> = {
  "GD-LOGO":       "Logo Concept",
  "GD-BCARD":      "Business Card",
  "GD-LTRHEAD":    "Letterhead",
  "GD-FLYER":      "Flyer",
  "GD-POSTER":     "Poster",
  "GD-BANNER":     "Banner",
  "GD-BROCHURE":   "Brochure",
  "GD-SOCIAL":     "Social Media Kit",
  "GD-CERT":       "Certificate",
  "GD-STATIONERY": "Stationery Suite",
};

// ── QC Score bar ──────────────────────────────────────────────────────────────

function QcScoreBar({ score, passed }: { score: number; passed: boolean }) {
  const color = passed ? "bg-green-500" : score >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 rounded-full h-2">
        <div className={`h-2 rounded-full ${color} transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-sm font-bold ${passed ? "text-green-700" : "text-red-700"}`}>{score}</span>
      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${passed ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>
        {passed ? "PASS" : "FAIL"}
      </span>
    </div>
  );
}

// ── Brief row ─────────────────────────────────────────────────────────────────

function BriefRow({ brief, onSelect }: { brief: BriefSummary; onSelect: (b: BriefSummary) => void }) {
  return (
    <tr
      className="hover:bg-blue-50 cursor-pointer transition-colors"
      onClick={() => onSelect(brief)}
    >
      <td className="px-4 py-3 font-mono text-xs text-gray-500">{brief.id.slice(0, 8)}…</td>
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900 text-sm">{brief.brandName}</div>
        <div className="text-xs text-gray-400">{brief.clientName}</div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">{SERVICE_LABELS[brief.serviceCode] ?? brief.serviceCode}</td>
      <td className="px-4 py-3">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[brief.status]}`}>
          {STATUS_LABELS[brief.status]}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-gray-500 capitalize">{brief.packageTier}</td>
      <td className="px-4 py-3 text-xs text-gray-400">{formatDate(brief.createdAt)}</td>
      <td className="px-4 py-3 text-center text-xs text-gray-500">{brief.jobCount}</td>
    </tr>
  );
}

// ── Brief detail panel ────────────────────────────────────────────────────────

function BriefDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();

  const { data: brief, isLoading } = useQuery({
    queryKey: ["gd-brief", id],
    queryFn: () => apiFetch<Record<string, unknown>>(apiUrl(`/ai/graphic-design/briefs/${id}`)),
  });

  const { data: qcResult } = useQuery<QcResult | null>({
    queryKey: ["gd-qc", id],
    queryFn: () =>
      apiFetch<QcResult>(apiUrl(`/ai/graphic-design/briefs/${id}/qc`)).catch(() => null),
  });

  const statusMutation = useMutation({
    mutationFn: ({ status, note }: { status: GdStatus; note?: string }) =>
      apiFetch(apiUrl(`/ai/graphic-design/briefs/${id}/status`), {
        method: "PATCH",
        body: JSON.stringify({ status, note }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["gd-briefs"] }); qc.invalidateQueries({ queryKey: ["gd-brief", id] }); },
  });

  const approveMutation = useMutation({
    mutationFn: () => apiFetch<{ jobIds: string[]; conceptCount: number }>(apiUrl(`/ai/graphic-design/briefs/${id}/approve`), { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["gd-briefs"] }); qc.invalidateQueries({ queryKey: ["gd-brief", id] }); },
  });

  if (isLoading) return <div className="p-6 text-gray-500 text-sm animate-pulse">Loading…</div>;
  if (!brief) return <div className="p-6 text-red-500 text-sm">Not found.</div>;

  const status = brief["status"] as GdStatus;
  const nextActions = NEXT_ACTIONS[status] ?? [];
  const isTerminal = TERMINAL.includes(status);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
        <div>
          <h2 className="font-semibold text-gray-900">{String(brief["brandName"])}</h2>
          <p className="text-xs text-gray-400 font-mono">{id}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Status */}
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[status]}`}>
            {STATUS_LABELS[status]}
          </span>
          <span className="text-xs text-gray-400">· {SERVICE_LABELS[String(brief["serviceCode"])] ?? brief["serviceCode"]}</span>
          <span className="text-xs text-gray-400 capitalize">· {String(brief["packageTier"])}</span>
        </div>

        {/* QC result */}
        {qcResult && (
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">QC Result</h3>
            <QcScoreBar score={qcResult.qcScore} passed={qcResult.passed} />
            {qcResult.failures.length > 0 && (
              <ul className="mt-3 space-y-1">
                {qcResult.failures.map((f, i) => (
                  <li key={i} className="text-xs text-red-600 flex gap-1.5">
                    <span>✗</span><span>{f}</span>
                  </li>
                ))}
              </ul>
            )}
            {qcResult.warnings.length > 0 && (
              <ul className="mt-2 space-y-1">
                {qcResult.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-yellow-700 flex gap-1.5">
                    <span>⚠</span><span>{w}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Approve + dispatch */}
        {(status === "pending_review" || status === "approved") && !isTerminal && (
          <div>
            <button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
              className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {approveMutation.isPending ? "Dispatching…" : "✓ Approve & Dispatch Jobs"}
            </button>
            {approveMutation.data && (
              <p className="text-xs text-green-700 mt-1">
                Dispatched {approveMutation.data.conceptCount} concept job{approveMutation.data.conceptCount > 1 ? "s" : ""}.
              </p>
            )}
            {approveMutation.error && (
              <p className="text-xs text-red-600 mt-1">{(approveMutation.error as Error).message}</p>
            )}
          </div>
        )}

        {/* Status transitions */}
        {nextActions.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Update Status</h3>
            <div className="flex flex-wrap gap-2">
              {nextActions.map((s) => (
                <button
                  key={s}
                  onClick={() => statusMutation.mutate({ status: s })}
                  disabled={statusMutation.isPending}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50 transition-colors"
                >
                  → {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Brief JSON */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Brief Data</h3>
          <pre className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs overflow-x-auto text-gray-700">
            {JSON.stringify(brief["brief"] ?? brief, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type FilterStatus = GdStatus | "all";

export default function AdminGraphicDesignPage() {
  const [page, setPage]             = useState(1);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [filterService, setFilterService] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<ListResult>({
    queryKey: ["gd-briefs", page, filterStatus, filterService],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterService !== "all") params.set("serviceCode", filterService);
      return apiFetch(apiUrl(`/ai/graphic-design/briefs?${params}`));
    },
  });

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Left panel — list */}
      <div className={`flex flex-col ${selectedId ? "w-1/2" : "w-full"} transition-all`}>
        {/* Toolbar */}
        <div className="bg-white border-b border-gray-200 px-5 py-4 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 mr-auto">
            <span className="text-xl">🎨</span>
            <h1 className="font-bold text-gray-900 text-lg">Graphic Design</h1>
            {data && <span className="text-xs text-gray-400">{data.total} briefs</span>}
          </div>

          <select
            value={filterService}
            onChange={(e) => { setFilterService(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700"
          >
            <option value="all">All Services</option>
            {Object.entries(SERVICE_LABELS).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value as FilterStatus); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700"
          >
            <option value="all">All Statuses</option>
            {(["pending_review","approved","in_production","qc_check","qc_failed","completed","cancelled"] as GdStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 sticky top-0 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">ID</th>
                <th className="px-4 py-3 text-left">Brand</th>
                <th className="px-4 py-3 text-left">Service</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Tier</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-center">Jobs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm animate-pulse">
                    Loading briefs…
                  </td>
                </tr>
              )}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">
                    No graphic design briefs yet.
                  </td>
                </tr>
              )}
              {data?.items.map((b) => (
                <BriefRow
                  key={b.id}
                  brief={b}
                  onSelect={(br) => setSelectedId(br.id)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total > data.pageSize && (
          <div className="bg-white border-t border-gray-200 px-5 py-3 flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="text-sm text-blue-600 hover:underline disabled:text-gray-300"
            >
              ← Prev
            </button>
            <span className="text-xs text-gray-500">
              Page {page} of {Math.ceil(data.total / data.pageSize)}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= Math.ceil(data.total / data.pageSize)}
              className="text-sm text-blue-600 hover:underline disabled:text-gray-300"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Right panel — detail */}
      {selectedId && (
        <div className="w-1/2 bg-white border-l border-gray-200 overflow-hidden">
          <BriefDetail id={selectedId} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  );
}
