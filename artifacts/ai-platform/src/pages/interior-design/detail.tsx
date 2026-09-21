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
import { Design3DViewer } from "@/components/design-studio/Design3DViewer";
import { interiorOutputToDesignScene } from "@/lib/ai-design-scene-adapters";
import type { DesignScene } from "@/lib/ai-design-core";

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
  const [canonicalScene, setCanonicalScene] = useState<DesignScene | null>(null);

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

  useEffect(() => {
    const currentOutput = data?.output;
    const currentProject = data?.project;
    if (!currentOutput || !currentProject) { setCanonicalScene(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const workspace = await apiFetch<{ id: number }>("/api/ai/design/workspaces/resolve", {
          method: "POST",
          body: JSON.stringify({ sourceType: "interior", sourceId: projectId, name: currentProject.title }),
        });
        try {
          const persisted = await apiFetch<{ scene: DesignScene }>(`/api/ai/design/projects/${workspace.id}/scene`);
          if (!cancelled) setCanonicalScene(persisted.scene);
        } catch {
          const initial = interiorOutputToDesignScene({
            projectId,
            furniturePlacement: currentOutput.furniturePlacement,
            materialRecommendations: currentOutput.materialRecommendations,
            output: currentOutput as unknown as Record<string, unknown>,
          });
          await apiFetch(`/api/ai/design/projects/${workspace.id}/scene`, {
            method: "PUT", body: JSON.stringify({ scene: initial, label: "Initialize interior 3D scene" }),
          });
          if (!cancelled) setCanonicalScene(initial);
        }
      } catch (err) {
        if (!cancelled) toast({ title: "3D workspace gagal dimuat", description: (err as Error).message, variant: "destructive" });
      }
    })();
    return () => { cancelled = true; };
  }, [data?.output, data?.project, projectId, toast]);

  useEffect(() => {
    if (!canvasSession) {
      setCandidateList([]);
      setConstraintEvaluation(null);
    }
  }, [canvasSession]);

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
  const statusCfg = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.draft;
  const canGenerate = !!brief && !["completed"].includes(project.status) && !generateMutation.isPending;
  const canvasPlacements = placementData?.data ?? [];
  const canvasReadOnly = canvasSession?.metadata?.["approvedForRendering"] === true;
  const designScene = canonicalScene ?? (output ? interiorOutputToDesignScene({
    projectId,
    furniturePlacement: output.furniturePlacement,
    materialRecommendations: output.materialRecommendations,
    output: output as unknown as Record<string, unknown>,
  }) : null);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/interior-design")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Kembali
          </Button>
          <div>
            <h1 className="text-xl font-bold">{project.title}</h1>
            <p className="text-sm text-muted-foreground">{ROOM_LABELS[project.roomType] ?? project.roomType}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge style={{ background: `${statusCfg.color}22`, color: statusCfg.color, borderColor: `${statusCfg.color}55` }}>
            {statusCfg.label}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <InfoChip label="Klien" value={project.clientName ?? "—"} />
        <InfoChip label="Ruangan" value={ROOM_LABELS[project.roomType] ?? project.roomType} />
        <InfoChip label="Output" value={`${outputCount} versi`} />
        <InfoChip label="Dibuat" value={new Date(project.createdAt).toLocaleDateString("id-ID")} />
      </div>

      {brief && (
        <div className="rounded-xl border p-5 mb-6" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2"><Home className="w-4 h-4" /> Brief Desain</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setNewStatus(project.status); setStatusDialogOpen(true); }}>
                <Edit className="w-3.5 h-3.5 mr-1" /> Ubah Status
              </Button>
              <Button size="sm" onClick={() => generateMutation.mutate()} disabled={!canGenerate}>
                {generateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                {output ? "Regenerate" : "Generate Konsep"}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <InfoChip label="Ukuran" value={`${brief.roomLengthM} × ${brief.roomWidthM} m`} />
            <InfoChip label="Tinggi Plafon" value={`${brief.ceilingHeightM} m`} />
            <InfoChip label="Gaya" value={brief.style} />
            <InfoChip label="Furniture" value={`${brief.furnitureNeeds?.length ?? 0} item`} />
          </div>
          <div className="flex gap-2 mt-3">
            {brief.primaryColors?.map(c => <div key={c} title={c} className="w-7 h-7 rounded-full border" style={{ background: c }} />)}
          </div>
        </div>
      )}

      {output && (
        <div className="space-y-5">
          {designScene && (
            <Design3DViewer scene={designScene} />
          )}
          {output.moodboard && (
            <div className="rounded-xl border p-5">
              <h2 className="font-semibold flex items-center gap-2 mb-3"><Palette className="w-4 h-4 text-purple-400" /> Moodboard & Palet</h2>
              <p className="text-sm text-muted-foreground mb-3">{output.moodboard.styleDescription}</p>
              <div className="flex gap-2 mb-3">
                {output.moodboard.palette?.map(c => <div key={c} className="w-10 h-10 rounded-lg border" style={{ background: c }} title={c} />)}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {output.moodboard.moodWords?.map(w => <Badge key={w} variant="secondary">{w}</Badge>)}
              </div>
            </div>
          )}

          {output.spacePlan && (
            <div className="rounded-xl border p-5">
              <h2 className="font-semibold flex items-center gap-2 mb-3"><Layers className="w-4 h-4 text-blue-400" /> Space Plan</h2>
              <div className="grid md:grid-cols-2 gap-2">
                {output.spacePlan.zones?.map(z => (
                  <div key={z.id} className="p-3 rounded-lg bg-muted/30">
                    <p className="font-medium text-sm">{z.label}</p>
                    <p className="text-xs text-muted-foreground">{z.purpose}</p>
                  </div>
                ))}
              </div>
              {output.spacePlan.notes && <p className="text-xs text-muted-foreground mt-3">{output.spacePlan.notes}</p>}
            </div>
          )}

          {output.furniturePlacement && output.furniturePlacement.length > 0 && (
            <div className="rounded-xl border p-5">
              <h2 className="font-semibold flex items-center gap-2 mb-3"><Sofa className="w-4 h-4 text-amber-400" /> Furniture Placement</h2>
              <div className="space-y-2">
                {output.furniturePlacement.map((f, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                    <span className="text-sm font-semibold text-muted-foreground w-5">{i + 1}</span>
                    <div>
                      <p className="text-sm font-medium">{f.item} <span className="text-xs text-muted-foreground">({f.widthM} × {f.depthM} m)</span></p>
                      <p className="text-xs text-muted-foreground">{f.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {output.furniturePlacement && output.furniturePlacement.length > 0 && (
            <div className="rounded-xl border p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
                <div>
                  <h2 className="font-semibold flex items-center gap-2"><LayoutTemplate className="w-4 h-4 text-cyan-400" /> Placement Canvas</h2>
                  <p className="text-xs text-muted-foreground mt-1">2D footprint preview + constraint evidence. Rendering 3D/2D final tetap mengikuti workflow Interior Design.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!canvasSession && (
                    <Button size="sm" variant="outline" disabled={createCanvasMutation.isPending || sessionLoading} onClick={() => createCanvasMutation.mutate()}>
                      {createCanvasMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <LayoutTemplate className="w-3.5 h-3.5 mr-1" />}
                      Buat Canvas
                    </Button>
                  )}
                  {canvasSession && (
                    <Button size="sm" variant="outline" disabled={evaluateMutation.isPending || placementsLoading} onClick={() => evaluateMutation.mutate()}>
                      {evaluateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Shield className="w-3.5 h-3.5 mr-1" />}
                      Evaluasi Constraint
                    </Button>
                  )}
                </div>
              </div>

              {canvasSession ? (
                <>
                  <div className="grid gap-3 md:grid-cols-4 mb-4">
                    <InfoChip label="Session" value={canvasSession.name} />
                    <InfoChip label="Status" value={canvasSession.status} />
                    <InfoChip label="Ukuran" value={`${Number(canvasSession.widthCm).toFixed(0)} × ${Number(canvasSession.depthCm).toFixed(0)} cm`} />
                    <InfoChip label="Mode" value={canvasReadOnly ? "Read-only" : "Editable"} />
                  </div>
                  {placementsLoading ? (
                    <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin" /></div>
                  ) : (
                    <PlacementCanvas
                      widthCm={Number(canvasSession.widthCm)}
                      depthCm={Number(canvasSession.depthCm)}
                      placements={canvasPlacements}
                      candidates={candidateList}
                      selectedCandidateId={selectedCandidateId}
                      readOnly={canvasReadOnly}
                      onSelectCandidate={setSelectedCandidateId}
                      onSuggest={(placementId) => suggestMutation.mutate({ placements: canvasPlacements, targetPlacementId: placementId })}
                    />
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
                    <div className="text-xs text-muted-foreground">
                      {canvasDirty ? "Ada candidate placement yang belum diterapkan." : "Canvas sinkron dengan placement tersimpan."}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={!selectedCandidateId || applyMutation.isPending || canvasReadOnly} onClick={() => selectedCandidateId && applyMutation.mutate(selectedCandidateId)}>
                        {applyMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                        Terapkan Candidate
                      </Button>
                    </div>
                  </div>
                  {constraintEvaluation && (
                    <div className="mt-4 p-3 rounded-lg bg-muted/30 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Constraint score</span>
                        <span>{constraintEvaluation.totalScore.toFixed(1)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Hard violation: {constraintEvaluation.hardViolations.length} · Soft penalty: {constraintEvaluation.softPenalties.length}</p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Belum ada placement session untuk project ini. Buat canvas dari furniture placement yang sudah dihasilkan.</p>
              )}
            </div>
          )}

          {output.materialRecommendations && Object.keys(output.materialRecommendations).length > 0 && (
            <div className="rounded-xl border p-5">
              <h2 className="font-semibold flex items-center gap-2 mb-3"><ShoppingBag className="w-4 h-4 text-emerald-400" /> Rekomendasi Material</h2>
              <div className="grid md:grid-cols-2 gap-3">
                {Object.entries(output.materialRecommendations).map(([key, val]) => (
                  <div key={key} className="p-3 rounded-lg bg-muted/30">
                    <p className="text-sm font-medium capitalize mb-1">{key}</p>
                    {Object.entries(val).map(([k, v]) => <p key={k} className="text-xs text-muted-foreground"><span className="capitalize">{k}:</span> {v}</p>)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {output.lightingRecommendations && Object.keys(output.lightingRecommendations).length > 0 && (
            <div className="rounded-xl border p-5">
              <h2 className="font-semibold flex items-center gap-2 mb-3"><Lightbulb className="w-4 h-4 text-yellow-400" /> Lighting</h2>
              <div className="grid md:grid-cols-2 gap-3">
                {Object.entries(output.lightingRecommendations).map(([key, val]) => (
                  <div key={key} className="p-3 rounded-lg bg-muted/30">
                    <p className="text-sm font-medium capitalize mb-1">{key}</p>
                    {Object.entries(val).map(([k, v]) => <p key={k} className="text-xs text-muted-foreground"><span className="capitalize">{k}:</span> {v}</p>)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {output.visualConcept && (
            <div className="rounded-xl border p-5">
              <h2 className="font-semibold flex items-center gap-2 mb-2"><Sparkles className="w-4 h-4 text-pink-400" /> Konsep Visual</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-line">{output.visualConcept}</p>
            </div>
          )}

          {output.validationResults && (
            <div className="rounded-xl border p-5">
              <h2 className="font-semibold flex items-center gap-2 mb-3"><Shield className="w-4 h-4 text-green-400" /> Validasi</h2>
              <div className="space-y-1.5">
                {output.validationResults.passedChecks?.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-green-400"><CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />{c}</div>
                ))}
                {[...(output.validationResults.dimensionWarnings ?? []), ...(output.validationResults.clearanceWarnings ?? []), ...(output.validationResults.circulationWarnings ?? [])].map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-amber-400"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{w}</div>
                ))}
              </div>
            </div>
          )}

          {output.safetyDisclaimers && output.safetyDisclaimers.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <p className="text-xs font-medium text-amber-400 mb-2">⚠️ Disclaimer</p>
              {output.safetyDisclaimers.map((d, i) => <p key={i} className="text-xs text-muted-foreground">• {d}</p>)}
            </div>
          )}

          <p className="text-xs text-muted-foreground text-right">
            Model: {output.aiModelUsed ?? "—"} · {output.generationDurationMs ? `${(output.generationDurationMs / 1000).toFixed(1)}s` : "—"} · {new Date(output.createdAt).toLocaleString("id-ID")}
          </p>
        </div>
      )}

      {!output && brief && (
        <div className="text-center py-16 rounded-xl border border-dashed">
          <Sparkles className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Brief siap. Klik "Generate Konsep" untuk membuat desain.</p>
        </div>
      )}

      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ubah Status Proyek</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Status Baru</Label>
            <select value={newStatus} onChange={e => setNewStatus(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
              {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>Batal</Button>
            <Button onClick={() => updateStatusMutation.mutate(newStatus)} disabled={updateStatusMutation.isPending}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
