import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Brush,
  ImageIcon,
  Layers,
  Loader2,
  RefreshCw,
  Sofa,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiFetch";
import { cn } from "@/lib/utils";

type MoodboardMaterial = {
  id: string;
  name: string;
  category: string | null;
  color: string | null;
  finish: string | null;
  texture: string | null;
  thumbnailUrl: string | null;
  source: "material_library" | "concept_draft";
};

type MoodboardFurniture = {
  id: string;
  name: string;
  type: string | null;
  style: string | null;
  materials: string[];
  colors: string[];
  thumbnailUrl: string | null;
  source: "furniture_library" | "concept_draft";
};

type MoodboardImage = {
  id: string;
  role: "material" | "furniture" | "lighting" | "space_plan" | "concept";
  url: string;
  thumbnailUrl: string | null;
  alt: string;
  source: string;
};

type Moodboard = {
  schemaVersion: "wp08.v1";
  moodboardId: string;
  title: string;
  roomType: string;
  style: string;
  colorPalette: string[];
  palette: {
    colors: string[];
    moodWords: string[];
    style: string;
    source: "brief" | "concept_draft" | "style_default";
  };
  materials: MoodboardMaterial[];
  furniture: MoodboardFurniture[];
  images: MoodboardImage[];
  referenceImages: MoodboardImage[];
  sections: Array<{ id: string; title: string; description: string; itemIds: string[]; imageIds: string[] }>;
  warnings: string[];
  status: "ready";
  metadata: {
    algorithmVersion: string;
    sourceFingerprint: string;
    resourceCounts: { materials: number; furniture: number; images: number; sections: number };
    truncated: boolean;
  };
};

type MoodboardResponse = {
  moodboard: Moodboard | null;
  available: boolean;
  reused?: boolean;
};

interface MoodboardPanelProps {
  projectUuid: string;
  approved?: boolean;
}

function sourceLabel(source: string): string {
  return source === "material_library" || source === "furniture_library" ? "Library" : "Concept";
}

