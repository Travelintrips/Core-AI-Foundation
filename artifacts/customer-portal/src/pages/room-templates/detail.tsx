/**
 * WP-01 — Customer: Room Template Detail
 *
 * Shows template metadata, dimensions, style, tags, and a preview image.
 * Provides a CTA to start a design session (WP-06, not yet implemented).
 */
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, LayoutTemplate, Maximize2, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function publicFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
  previewImageUrl: string | null;
  thumbnailUrl: string | null;
  tags: string[];
  status: string;
  version: number;
  createdAt: string;
}

interface RoomType  { id: string; code: string; label: string; labelId: string; icon: string; }
interface RoomStyle { id: string; name: string; slug: string; }

export default function RoomTemplateDetailPage() {
  const [, params] = useRoute("/room-templates/:id");
  const [, navigate] = useLocation();
  const templateId = params?.id;

  const { data: template, isLoading, isError } = useQuery<RoomTemplate>({
    queryKey: ["room-template-public", templateId],
    queryFn: () => publicFetch(`/api/ai/room-templates/${templateId}`),
    enabled: !!templateId,
  });

  const { data: roomTypes } = useQuery<{ data: RoomType[] }>({
    queryKey: ["room-types-public"],
    queryFn: () => publicFetch("/api/ai/room-types"),
    staleTime: 600_000,
  });

  const { data: roomStyles } = useQuery<{ data: RoomStyle[] }>({
    queryKey: ["room-styles-public"],
    queryFn: () => publicFetch("/api/ai/room-styles?status=active"),
    staleTime: 600_000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !template) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <LayoutTemplate className="h-12 w-12 opacity-30" />
        <p className="text-muted-foreground">Template tidak ditemukan.</p>
        <Button variant="outline" onClick={() => navigate("/room-templates")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Kembali
        </Button>
      </div>
    );
  }

  const typeMap  = Object.fromEntries((roomTypes?.data  ?? []).map(t => [t.id, t]));
  const styleMap = Object.fromEntries((roomStyles?.data ?? []).map(s => [s.id, s]));
  const rt = typeMap[template.roomTypeId];
  const st = template.styleId ? styleMap[template.styleId] : null;

  return (
    <div className="min-h-screen bg-background">
      {/* Preview image */}
      {(template.previewImageUrl || template.thumbnailUrl) ? (
        <div className="aspect-[21/9] max-h-96 overflow-hidden bg-muted">
          <img
            src={template.previewImageUrl ?? template.thumbnailUrl ?? ""}
            alt={template.name}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="aspect-[21/9] max-h-64 bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center">
          <span className="text-8xl opacity-30">{rt?.icon ?? "🏠"}</span>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Back */}
        <Button variant="ghost" size="sm" onClick={() => navigate("/room-templates")} className="mb-4 -ml-2">
          <ArrowLeft className="h-4 w-4 mr-1" /> Kembali ke Katalog
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            <div>
              <div className="flex flex-wrap gap-2 mb-2">
                {rt && <Badge variant="outline">{rt.icon} {rt.labelId || rt.label}</Badge>}
                {st && <Badge variant="secondary"><Palette className="h-3 w-3 mr-1" />{st.name}</Badge>}
              </div>
              <h1 className="text-2xl font-bold">{template.name}</h1>
              {template.description && (
                <p className="text-muted-foreground mt-2 leading-relaxed">{template.description}</p>
              )}
            </div>

            {/* Tags */}
            {template.tags.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2">Tag</h3>
                <div className="flex flex-wrap gap-2">
                  {template.tags.map(tag => (
                    <Badge key={tag} variant="secondary" className="capitalize">{tag}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Dimensions */}
            <Card>
              <CardContent className="pt-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Maximize2 className="h-4 w-4" /> Dimensi Ruangan
                </h3>
                <div className="grid grid-cols-3 gap-4 text-center">
                  {[
                    { label: "Lebar", value: template.dimensions.widthCm },
                    { label: "Kedalaman", value: template.dimensions.depthCm },
                    { label: "Tinggi", value: template.dimensions.heightCm },
                  ].map(d => (
                    <div key={d.label} className="bg-muted rounded-lg p-3">
                      <div className="text-xl font-bold">{d.value}</div>
                      <div className="text-xs text-muted-foreground">{d.label} (cm)</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* CTA Sidebar */}
          <div className="space-y-4">
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="pt-6 space-y-4">
                <h3 className="font-semibold">Mulai Desain Anda</h3>
                <p className="text-sm text-muted-foreground">
                  Gunakan template ini sebagai dasar desain interior ruangan Anda bersama tim desainer kami.
                </p>
                <Button className="w-full" disabled title="Tersedia di Phase 6 WP-06">
                  Mulai Sesi Desain
                </Button>
                <p className="text-xs text-center text-muted-foreground">
                  Fitur ini akan tersedia segera.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4 text-xs space-y-2 text-muted-foreground">
                <div><span className="font-medium text-foreground">Versi:</span> v{template.version}</div>
                <div><span className="font-medium text-foreground">Ditambahkan:</span> {new Date(template.createdAt).toLocaleDateString("id-ID")}</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
