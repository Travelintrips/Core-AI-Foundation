import { useState } from "react";
import { Box, Rotate3D, ZoomIn, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DesignScene } from "@/lib/ai-design-core";
import { hasReal3DAsset } from "@/lib/ai-design-core";

interface Props {
  scene: DesignScene;
  onSelectObject?: (id: string) => void;
}

export function Design3DViewer({ scene, onSelectObject }: Props) {
  const [preset, setPreset] = useState<"front" | "side" | "back">("front");
  const real3d = hasReal3DAsset(scene);
  const url = scene.asset?.glbUrl ?? scene.asset?.gltfUrl;

  return (
    <section className="rounded-xl border bg-card overflow-hidden" data-testid="design-3d-viewer">
      <div className="flex items-center justify-between gap-2 p-3 border-b">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Box className="h-4 w-4" />
          {real3d ? "3D 360°" : "Preview 2D"}
        </div>
        <div className="flex gap-1">
          {(["front", "side", "back"] as const).map(v => (
            <Button key={v} size="sm" variant={preset === v ? "default" : "outline"} onClick={() => setPreset(v)}>
              {v === "front" ? "Depan" : v === "side" ? "Samping" : "Belakang"}
            </Button>
          ))}
        </div>
      </div>

      {real3d && url ? (
        <div className="min-h-96 bg-muted/20 relative">
          {/* model-viewer is loaded by the host when 3D capability is enabled. */}
          {/*
            @ts-expect-error custom element supplied by @google/model-viewer runtime
          */}
          <model-viewer
            src={url}
            camera-controls
            touch-action="pan-y"
            auto-rotate
            shadow-intensity="1"
            style={{ width: "100%", height: "28rem" }}
            aria-label="Interactive 3D design"
          />
          <div className="absolute bottom-3 left-3 flex gap-2 text-xs bg-background/80 rounded-md px-2 py-1">
            <Rotate3D className="h-4 w-4" /> drag untuk putar
            <ZoomIn className="h-4 w-4 ml-2" /> pinch/scroll untuk zoom
          </div>
        </div>
      ) : (
        <div className="min-h-80 grid place-items-center p-8 text-center">
          <div>
            {scene.asset?.previewUrl ? <img src={scene.asset.previewUrl} alt="2D design preview" className="max-h-72 mx-auto rounded-lg" /> : <Box className="h-16 w-16 mx-auto text-muted-foreground" />}
            <p className="mt-4 font-medium">Asset 3D belum tersedia</p>
            <p className="text-sm text-muted-foreground mt-1">Tidak membuat rotasi 360° palsu dari satu gambar. Hubungkan provider 3D untuk GLB/GLTF.</p>
          </div>
        </div>
      )}

      <div className="border-t p-3 flex flex-wrap gap-2">
        {scene.objects.map(o => (
          <Button key={o.id} size="sm" variant="outline" disabled={o.locked} onClick={() => onSelectObject?.(o.id)}>
            {o.visible === false ? <EyeOff className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
            {o.name}{o.quantity && o.quantity > 1 ? ` ×${o.quantity}` : ""}
          </Button>
        ))}
      </div>
    </section>
  );
}