export function MoodboardPanel({ projectUuid, approved = false }: MoodboardPanelProps) {
  const { toast } = useToast();
  const [moodboard, setMoodboard] = useState<Moodboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMoodboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<MoodboardResponse>(
        `/api/ai/interior-design/projects/${encodeURIComponent(projectUuid)}/moodboard`,
      );
      setMoodboard(response.moodboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Moodboard tidak dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [projectUuid]);

  useEffect(() => {
    void loadMoodboard();
  }, [loadMoodboard]);

  const generate = async (force: boolean) => {
    setGenerating(true);
    setError(null);
    try {
      const response = await apiFetch<MoodboardResponse>(
        `/api/ai/interior-design/projects/${encodeURIComponent(projectUuid)}/moodboard/generate`,
        { method: "POST", body: JSON.stringify({ force }) },
      );
      setMoodboard(response.moodboard);
      toast({
        title: response.reused ? "Moodboard dipakai ulang" : "Moodboard berhasil dibuat",
        description: "Referensi berasal dari konsep dan library kanonik.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Moodboard gagal dibuat.";
      setError(message);
      toast({ title: "Moodboard gagal dibuat", description: message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="rounded-lg border border-violet-500/25 bg-violet-500/5 p-4" data-testid="moodboard-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Brush className="size-4 text-violet-300" />
          <div>
            <p className="font-mono text-sm font-semibold">Moodboard Generator</p>
            <p className="text-[10px] text-muted-foreground">
              Structured references from the approved concept and canonical libraries.
            </p>
          </div>
          {moodboard && <Badge variant="outline" className="text-[10px] text-violet-300 border-violet-400/30">WP08.v1</Badge>}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-[10px] font-mono"
            onClick={() => void loadMoodboard()}
            disabled={loading || generating}
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} /> Refresh
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-[10px] font-mono bg-violet-600 hover:bg-violet-500"
            onClick={() => void generate(Boolean(moodboard))}
            disabled={generating || approved}
            title={approved ? "Approved concept is read-only" : undefined}
          >
            {generating ? <Loader2 className="size-3 animate-spin" /> : <Brush className="size-3" />}
            {moodboard ? "Regenerate" : "Generate"}
          </Button>
          {approved && <Badge variant="outline" className="text-[10px] text-emerald-300 border-emerald-400/30">Approved · read-only</Badge>}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground font-mono">
          <Loader2 className="size-4 animate-spin" /> Loading moodboard…
        </div>
      )}

      {!loading && error && (
        <div className="mt-3 flex items-start gap-2 rounded border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-2">
            <p>{error}</p>
            <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => void loadMoodboard()}>
              Try again
            </Button>
          </div>
        </div>
      )}

      {!loading && !error && !moodboard && (
        <div className="mt-3 rounded border border-dashed border-violet-400/25 p-6 text-center">
          <Layers className="mx-auto mb-2 size-6 text-violet-300/70" />
          <p className="text-xs font-medium">Belum ada moodboard</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Generate untuk menyusun palette, material, furniture, dan visual reference.</p>
        </div>
      )}

      {!loading && !error && moodboard && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px]">{moodboard.palette.style}</Badge>
            {moodboard.palette.moodWords.map((word) => (
              <Badge key={word} variant="secondary" className="text-[10px]">{word}</Badge>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1.6fr]">
            <div className="rounded border border-border/40 bg-background/30 p-3">
              <p className="mb-2 text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground">Palette</p>
              <div className="flex flex-wrap gap-2">
                {moodboard.palette.colors.map((color) => (
                  <div key={color} className="flex items-center gap-1.5 text-[10px] font-mono" title={color}>
                    <span className="size-7 rounded border border-white/10 shadow-inner" style={{ backgroundColor: color }} />
                    <span className="text-muted-foreground">{color}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded border border-border/40 bg-background/30 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground"><Layers className="size-3" /> Materials</p>
                <p className="text-xl font-semibold">{moodboard.metadata.resourceCounts.materials}</p>
                <p className="text-[10px] text-muted-foreground">structured references</p>
              </div>
              <div className="rounded border border-border/40 bg-background/30 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground"><Sofa className="size-3" /> Furniture</p>
                <p className="text-xl font-semibold">{moodboard.metadata.resourceCounts.furniture}</p>
                <p className="text-[10px] text-muted-foreground">placement unchanged</p>
              </div>
            </div>
          </div>

          {(moodboard.materials.length > 0 || moodboard.furniture.length > 0) && (
            <div className="grid gap-3 md:grid-cols-2">
              {moodboard.materials.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground">Material direction</p>
                  {moodboard.materials.slice(0, 6).map((material) => (
                    <div key={material.id} className="flex items-center gap-2 rounded border border-border/30 p-2">
                      {material.thumbnailUrl ? <img src={material.thumbnailUrl} alt={material.name} className="size-9 rounded object-cover" /> : <span className="size-9 rounded bg-muted" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{material.name}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{[material.category, material.color, material.finish].filter(Boolean).join(" · ") || material.texture || "Concept reference"}</p>
                      </div>
                      <Badge variant="outline" className="text-[9px]">{sourceLabel(material.source)}</Badge>
                    </div>
                  ))}
                </div>
              )}
              {moodboard.furniture.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground">Furniture direction</p>
                  {moodboard.furniture.slice(0, 6).map((item) => (
                    <div key={item.id} className="flex items-center gap-2 rounded border border-border/30 p-2">
                      {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.name} className="size-9 rounded object-cover" /> : <span className="flex size-9 items-center justify-center rounded bg-muted"><Sofa className="size-4 text-muted-foreground" /></span>}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{item.name}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{[item.type, item.style, ...item.colors].filter(Boolean).join(" · ") || "Concept reference"}</p>
                      </div>
                      <Badge variant="outline" className="text-[9px]">{sourceLabel(item.source)}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {moodboard.images.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground"><ImageIcon className="size-3" /> Visual references</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {moodboard.images.slice(0, 10).map((image) => (
                  <a key={image.id} href={image.url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded border border-border/30 bg-muted/10">
                    <img src={image.thumbnailUrl ?? image.url} alt={image.alt} className="aspect-square w-full object-cover transition-transform group-hover:scale-105" />
                    <span className="block truncate px-1.5 py-1 text-[9px] text-muted-foreground">{image.role}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {moodboard.warnings.length > 0 && (
            <div className="rounded border border-amber-500/25 bg-amber-500/5 p-2.5 text-[10px] text-amber-200">
              <p className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3" /> Generation notes</p>
              <ul className="list-disc space-y-0.5 pl-4">{moodboard.warnings.slice(0, 4).map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}