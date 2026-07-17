/**
 * Customer Portal — Product Concept Viewer
 *
 * Allows customers to browse and review product concept designs
 * associated with their project. Read-only — customers cannot edit concepts.
 *
 * Route (registered by Team 24): /product-design
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 *
 * ⚠️  All rendered concepts carry the mandatory disclaimer.
 *     Never suppress the DisclaimerBanner component.
 */

import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Package,
  Layers,
  Palette,
  Tag,
  FileText,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
  Clock,
  Archive,
  Eye,
  Cpu,
} from "lucide-react";

// ── Types (inlined to avoid cross-artifact imports until Team 24 wires API client) ──

type ConceptStatus = "draft" | "in_review" | "approved" | "archived";

interface ConceptSummary {
  id: string;
  name: string;
  projectId: string;
  status: ConceptStatus;
  formCategory: string;
  primaryMaterial: string;
  cmfZoneCount: number;
  disclaimer: string;
  updatedAt: string;
  version: number;
}

// ── Status UI helpers ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  ConceptStatus,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  draft:     { label: "Draft",      icon: Clock,         color: "text-slate-500 bg-slate-100" },
  in_review: { label: "In Review",  icon: Eye,           color: "text-amber-600 bg-amber-50" },
  approved:  { label: "Approved",   icon: CheckCircle,   color: "text-emerald-600 bg-emerald-50" },
  archived:  { label: "Archived",   icon: Archive,       color: "text-slate-400 bg-slate-50" },
};

// ── Disclaimer Banner ──────────────────────────────────────────────────────────

function DisclaimerBanner({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <p className="leading-relaxed">{text}</p>
    </div>
  );
}

// ── Status Badge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ConceptStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cfg.color}`}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ── Concept Card ───────────────────────────────────────────────────────────────

function ConceptCard({
  concept,
  onClick,
}: {
  concept: ConceptSummary;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full text-left rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-slate-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-slate-400"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Package className="h-4 w-4 text-slate-400 shrink-0" />
            <h3 className="font-medium text-slate-900 truncate">{concept.name}</h3>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            v{concept.version} · Updated {new Date(concept.updatedAt).toLocaleDateString()}
          </p>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="flex items-center gap-1 text-slate-600">
              <Cpu className="h-3 w-3 text-slate-400" />
              <span className="truncate capitalize">{concept.formCategory}</span>
            </div>
            <div className="flex items-center gap-1 text-slate-600">
              <Layers className="h-3 w-3 text-slate-400" />
              <span className="truncate capitalize">{concept.primaryMaterial.replace(/_/g, " ")}</span>
            </div>
            <div className="flex items-center gap-1 text-slate-600">
              <Palette className="h-3 w-3 text-slate-400" />
              <span>{concept.cmfZoneCount} CMF zone{concept.cmfZoneCount !== 1 ? "s" : ""}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <StatusBadge status={concept.status} />
          <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
        </div>
      </div>
    </button>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 rounded-full bg-slate-100 p-5">
        <Package className="h-10 w-10 text-slate-400" />
      </div>
      <h3 className="mb-1 text-base font-semibold text-slate-700">No product concepts yet</h3>
      <p className="max-w-xs text-sm text-slate-500">
        Your product concept designs will appear here once your creative team
        has prepared initial directions for your project.
      </p>
    </div>
  );
}

// ── Concept Detail Drawer (simplified) ────────────────────────────────────────

