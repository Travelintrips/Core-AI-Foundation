/**
 * Team 17 — Interior Design Planning — Admin project detail
 * Shows project info, brief, validation, outputs + "Generate" button.
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Home, Palette, Layers, Lightbulb, ShoppingBag, Shield,
  Sparkles, Loader2, CheckCircle, AlertTriangle, RefreshCw, Sofa, Edit, LayoutTemplate,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { PlacementCanvas, type CanvasPlacement, type ConstraintEvaluation, type PlacementCandidate } from "@/components/interior-design/PlacementCanvas";

const API_BASE = "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "x-admin-api-key": key } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json() as { error?: string | { message?: string } };
      if (typeof b?.error === "string") msg = b.error;
      else if (b?.error?.message) msg = b.error.message;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

interface Project {
  id: number;
  title: string;
  roomType: string;
  status: string;
  clientName?: string | null;
  clientEmail?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Brief {
  roomLengthM: string;
  roomWidthM: string;
  ceilingHeightM: string;
  style: string;
  primaryColors: string[];
  secondaryColors: string[];
  furnitureNeeds: string[];
  budgetNotes?: string | null;
  additionalNotes?: string | null;
  photoUrls: string[];
  floorPlanUrl?: string | null;
}

interface Output {
  id: number;
  moodboard?: { palette?: string[]; moodWords?: string[]; styleDescription?: string; lightingMood?: string } | null;
  spacePlan?: { zones?: Array<{ id: string; label: string; purpose: string }>; notes?: string } | null;
  furniturePlacement?: Array<{ item: string; widthM: number; depthM: number; xM?: number; yM?: number; rotation?: number; note: string }> | null;
  circulationAnalysis?: string | null;
  materialRecommendations?: Record<string, Record<string, string>> | null;
  lightingRecommendations?: Record<string, Record<string, string>> | null;
  visualConcept?: string | null;
  vendorCategories?: Array<{ category: string; why: string }> | null;
  validationResults?: {
    dimensionWarnings?: string[];
    clearanceWarnings?: string[];
    circulationWarnings?: string[];
    passedChecks?: string[];
  } | null;
  safetyDisclaimers?: string[];
  aiModelUsed?: string | null;
  generationDurationMs?: number | null;
  isLatest: boolean;
  createdAt: string;
}

interface ProjectDetail {
  project: Project;
  brief: Brief | null;
  output: Output | null;
  outputCount: number;
}

interface LayoutSession {
  id: string;
  name: string;
  status: string;
  widthCm: string | number;
  depthCm: string | number;
  metadata?: Record<string, unknown>;
}

interface LayoutPlacement extends CanvasPlacement {
  furnitureItemId?: string | null;
}

const ROOM_LABELS: Record<string, string> = {
  living_room: "Ruang Tamu", bedroom: "Kamar Tidur", kitchen: "Dapur",
  office: "Kantor", cafe: "Kafe", restaurant: "Restoran",
  hotel: "Hotel", lobby: "Lobi", booth: "Booth",
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "#6B7280" },
  brief_submitted: { label: "Brief Masuk", color: "#7C6EFA" },
  analyzing: { label: "Menganalisis...", color: "#F59E0B" },
  outputs_ready: { label: "Konsep Siap", color: "#10B981" },
  revision_requested: { label: "Revisi Diminta", color: "#F97316" },
  completed: { label: "Selesai", color: "#10B981" },
};

const SECTION_COLORS: Record<string, string> = {
  flooring: "#92400E", walls: "#1D4ED8", ceiling: "#4B5563",
  textiles: "#7C3AED", ambient: "#F59E0B", task: "#3B82F6",
  accent: "#EC4899", natural: "#10B981",
};

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium mt-0.5">{value}</p>
    </div>
  );
}

export default function InteriorDesignDetailPage({ params }: { params: { id: string } }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [candidateList, setCandidateList] = useState<PlacementCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [canvasDirty, setCanvasDirty] = useState(false);
  const [constraintEvaluation, setConstraintEvaluation] = useState<ConstraintEvaluation | null>(null);

  const projectId = params.id;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["interior-design-project", projectId],
    queryFn: () => apiFetch<ProjectDetail>(`/api/ai/interior-design/projects/${projectId}`),
    refetchInterval: (query) =>
      query.state.data?.project.status === "analyzing" ? 5000 : false,
  });

  const { data: sessionList, isLoading: sessionLoading } = useQuery({
    queryKey: ["placement-sessions", projectId],
    queryFn: () => apiFetch<{ data: LayoutSession[] }>(`/api/ai/layout-sessions?pageSize=100`),
  });

  const canvasSession = sessionList?.data.find((session) => session.metadata?.["interiorProjectId"] === Number(projectId));

  const { data: placementData, isLoading: placementsLoading } = useQuery({
    queryKey: ["placement-session-placements", canvasSession?.id],
    queryFn: () => apiFetch<{ data: LayoutPlacement[] }>(`/api/ai/layout-sessions/${canvasSession!.id}/placements`),
    enabled: Boolean(canvasSession?.id),
  });

  const createCanvasMutation = useMutation({
    mutationFn: async () => {
      if (!brief) throw new Error("Brief belum tersedia.");
      const session = await apiFetch<LayoutSession>("/api/ai/layout-sessions", {
        method: "POST",
        body: JSON.stringify({
          name: `Interior ${project.title}`,
          widthCm: Number(brief.roomLengthM) * 100,
          depthCm: Number(brief.roomWidthM) * 100,
          heightCm: Number(brief.ceilingHeightM) * 100,
          metadata: { interiorProjectId: Number(projectId), roomType: project.roomType },
        }),
      });
      const furniture = output?.furniturePlacement ?? [];
      await Promise.all(furniture.map((item, index) => apiFetch(`/api/ai/layout-sessions/${session.id}/placements`, {
        method: "POST",
        body: JSON.stringify({
          label: item.item,
          xCm: (item.xM ?? 0.25 + index * 0.15) * 100,
          yCm: (item.yM ?? 0.25 + index * 0.15) * 100,
          widthCm: Math.max(1, item.widthM * 100),
          depthCm: Math.max(1, item.depthM * 100),
          rotationDeg: item.rotation ?? 0,
          metadata: { source: "interior-design-output" },
        }),
      })));
      return session;
    },
    onSuccess: () => {
      toast({ title: "Canvas placement siap" });
      void qc.invalidateQueries({ queryKey: ["placement-sessions", projectId] });
    },
    onError: (e: Error) => toast({ title: "Gagal membuat canvas", description: e.message, variant: "destructive" }),
  });

  const suggestMutation = useMutation({
    mutationFn: (input: { placements: CanvasPlacement[]; targetPlacementId: string }) =>
      apiFetch<{ sessionId: string; candidates: PlacementCandidate[] }>(
        `/api/ai/layout-sessions/${canvasSession!.id}/suggest-placement`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: (result) => {
      setCandidateList(result.candidates);
      setSelectedCandidateId(result.candidates.find((candidate) => candidate.valid)?.candidateId ?? null);
      setCanvasDirty(true);
      toast({ title: "Alternatif placement tersedia", description: `${result.candidates.length} kandidat dihitung secara deterministik.` });
    },
    onError: (e: Error) => toast({ title: "Suggest gagal", description: e.message, variant: "destructive" }),
  });

  const applyMutation = useMutation({
    mutationFn: (candidateId: string) =>
      apiFetch<LayoutPlacement>(`/api/ai/layout-sessions/${canvasSession!.id}/apply-placement`, {
        method: "POST",
        body: JSON.stringify({ candidateId }),
      }),
    onSuccess: () => {
      setCandidateList([]);
      setSelectedCandidateId(null);
      setCanvasDirty(false);
      toast({ title: "Placement diterapkan", description: "Layout tersimpan dan canvas diperbarui." });
      void qc.invalidateQueries({ queryKey: ["placement-session-placements", canvasSession?.id] });
      void qc.invalidateQueries({ queryKey: ["placement-sessions", projectId] });
    },
    onError: (e: Error) => toast({ title: "Apply gagal", description: e.message, variant: "destructive" }),
  });

  const evaluateMutation = useMutation({
    mutationFn: () =>
      apiFetch<ConstraintEvaluation>(
        `/api/ai/layout-sessions/${canvasSession!.id}/constraints/evaluate`,
        { method: "POST", body: JSON.stringify({}) },
      ),
    onSuccess: (result) => {
      setConstraintEvaluation(result);
      toast({
        title: result.valid ? "Layout valid" : "Layout perlu diperbaiki",
        description: `Skor deterministik ${result.totalScore.toFixed(1)} · ${result.hardViolations.length} hard violation`,
      });
    },
    onError: (e: Error) => toast({ title: "Evaluasi gagal", description: e.message, variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: () => apiFetch(`/api/ai/interior-design/projects/${projectId}/generate`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Konsep berhasil dibuat!", description: "Output desain interior siap diulas." });
      void qc.invalidateQueries({ queryKey: ["interior-design-project", projectId] });
    },
    onError: (e: Error) => toast({ title: "Gagal generate", description: e.message, variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) =>
      apiFetch(`/api/ai/interior-design/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      toast({ title: "Status diperbarui" });
      setStatusDialogOpen(false);
      void qc.invalidateQueries({ queryKey: ["interior-design-project", projectId] });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 text-center">
        <p className="text-destructive text-sm">{(error as Error)?.message ?? "Proyek tidak ditemukan"}</p>
        <Link href="/interior-design">
          <Button variant="outline" size="sm" className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Kembali
          </Button>
        </Link>
      </div>
    );
  }

  const { project, brief, output, outputCount } = data;
  const statusConf = STATUS_CONFIG[project.status] ?? { label: project.status, color: "#6B7280" };
  const allWarnings = [
    ...(output?.validationResults?.dimensionWarnings ?? []),
    ...(output?.validationResults?.clearanceWarnings ?? []),
    ...(output?.validationResults?.circulationWarnings ?? []),
  ];
  const canGenerate = !!brief && !["completed"].includes(project.status) && !generateMutation.isPending;
  const canvasPlacements = placementData?.data ?? [];
  const canvasReadOnly = canvasSession?.metadata?.["approvedForRendering"] === true;

  useEffect(() => {
    if (!canvasSession) {
      setCandidateList([]);
      setConstraintEvaluation(null);
    }
  }, [canvasSession]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <Link href="/interior-design" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3 transition-colors">
            <ArrowLeft className="w-3 h-3" />
            Interior Design
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" }}>
              <Home className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">{project.title}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground">
                  #{project.id} · {ROOM_LABELS[project.roomType] ?? project.roomType}
                  {project.clientName && ` · ${project.clientName}`}
                </span>
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{ background: `${statusConf.color}20`, color: statusConf.color, border: `1px solid ${statusConf.color}30` }}
                >
                  {statusConf.label}
                </span>
                {project.status === "analyzing" && <RefreshCw className="w-3 h-3 animate-spin text-amber-400" />}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setNewStatus(project.status); setStatusDialogOpen(true); }}>
            <Edit className="w-3.5 h-3.5 mr-1" />
            Status
          </Button>
          {canGenerate && (
            <Button
              size="sm"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" }}
            >
              {generateMutation.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Generating...</>
              ) : (
                <><Sparkles className="w-3.5 h-3.5 mr-1" />{outputCount > 0 ? "Regenerate" : "Generate Konsep"}</>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Brief section */}
      {brief ? (
        <div className="rounded-xl p-5 mb-5 border" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Home className="w-4 h-4 text-muted-foreground" />
            Brief Detail
          </h2>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <InfoChip label="Panjang" value={`${brief.roomLengthM} m`} />
            <InfoChip label="Lebar" value={`${brief.roomWidthM} m`} />
            <InfoChip label="Tinggi Plafon" value={`${brief.ceilingHeightM} m`} />
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <InfoChip label="Gaya" value={brief.style} />
            <InfoChip label="Luas" value={`${(parseFloat(brief.roomLengthM) * parseFloat(brief.roomWidthM)).toFixed(1)} m²`} />
            <InfoChip label="Furnitur" value={`${brief.furnitureNeeds.length} item`} />
          </div>
          {brief.primaryColors.length > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-muted-foreground">Warna:</span>
              {brief.primaryColors.map((c, i) => (
                <div key={i} className="w-5 h-5 rounded-full border" style={{ background: c, borderColor: "rgba(255,255,255,0.2)" }} title={c} />
              ))}
            </div>
          )}
          {brief.furnitureNeeds.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {brief.furnitureNeeds.map((item, i) => (
                <span key={i} className="px-2 py-0.5 rounded-full text-xs" style={{ background: "rgba(124,110,250,0.1)", color: "#7C6EFA", border: "1px solid rgba(124,110,250,0.2)" }}>
                  {item}
                </span>
              ))}
            </div>
          )}
          {brief.budgetNotes && (
            <p className="text-xs text-muted-foreground mt-2">💰 {brief.budgetNotes}</p>
          )}
          {brief.additionalNotes && (
            <p className="text-xs text-muted-foreground mt-1">📝 {brief.additionalNotes}</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl p-5 mb-5 border text-center" style={{ borderColor: "rgba(255,200,0,0.15)", background: "rgba(255,200,0,0.04)" }}>
          <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-amber-400" />
          <p className="text-sm text-amber-400">Belum ada brief untuk proyek ini.</p>
          <p className="text-xs text-muted-foreground mt-1">Klien harus mengisi brief melalui portal sebelum konsep bisa digenerate.</p>
        </div>
      )}

      {/* No output yet */}
      {!output && brief && (
        <div className="rounded-xl p-8 text-center border" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <Sparkles className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
          <p className="text-sm text-muted-foreground mb-1">Belum ada output.</p>
          <p className="text-xs text-muted-foreground mb-4">Klik "Generate Konsep" untuk membuat moodboard, space plan, rekomendasi, dan lainnya.</p>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" }}
          >
            {generateMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Generating...</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-1.5" />Generate Konsep</>
            )}
          </Button>
        </div>
      )}

      {/* Output sections */}
      {output && (
        <div className="space-y-4">
          <section className="rounded-xl border border-violet-300/20 bg-violet-400/5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-violet-400/15 p-2 text-violet-200"><LayoutTemplate className="h-5 w-5" /></div>
                <div>
                  <h2 className="text-sm font-semibold">Furniture Placement Workspace</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Atur preview secara lokal, minta alternatif deterministik, lalu simpan hanya kandidat yang dipilih.
                  </p>
                </div>
              </div>
              {!canvasSession && (
                <Button
                  size="sm"
                  onClick={() => createCanvasMutation.mutate()}
                  disabled={createCanvasMutation.isPending || sessionLoading}
                >
                  {createCanvasMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LayoutTemplate className="h-3.5 w-3.5" />}
                  {createCanvasMutation.isPending ? "Menyiapkan..." : "Buat Canvas"}
                </Button>
              )}
            </div>
          </section>

          {canvasSession && !placementsLoading && (
            <PlacementCanvas
              room={{ widthCm: Number(canvasSession.widthCm), depthCm: Number(canvasSession.depthCm) }}
              placements={canvasPlacements}
              candidates={candidateList}
              selectedCandidateId={selectedCandidateId}
              isSuggesting={suggestMutation.isPending}
              isApplying={applyMutation.isPending}
              readOnly={canvasReadOnly}
              dirty={canvasDirty}
              onSuggest={(placements, targetPlacementId) => suggestMutation.mutate({ placements, targetPlacementId })}
              onSelectCandidate={setSelectedCandidateId}
              onApply={(candidateId) => applyMutation.mutate(candidateId)}
              onReset={() => {
                setCandidateList([]);
                setSelectedCandidateId(null);
                setCanvasDirty(false);
                setConstraintEvaluation(null);
              }}
              constraintEvaluation={constraintEvaluation}
              isEvaluating={evaluateMutation.isPending}
              onEvaluate={() => evaluateMutation.mutate()}
            />
          )}

          {/* Meta */}
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-muted-foreground">
              Output #{output.id} · {output.aiModelUsed ?? "model tidak diketahui"}
              {output.generationDurationMs && ` · ${(output.generationDurationMs / 1000).toFixed(1)}s`}
              · {outputCount} total generasi
            </p>
            <Badge variant="outline">{output.isLatest ? "Terbaru" : "Lama"}</Badge>
          </div>

          {/* Validation warnings */}
          {allWarnings.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <p className="text-sm font-medium text-amber-400">Peringatan Validasi ({allWarnings.length})</p>
              </div>
              <ul className="space-y-1">
                {allWarnings.map((w, i) => (
                  <li key={i} className="text-xs text-amber-600">• {w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Moodboard */}
          {output.moodboard && (
            <div className="rounded-xl p-5 border" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Palette className="w-4 h-4 text-muted-foreground" />Moodboard
              </h3>
              {output.moodboard.palette && (
                <div className="flex gap-1.5 mb-3">
                  {output.moodboard.palette.map((c, i) => (
                    <div key={i} className="flex-1 h-8 rounded-lg border" style={{ background: c, borderColor: "rgba(255,255,255,0.1)" }} title={c} />
                  ))}
                </div>
              )}
              {output.moodboard.moodWords && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {output.moodboard.moodWords.map((w, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-full text-xs" style={{ background: "rgba(124,110,250,0.1)", color: "#7C6EFA" }}>
                      {w}
                    </span>
                  ))}
                </div>
              )}
              {output.moodboard.styleDescription && (
                <p className="text-xs text-muted-foreground">{output.moodboard.styleDescription}</p>
              )}
            </div>
          )}

          {/* Visual Concept */}
          {output.visualConcept && (
            <div className="rounded-xl p-5 border" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Layers className="w-4 h-4 text-muted-foreground" />Konsep Visual
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{output.visualConcept}</p>
            </div>
          )}

          {/* Space plan zones */}
          {output.spacePlan?.zones && (
            <div className="rounded-xl p-5 border" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Home className="w-4 h-4 text-muted-foreground" />Rencana Ruang
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {output.spacePlan.zones.map((z) => (
                  <div key={z.id} className="p-2.5 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <p className="text-xs font-medium">{z.label}</p>
                    <p className="text-xs text-muted-foreground">{z.purpose}</p>
                  </div>
                ))}
              </div>
              {output.spacePlan.notes && <p className="text-xs text-muted-foreground mt-2">{output.spacePlan.notes}</p>}
            </div>
          )}

          {/* Furniture */}
          {output.furniturePlacement && output.furniturePlacement.length > 0 && (
            <div className="rounded-xl p-5 border" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Sofa className="w-4 h-4 text-muted-foreground" />Penempatan Furnitur
              </h3>
              <div className="space-y-2">
                {output.furniturePlacement.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b last:border-0" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                    <span className="font-medium">{item.item}</span>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <span className="font-mono">{item.widthM}×{item.depthM}m</span>
                      <span>{item.note}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Circulation */}
          {output.circulationAnalysis && (
            <div className="rounded-xl p-5 border" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-muted-foreground" />Analisis Sirkulasi
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{output.circulationAnalysis}</p>
            </div>
          )}

          {/* Materials + Lighting side by side */}
          <div className="grid grid-cols-2 gap-4">
            {output.materialRecommendations && (
              <div className="rounded-xl p-5 border" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-muted-foreground" />Material
                </h3>
                {Object.entries(output.materialRecommendations).map(([key, val]) => (
                  <div key={key} className="mb-2">
                    <p className="text-xs font-medium capitalize mb-0.5" style={{ color: SECTION_COLORS[key] ?? "#7C6EFA" }}>{key}</p>
                    {Object.entries(val).slice(0, 2).map(([k, v]) => (
                      <p key={k} className="text-xs text-muted-foreground">{k}: {v}</p>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {output.lightingRecommendations && (
              <div className="rounded-xl p-5 border" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-muted-foreground" />Pencahayaan
                </h3>
                {Object.entries(output.lightingRecommendations).map(([key, val]) => (
                  <div key={key} className="mb-2">
                    <p className="text-xs font-medium capitalize mb-0.5" style={{ color: SECTION_COLORS[key] ?? "#F59E0B" }}>{key}</p>
                    {Object.entries(val).slice(0, 2).map(([k, v]) => (
                      <p key={k} className="text-xs text-muted-foreground">{k}: {v}</p>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Vendor categories */}
          {output.vendorCategories && output.vendorCategories.length > 0 && (
            <div className="rounded-xl p-5 border" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-muted-foreground" />Kategori Vendor
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {output.vendorCategories.map((v, i) => (
                  <div key={i} className="p-2.5 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <p className="text-xs font-medium">{v.category}</p>
                    <p className="text-xs text-muted-foreground">{v.why}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Passed checks */}
          {(output.validationResults?.passedChecks?.length ?? 0) > 0 && (
            <div className="rounded-xl p-5 border" style={{ borderColor: "rgba(16,185,129,0.15)", background: "rgba(16,185,129,0.05)" }}>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2 text-green-400">
                <CheckCircle className="w-4 h-4" />Validasi Lulus
              </h3>
              <ul className="space-y-1">
                {output.validationResults!.passedChecks!.map((c, i) => (
                  <li key={i} className="text-xs text-green-600 flex items-center gap-1.5">
                    <CheckCircle className="w-3 h-3" />{c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Disclaimers */}
          {(output.safetyDisclaimers?.length ?? 0) > 0 && (
            <div className="rounded-xl p-5 border" style={{ borderColor: "rgba(245,158,11,0.15)", background: "rgba(245,158,11,0.05)" }}>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2 text-amber-400">
                <Shield className="w-4 h-4" />Disclaimer
              </h3>
              <ul className="space-y-1.5">
                {output.safetyDisclaimers!.map((d, i) => (
                  <li key={i} className="text-xs text-amber-700 dark:text-amber-500">{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Status update dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Status Proyek</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="mb-2 block">Status baru</Label>
            <select
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value)}
              className="w-full px-3 py-2 rounded-md border bg-background"
            >
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>Batal</Button>
            <Button
              onClick={() => updateStatusMutation.mutate(newStatus)}
              disabled={updateStatusMutation.isPending}
            >
              {updateStatusMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
