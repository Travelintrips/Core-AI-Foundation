/**
 * AI Platform Admin — Product Concept Management
 *
 * Admin interface for managing product concept designs:
 * - Browse all concepts with status filters
 * - View concept detail (form, material, CMF, features, labels)
 * - Trigger mockup composition
 * - Generate manufacturer brief
 * - Archive concepts
 *
 * Route (registered by Team 24): /admin/product-design
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Package,
  Layers,
  Palette,
  Tag,
  FileText,
  Plus,
  RefreshCw,
  Eye,
  Archive,
  CheckCircle,
  Clock,
  AlertTriangle,
  Image,
  ChevronDown,
  ChevronUp,
  Cpu,
  Ruler,
} from "lucide-react";

// ── Type shims ─────────────────────────────────────────────────────────────────

type ConceptStatus = "draft" | "in_review" | "approved" | "archived";

interface CMFEntry {
  colorCode:  string;
  colorName:  string;
  material:   string;
  finish:     string;
  zone:       string;
}

interface ProductConceptFull {
  id:         string;
  name:       string;
  projectId:  string;
  status:     ConceptStatus;
  version:    number;
  disclaimer: string;
  updatedAt:  string;
  formDirection: {
    category:       string;
    dimensions:     { height: number; width: number; depth?: number; fillVolumeMl?: number };
    shapeNotes?:    string;
    ergonomicNotes?: string;
  };
  materialDirection: {
    primaryMaterial:     string;
    secondaryMaterial?:  string;
    sustainabilityNotes?: string;
    compatibilityNotes?:  string;
  };
  cmf: {
    entries:     CMFEntry[];
    isComplete:  boolean;
    processNotes?: string;
  };
  featurePlacements: Array<{ id: string; label: string; anchor: string; footprintMm: { width: number; height: number } }>;
  labelAreas: Array<{ id: string; name: string; anchor: string; printAreaMm: { width: number; height: number }; safeMarginMm: number }>;
}

// ── API helper ─────────────────────────────────────────────────────────────────

const API_BASE = "/api/ai/product-design";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = (window as Record<string, unknown>)["__ADMIN_API_KEY__"] as string | undefined;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "x-admin-api-key": apiKey } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body["error"] as string) ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Status UI helpers ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ConceptStatus, { label: string; icon: React.ComponentType<{ className?: string }>; badge: string }> = {
  draft:     { label: "Draft",      icon: Clock,       badge: "bg-slate-100 text-slate-600" },
  in_review: { label: "In Review",  icon: Eye,         badge: "bg-amber-100 text-amber-700" },
  approved:  { label: "Approved",   icon: CheckCircle, badge: "bg-emerald-100 text-emerald-700" },
  archived:  { label: "Archived",   icon: Archive,     badge: "bg-slate-100 text-slate-400" },
};

function StatusBadge({ status }: { status: ConceptStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cfg.badge}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ── Color Swatch ───────────────────────────────────────────────────────────────

function ColorSwatch({ code, name }: { code: string; name: string }) {
  const isHex = code.startsWith("#");
  return (
    <div className="flex items-center gap-2 text-xs">
      {isHex ? (
        <span
          className="inline-block h-4 w-4 rounded-full border border-slate-200 shrink-0"
          style={{ backgroundColor: code }}
        />
      ) : (
        <span className="inline-block h-4 w-4 rounded-full border border-slate-200 bg-slate-100 shrink-0 text-center leading-4 text-[8px] font-bold">P</span>
      )}
      <span className="text-slate-700">{name}</span>
      <span className="text-slate-400 font-mono">{code}</span>
    </div>
  );
}

// ── Expandable Section ────────────────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-slate-400" />
          {title}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

// ── Concept Detail Panel ───────────────────────────────────────────────────────

function ConceptDetailPanel({
  concept,
  onRefresh,
  onArchive,
}: {
  concept: ProductConceptFull;
  onRefresh: () => void;
  onArchive: (id: string) => Promise<void>;
}) {
  const [composing, setComposing] = useState(false);
  const [composeMsg, setComposeMsg] = useState<string | null>(null);
  const [briefing, setBriefing]     = useState(false);
  const [briefMsg, setBriefMsg]     = useState<string | null>(null);
  const [archiving, setArchiving]   = useState(false);

  async function handleCompose() {
    setComposing(true);
    setComposeMsg(null);
    try {
      const res = await apiFetch<{ mockup: { id: string } }>("/mockups", {
        method: "POST",
        body: JSON.stringify({ conceptId: concept.id, viewAngle: "front", widthPx: 800, heightPx: 1200, format: "png" }),
      });
      setComposeMsg(`✓ Mockup composed (id: ${res.mockup.id})`);
    } catch (e: unknown) {
      setComposeMsg(`Error: ${(e as Error).message}`);
    } finally {
      setComposing(false);
    }
  }

  async function handleGenerateBrief() {
    setBriefing(true);
    setBriefMsg(null);
    try {
      const res = await apiFetch<{ brief: { id: string } }>("/manufacturer/brief", {
        method: "POST",
        body: JSON.stringify({ conceptId: concept.id }),
      });
      setBriefMsg(`✓ Brief generated (id: ${res.brief.id})`);
    } catch (e: unknown) {
      setBriefMsg(`Error: ${(e as Error).message}`);
    } finally {
      setBriefing(false);
    }
  }

  async function handleArchive() {
    setArchiving(true);
    try {
      await onArchive(concept.id);
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{concept.name}</h2>
          <p className="text-xs text-slate-500">v{concept.version} · {concept.projectId}</p>
        </div>
        <StatusBadge status={concept.status} />
      </div>

      {/* Disclaimer */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
        <p className="leading-relaxed">{concept.disclaimer}</p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleCompose}
          disabled={composing}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <Image className="h-3.5 w-3.5" />
          {composing ? "Composing…" : "Compose Mockup"}
        </button>
        <button
          type="button"
          onClick={handleGenerateBrief}
          disabled={briefing}
          className="inline-flex items-center gap-1.5 rounded-md bg-white border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <FileText className="h-3.5 w-3.5" />
          {briefing ? "Generating…" : "Generate Brief"}
        </button>
        {concept.status !== "archived" && (
          <button
            type="button"
            onClick={handleArchive}
            disabled={archiving}
            className="inline-flex items-center gap-1.5 rounded-md bg-white border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <Archive className="h-3.5 w-3.5" />
            {archiving ? "Archiving…" : "Archive"}
          </button>
        )}
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 rounded-md bg-white border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {(composeMsg || briefMsg) && (
        <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700 space-y-1">
          {composeMsg && <p>{composeMsg}</p>}
          {briefMsg && <p>{briefMsg}</p>}
        </div>
      )}

      {/* Form Direction */}
      <Section title="Form Direction" icon={Cpu}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Category</p>
            <p className="font-medium capitalize">{concept.formDirection.category}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Dimensions</p>
            <p className="font-medium font-mono text-xs">
              H {concept.formDirection.dimensions.height} × W {concept.formDirection.dimensions.width} mm
              {concept.formDirection.dimensions.depth ? ` × D ${concept.formDirection.dimensions.depth}` : ""}
            </p>
          </div>
          {concept.formDirection.dimensions.fillVolumeMl && (
            <div className="col-span-2">
              <p className="text-xs text-slate-400 mb-0.5">Fill Volume</p>
              <p className="font-medium">{concept.formDirection.dimensions.fillVolumeMl} mL</p>
            </div>
          )}
          {concept.formDirection.shapeNotes && (
            <div className="col-span-2">
              <p className="text-xs text-slate-400 mb-0.5">Shape Notes</p>
              <p className="text-slate-700">{concept.formDirection.shapeNotes}</p>
            </div>
          )}
        </div>
      </Section>

      {/* Material */}
      <Section title="Material Direction" icon={Layers}>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Primary</span>
            <span className="font-medium capitalize">{concept.materialDirection.primaryMaterial.replace(/_/g, " ")}</span>
          </div>
          {concept.materialDirection.secondaryMaterial && (
            <div className="flex justify-between">
              <span className="text-slate-500">Secondary</span>
              <span className="font-medium capitalize">{concept.materialDirection.secondaryMaterial.replace(/_/g, " ")}</span>
            </div>
          )}
          {concept.materialDirection.compatibilityNotes && (
            <p className="text-xs text-slate-500 italic">{concept.materialDirection.compatibilityNotes}</p>
          )}
        </div>
      </Section>

      {/* CMF */}
      <Section title={`CMF (${concept.cmf.entries.length} zones)`} icon={Palette}>
        <div className="space-y-2">
          {concept.cmf.entries.map((e, i) => (
            <div key={i} className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400 capitalize">{e.zone} · {e.finish}</p>
                <ColorSwatch code={e.colorCode} name={e.colorName} />
              </div>
              <span className="text-xs text-slate-400 capitalize">{e.material.replace(/_/g, " ")}</span>
            </div>
          ))}
          {!concept.cmf.isComplete && (
            <p className="text-xs text-amber-600 mt-1">⚠ CMF specification is incomplete.</p>
          )}
        </div>
      </Section>

      {/* Features */}
      {concept.featurePlacements.length > 0 && (
        <Section title={`Features (${concept.featurePlacements.length})`} icon={Cpu} defaultOpen={false}>
          <div className="space-y-2">
            {concept.featurePlacements.map((fp) => (
              <div key={fp.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{fp.label}</span>
                <span className="text-xs text-slate-400">{fp.anchor} · {fp.footprintMm.width}×{fp.footprintMm.height} mm</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Label Areas */}
      {concept.labelAreas.length > 0 && (
        <Section title={`Label Areas (${concept.labelAreas.length})`} icon={Tag} defaultOpen={false}>
          <div className="space-y-2">
            {concept.labelAreas.map((la) => (
              <div key={la.id} className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700">{la.name}</span>
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <Ruler className="h-3 w-3" />
                    {la.printAreaMm.width}×{la.printAreaMm.height} mm
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  {la.anchor} · safe margin {la.safeMarginMm} mm
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AdminProductDesignPage() {
  const [concepts, setConcepts]   = useState<ProductConceptFull[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [selected, setSelected]   = useState<ProductConceptFull | null>(null);
  const [statusFilter, setStatusFilter] = useState<ConceptStatus | "all">("all");

  const fetchConcepts = useCallback(() => {
    setLoading(true);
    apiFetch<{ concepts: ProductConceptFull[] }>("/concepts")
      .then((d) => {
        setConcepts(d.concepts ?? []);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchConcepts(); }, [fetchConcepts]);

  const filtered = statusFilter === "all"
    ? concepts
    : concepts.filter((c) => c.status === statusFilter);

  async function handleArchive(id: string) {
    await apiFetch(`/concepts/${id}`, { method: "DELETE" });
    fetchConcepts();
    setSelected(null);
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Left: concept list */}
      <div className="w-80 shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-4 border-b border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-slate-700" />
              <h1 className="text-sm font-semibold text-slate-900">Product Concepts</h1>
            </div>
            <button
              type="button"
              onClick={fetchConcepts}
              className="rounded-md p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50"
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* Status filter */}
          <div className="flex gap-1 flex-wrap">
            {(["all", "draft", "in_review", "approved", "archived"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                  statusFilter === s
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {s === "all" ? "All" : STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          )}
          {error && (
            <div className="p-4 text-xs text-red-600">{error}</div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="p-6 text-center text-xs text-slate-400">No concepts found.</div>
          )}
          {!loading && !error && filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                selected?.id === c.id ? "bg-slate-50 border-l-2 border-l-slate-900" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5 capitalize">
                    {c.formDirection.category} · {c.materialDirection.primaryMaterial.replace(/_/g, " ")}
                  </p>
                </div>
                <StatusBadge status={c.status} />
              </div>
            </button>
          ))}
        </div>

        {/* Footer: quick stats */}
        <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-400">
          {concepts.length} concept{concepts.length !== 1 ? "s" : ""} total
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <ConceptDetailPanel
            key={selected.id}
            concept={selected}
            onRefresh={fetchConcepts}
            onArchive={handleArchive}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-slate-400">
              <Package className="mx-auto mb-3 h-12 w-12" />
              <p className="text-sm">Select a concept to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
