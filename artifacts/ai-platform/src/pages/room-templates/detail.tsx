/**
 * WP-01 — Admin: Room Template Detail / Edit / Create
 *
 * Handles:
 * - View template metadata
 * - Edit draft/published template
 * - Publish / archive / restore / duplicate actions
 * - Version history display
 * - Create new template (/room-templates/new)
 */
import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LayoutTemplate, ArrowLeft, Save, CheckCircle, Archive,
  RefreshCw, Copy, Loader2, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),
      ...(ADMIN_KEY ? { "x-admin-api-key": ADMIN_KEY } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const b = await res.json() as { error?: { message?: string } | string }; msg = typeof b.error === "string" ? b.error : (b.error?.message ?? msg); } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

interface RoomTemplate {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  roomTypeId: string;
  styleId: string | null;
  dimensions: { widthCm: number; depthCm: number; heightCm: number };
  fixedElements: unknown[];
  previewImageUrl: string | null;
  thumbnailUrl: string | null;
  tags: string[];
  status: string;
  version: number;
  tenantId: string | null;
  createdBy: string;
  publishedAt: string | null;
  archivedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface RoomType { id: string; code: string; label: string; labelId: string; icon: string; }
interface RoomStyle { id: string; name: string; slug: string; status: string; }

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800",
  published: "bg-green-100 text-green-800",
  archived: "bg-gray-100 text-gray-700",
};