function ConceptDetail({
  concept,
  onClose,
}: {
  concept: ConceptSummary;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <button
        type="button"
        className="flex-1 bg-black/40"
        onClick={onClose}
        aria-label="Close detail panel"
      />

      {/* Panel */}
      <div className="w-full max-w-md overflow-y-auto bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <h2 className="font-semibold text-slate-900 truncate pr-4">{concept.name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:text-slate-700 transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Status */}
          <div className="flex items-center gap-2">
            <StatusBadge status={concept.status} />
            <span className="text-xs text-slate-400">Version {concept.version}</span>
          </div>

          {/* Disclaimer — always rendered */}
          <DisclaimerBanner text={concept.disclaimer} />

          {/* Form + Material */}
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Form &amp; Material
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Form category</span>
                <span className="font-medium capitalize text-slate-800">
                  {concept.formCategory}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Primary material</span>
                <span className="font-medium capitalize text-slate-800">
                  {concept.primaryMaterial.replace(/_/g, " ")}
                </span>
              </div>
            </div>
          </section>

          {/* CMF Zones */}
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Palette className="inline h-3 w-3 mr-1" />
              Color / Material / Finish
            </h3>
            <p className="text-sm text-slate-600">
              {concept.cmfZoneCount} design zone{concept.cmfZoneCount !== 1 ? "s" : ""} defined.
              Full CMF specification is available from your account manager.
            </p>
          </section>

          {/* Action hints */}
          <section className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600 space-y-2">
            <div className="flex items-start gap-2">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>
                To request a manufacturer brief or mockup, contact your Creative AI Studio
                account manager.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <Tag className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>
                Concept variants showing alternative CMF or feature directions are
                available upon request.
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ProductDesignPage() {
  const [, navigate]      = useLocation();
  const [concepts, setConcepts]     = useState<ConceptSummary[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [selected, setSelected]     = useState<ConceptSummary | null>(null);
  const [statusFilter, setStatusFilter] = useState<ConceptStatus | "all">("all");

  // Fetch from API (Team 24 mounts at /api/ai/product-design/concepts)
  useEffect(() => {
    setLoading(true);
    const base = typeof window !== "undefined"
      ? (window as Record<string, unknown>)["__BASE_URL__"] as string ?? ""
      : "";
    fetch(`${base}/api/ai/product-design/concepts`)
      .then((r) => r.json())
      .then((data) => {
        // Map server shape to summary shape
        const mapped: ConceptSummary[] = (data.concepts ?? []).map(
          (c: Record<string, unknown>) => ({
            id:              c["id"] as string,
            name:            c["name"] as string,
            projectId:       c["projectId"] as string,
            status:          c["status"] as ConceptStatus,
            formCategory:    (c["formDirection"] as Record<string, unknown>)?.["category"] as string ?? "custom",
            primaryMaterial: (c["materialDirection"] as Record<string, unknown>)?.["primaryMaterial"] as string ?? "custom",
            cmfZoneCount:    ((c["cmf"] as Record<string, unknown>)?.["entries"] as unknown[] ?? []).length,
            disclaimer:      c["disclaimer"] as string,
            updatedAt:       c["updatedAt"] as string,
            version:         c["version"] as number,
          }),
        );
        setConcepts(mapped);
        setError(null);
      })
      .catch(() => setError("Unable to load product concepts. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  const filtered =
    statusFilter === "all"
      ? concepts
      : concepts.filter((c) => c.status === statusFilter);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-5">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center gap-3 mb-1">
            <div className="rounded-lg bg-slate-900 p-2">
              <Package className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-slate-900">Product Concepts</h1>
          </div>
          <p className="text-sm text-slate-500 pl-11">
            Concept-stage design directions prepared by your creative team.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-6 py-6 space-y-5">
        {/* Status filter */}
        {!loading && !error && concepts.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {(["all", "draft", "in_review", "approved", "archived"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? "bg-slate-900 text-white"
                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {s === "all" ? "All" : STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>
        )}

        {/* States */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && <EmptyState />}

        {!loading && !error && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((c) => (
              <ConceptCard key={c.id} concept={c} onClick={() => setSelected(c)} />
            ))}
          </div>
        )}

        {/* Bottom disclaimer for the entire page */}
        {!loading && !error && concepts.length > 0 && (
          <DisclaimerBanner
            text="All product concepts shown are indicative design directions only and do not constitute engineering specifications, regulatory approvals, or manufacturing commitments."
          />
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <ConceptDetail concept={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