export default function RoomTemplateDetailPage() {
  const [, params] = useRoute("/room-templates/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isNew = params?.id === "new";
  const templateId = isNew ? null : (params?.id ?? null);

  // Form state
  const [form, setForm] = useState({
    name: "", description: "", roomTypeId: "", styleId: "",
    widthCm: 400, depthCm: 500, heightCm: 270,
    tagsRaw: "", previewImageUrl: "", thumbnailUrl: "",
  });

  const { data: template, isLoading } = useQuery<RoomTemplate>({
    queryKey: ["room-template", templateId],
    queryFn: () => apiFetch(`/api/ai/room-templates/${templateId}`),
    enabled: !!templateId,
  });

  const { data: roomTypes } = useQuery<{ data: RoomType[] }>({
    queryKey: ["room-types"],
    queryFn: () => apiFetch("/api/ai/room-types"),
    staleTime: 300_000,
  });

  const { data: roomStyles } = useQuery<{ data: RoomStyle[] }>({
    queryKey: ["room-styles", { status: "active" }],
    queryFn: () => apiFetch("/api/ai/room-styles?status=active"),
    staleTime: 300_000,
  });

  useEffect(() => {
    if (template) {
      setForm({
        name:           template.name,
        description:    template.description ?? "",
        roomTypeId:     template.roomTypeId,
        styleId:        template.styleId ?? "",
        widthCm:        template.dimensions.widthCm,
        depthCm:        template.dimensions.depthCm,
        heightCm:       template.dimensions.heightCm,
        tagsRaw:        template.tags.join(", "),
        previewImageUrl: template.previewImageUrl ?? "",
        thumbnailUrl:   template.thumbnailUrl ?? "",
      });
    }
  }, [template]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["room-template", templateId] });
    queryClient.invalidateQueries({ queryKey: ["room-templates"] });
  };

  const createMut = useMutation({
    mutationFn: (body: object) => apiFetch<{ id: string }>("/api/ai/room-templates", {
      method: "POST", body: JSON.stringify(body),
    }),
    onSuccess: (r) => { toast({ title: "Template created" }); navigate(`/room-templates/${r.id}`); },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: (body: object) => apiFetch(`/api/ai/room-templates/${templateId}`, {
      method: "PATCH", body: JSON.stringify(body),
    }),
    onSuccess: () => { toast({ title: "Template saved" }); invalidate(); },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const publishMut = useMutation({
    mutationFn: () => apiFetch(`/api/ai/room-templates/${templateId}/publish`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Template published" }); invalidate(); },
    onError: (e: Error) => toast({ title: "Publish failed", description: e.message, variant: "destructive" }),
  });

  const archiveMut = useMutation({
    mutationFn: () => apiFetch(`/api/ai/room-templates/${templateId}/archive`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Template archived" }); invalidate(); },
    onError: (e: Error) => toast({ title: "Archive failed", description: e.message, variant: "destructive" }),
  });

  const restoreMut = useMutation({
    mutationFn: () => apiFetch(`/api/ai/room-templates/${templateId}/restore`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Template restored" }); invalidate(); },
    onError: (e: Error) => toast({ title: "Restore failed", description: e.message, variant: "destructive" }),
  });

  const duplicateMut = useMutation({
    mutationFn: () => apiFetch<{ id: string }>(`/api/ai/room-templates/${templateId}/duplicate`, { method: "POST" }),
    onSuccess: (r) => { toast({ title: "Duplicated" }); navigate(`/room-templates/${r.id}`); },
    onError: (e: Error) => toast({ title: "Duplicate failed", description: e.message, variant: "destructive" }),
  });

  const handleSave = () => {
    const payload = {
      name: form.name,
      description: form.description || null,
      roomTypeId: form.roomTypeId,
      styleId: form.styleId || null,
      dimensions: { widthCm: form.widthCm, depthCm: form.depthCm, heightCm: form.heightCm },
      tags: form.tagsRaw.split(",").map(t => t.trim()).filter(Boolean),
      previewImageUrl: form.previewImageUrl || null,
      thumbnailUrl: form.thumbnailUrl || null,
    };
    if (isNew) {
      createMut.mutate({ ...payload, _v: "1.0" });
    } else {
      updateMut.mutate(payload);
    }
  };

  const isBusy = createMut.isPending || updateMut.isPending || publishMut.isPending || archiveMut.isPending || restoreMut.isPending;

  if (!isNew && isLoading) {
    return <div className="p-6 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/room-templates")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">{isNew ? "New Room Template" : (template?.name ?? "Room Template")}</h1>
            {template && (
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[template.status] ?? "bg-gray-100"}`}>
                {template.status} · v{template.version}
              </span>
            )}
          </div>
          {template && <p className="text-xs text-muted-foreground font-mono mt-0.5">{template.slug}</p>}
        </div>
        {!isNew && template && (
          <div className="flex gap-2">
            {template.status === "draft" && (
              <Button size="sm" variant="outline" className="text-green-700 border-green-300"
                onClick={() => publishMut.mutate()} disabled={isBusy}>
                <CheckCircle className="h-4 w-4 mr-1" /> Publish
              </Button>
            )}
            {template.status !== "archived" && (
              <Button size="sm" variant="outline" className="text-amber-700 border-amber-300"
                onClick={() => archiveMut.mutate()} disabled={isBusy}>
                <Archive className="h-4 w-4 mr-1" /> Archive
              </Button>
            )}
            {template.status === "archived" && (
              <Button size="sm" variant="outline"
                onClick={() => restoreMut.mutate()} disabled={isBusy}>
                <RefreshCw className="h-4 w-4 mr-1" /> Restore
              </Button>
            )}
            <Button size="sm" variant="outline"
              onClick={() => duplicateMut.mutate()} disabled={isBusy}>
              <Copy className="h-4 w-4 mr-1" /> Duplicate
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main form */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Template Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Name *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Modern Living Room — Standard" className="mt-1" />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description of this template..." rows={3} className="mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Room Type *</Label>
                  <Select value={form.roomTypeId} onValueChange={v => setForm(f => ({ ...f, roomTypeId: v }))}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select room type" />
                    </SelectTrigger>
                    <SelectContent>
                      {(roomTypes?.data ?? []).map(rt => (
                        <SelectItem key={rt.id} value={rt.id}>{rt.icon} {rt.labelId || rt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Style</Label>
                  <Select value={form.styleId || "_none"} onValueChange={v => setForm(f => ({ ...f, styleId: v === "_none" ? "" : v }))}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="No style" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">No style</SelectItem>
                      {(roomStyles?.data ?? []).map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Tags (comma-separated)</Label>
                <Input value={form.tagsRaw} onChange={e => setForm(f => ({ ...f, tagsRaw: e.target.value }))} placeholder="apartment, urban, contemporary" className="mt-1" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Room Dimensions</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
              {(["widthCm", "depthCm", "heightCm"] as const).map(field => (
                <div key={field}>
                  <Label className="capitalize">{field.replace("Cm", " (cm)")}</Label>
                  <Input type="number" value={form[field]} min={50} max={5000}
                    onChange={e => setForm(f => ({ ...f, [field]: Number(e.target.value) }))} className="mt-1" />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Images</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Preview Image URL</Label>
                <Input value={form.previewImageUrl} onChange={e => setForm(f => ({ ...f, previewImageUrl: e.target.value }))} placeholder="https://..." className="mt-1" />
              </div>
              <div>
                <Label>Thumbnail URL</Label>
                <Input value={form.thumbnailUrl} onChange={e => setForm(f => ({ ...f, thumbnailUrl: e.target.value }))} placeholder="https://..." className="mt-1" />
              </div>
            </CardContent>
          </Card>

          <Button onClick={handleSave} disabled={isBusy || !form.name || !form.roomTypeId}>
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {isNew ? "Create Template" : "Save Changes"}
          </Button>
        </div>

        {/* Sidebar — metadata & version history */}
        <div className="space-y-4">
          {template && (
            <Card>
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Info className="h-4 w-4" /> Metadata</CardTitle></CardHeader>
              <CardContent className="text-xs space-y-2 text-muted-foreground">
                <div><span className="font-medium text-foreground">ID:</span> <span className="font-mono break-all">{template.id}</span></div>
                <div><span className="font-medium text-foreground">Scope:</span> {template.tenantId ? "Tenant-scoped" : "Platform-wide"}</div>
                <div><span className="font-medium text-foreground">Created by:</span> {template.createdBy}</div>
                <Separator />
                <div><span className="font-medium text-foreground">Version:</span> {template.version}</div>
                {template.publishedAt && <div><span className="font-medium text-foreground">Published:</span> {new Date(template.publishedAt).toLocaleDateString()}</div>}
                {template.archivedAt && <div><span className="font-medium text-foreground">Archived:</span> {new Date(template.archivedAt).toLocaleDateString()}</div>}
                <Separator />
                <div><span className="font-medium text-foreground">Created:</span> {new Date(template.createdAt).toLocaleDateString()}</div>
                <div><span className="font-medium text-foreground">Updated:</span> {new Date(template.updatedAt).toLocaleDateString()}</div>
              </CardContent>
            </Card>
          )}

          {template && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Version History</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>v{template.version} (current)</span>
                    <Badge variant="outline" className="text-xs">{template.status}</Badge>
                  </div>
                  {template.publishedAt && (
                    <div className="flex justify-between text-green-700">
                      <span>Published</span>
                      <span>{new Date(template.publishedAt).toLocaleDateString()}</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground italic mt-2">
                    Full version history available in WP-10 (Review & Versioning).
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
