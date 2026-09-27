import { useEffect, useRef, useState, type DetailedHTMLProps, type HTMLAttributes } from "react";
import { Box, Rotate3D, ZoomIn, Eye, EyeOff, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DesignScene } from "@/lib/ai-design-core";
import { hasReal3DAsset } from "@/lib/ai-design-core";

interface Props {
  scene: DesignScene;
  onSelectObject?: (id: string) => void;
  onSceneChange?: (scene: DesignScene) => void;
}

type ModelViewerElement = HTMLElement & {
  cameraOrbit?: string;
  jumpCameraToGoal?: () => void;
};

type Local3dJob = {
  jobId: number;
  status: string;
  error?: string | null;
  assets?: {
    glbUrl: string;
    previewUrl: string;
    blendUrl: string;
  } | null;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        "camera-controls"?: boolean;
        "touch-action"?: string;
        "auto-rotate"?: boolean;
        "shadow-intensity"?: string;
        "data-ai-design-model"?: string;
      };
    }
  }
}

const CAMERA_ORBITS = {
  front: "0deg 75deg auto",
  side: "90deg 75deg auto",
  back: "180deg 75deg auto",
} as const;

const API_KEY = import.meta.env.VITE_ADMIN_API_KEY ?? "";

function authHeaders(json = false): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(API_KEY ? { "x-admin-api-key": API_KEY } : {}),
  };
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      ...authHeaders(Boolean(init?.body)),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json() as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep HTTP fallback.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

async function authorizedAssetUrl(url: string, signal: AbortSignal): Promise<string> {
  if (!url.startsWith("/api/")) return url;
  const response = await fetch(url, {
    credentials: "include",
    headers: authHeaders(false),
    signal,
  });
  if (!response.ok) throw new Error(`Gagal memuat asset 3D (HTTP ${response.status})`);
  return URL.createObjectURL(await response.blob());
}

export function Design3DViewer({ scene, onSelectObject, onSceneChange }: Props) {
  const [preset, setPreset] = useState<keyof typeof CAMERA_ORBITS>("front");
  const [generatedScene, setGeneratedScene] = useState<DesignScene | null>(null);
  const [generationStatus, setGenerationStatus] = useState<"idle" | "queued" | "running" | "failed">("idle");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [runtimeReady, setRuntimeReady] = useState(
    () => typeof customElements !== "undefined" && Boolean(customElements.get("model-viewer")),
  );
  const [runtimeError, setRuntimeError] = useState(false);
  const [resolvedModelUrl, setResolvedModelUrl] = useState<string | null>(null);
  const [resolvedPreviewUrl, setResolvedPreviewUrl] = useState<string | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);

  const effectiveScene = generatedScene ?? scene;
  const real3d = hasReal3DAsset(effectiveScene);
  const modelUrl = effectiveScene.asset?.glbUrl ?? effectiveScene.asset?.gltfUrl;
  const previewUrl = effectiveScene.asset?.previewUrl;

  useEffect(() => {
    setGeneratedScene(null);
    setGenerationError(null);
    setGenerationStatus("idle");
    generationAbortRef.current?.abort();
  }, [scene.id, scene.version]);

  useEffect(() => {
    if (!real3d || runtimeReady || runtimeError) return;
    const existing = document.querySelector<HTMLScriptElement>('script[data-ai-design-model-viewer="true"]');
    const markReady = () => setRuntimeReady(Boolean(customElements.get("model-viewer")));
    const markError = () => setRuntimeError(true);

    if (existing) {
      existing.addEventListener("load", markReady);
      existing.addEventListener("error", markError);
      return () => {
        existing.removeEventListener("load", markReady);
        existing.removeEventListener("error", markError);
      };
    }

    const script = document.createElement("script");
    script.type = "module";
    script.src = "https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js";
    script.dataset.aiDesignModelViewer = "true";
    script.addEventListener("load", markReady);
    script.addEventListener("error", markError);
    document.head.appendChild(script);

    return () => {
      script.removeEventListener("load", markReady);
      script.removeEventListener("error", markError);
    };
  }, [real3d, runtimeReady, runtimeError]);

  useEffect(() => {
    if (!modelUrl) {
      setResolvedModelUrl(null);
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void authorizedAssetUrl(modelUrl, controller.signal)
      .then((url) => {
        objectUrl = url.startsWith("blob:") ? url : null;
        setResolvedModelUrl(url);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setRuntimeError(true);
          setGenerationError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [modelUrl]);

  useEffect(() => {
    if (!previewUrl) {
      setResolvedPreviewUrl(null);
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void authorizedAssetUrl(previewUrl, controller.signal)
      .then((url) => {
        objectUrl = url.startsWith("blob:") ? url : null;
        setResolvedPreviewUrl(url);
      })
      .catch(() => {
        if (!controller.signal.aborted) setResolvedPreviewUrl(null);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewUrl]);

  useEffect(() => () => generationAbortRef.current?.abort(), []);

  const selectPreset = (next: keyof typeof CAMERA_ORBITS) => {
    setPreset(next);
    const viewer = document.querySelector<ModelViewerElement>('[data-ai-design-model="true"]');
    if (!viewer) return;
    viewer.cameraOrbit = CAMERA_ORBITS[next];
    viewer.jumpCameraToGoal?.();
  };

  const generateLocal3d = async () => {
    generationAbortRef.current?.abort();
    const controller = new AbortController();
    generationAbortRef.current = controller;
    setGenerationError(null);
    setGenerationStatus("queued");

    try {
      const queued = await apiJson<{ jobId: number; pollUrl?: string }>("/api/ai/local-3d/test-scene", {
        method: "POST",
        body: JSON.stringify({
          sceneType: effectiveScene.domain === "fashion" ? "fashion" : "interior",
          width: 768,
          height: 768,
        }),
        signal: controller.signal,
      });

      const pollUrl = queued.pollUrl ?? `/api/ai/local-3d/jobs/${queued.jobId}`;
      for (let attempt = 0; attempt < 240; attempt += 1) {
        if (controller.signal.aborted) return;
        const job = await apiJson<Local3dJob>(pollUrl, { signal: controller.signal });

        if (job.status === "completed" && job.assets?.glbUrl) {
          const nextScene: DesignScene = {
            ...effectiveScene,
            version: effectiveScene.version + 1,
            asset: {
              mode: "real-3d",
              glbUrl: job.assets.glbUrl,
              previewUrl: job.assets.previewUrl,
              provider: "blender_local_3d",
            },
          };
          setGeneratedScene(nextScene);
          setGenerationStatus("idle");
          onSceneChange?.(nextScene);
          return;
        }

        if (["failed", "cancelled", "blocked"].includes(job.status)) {
          throw new Error(job.error || `3D job berhenti dengan status ${job.status}`);
        }

        setGenerationStatus(job.status === "running" ? "running" : "queued");
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(resolve, 1500);
          controller.signal.addEventListener("abort", () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      }

      throw new Error("3D job belum selesai dalam batas polling viewer.");
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      setGenerationStatus("failed");
      setGenerationError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="rounded-xl border bg-card overflow-hidden" data-testid="design-3d-viewer">
      <div className="flex items-center justify-between gap-2 p-3 border-b">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Box className="h-4 w-4" />
          {real3d ? "3D 360°" : "Preview 2D"}
        </div>
        <div className="flex gap-1">
          {(["front", "side", "back"] as const).map((view) => (
            <Button
              key={view}
              size="sm"
              variant={preset === view ? "default" : "outline"}
              disabled={!real3d || !runtimeReady || !resolvedModelUrl}
              onClick={() => selectPreset(view)}
            >
              {view === "front" ? "Depan" : view === "side" ? "Samping" : "Belakang"}
            </Button>
          ))}
        </div>
      </div>

      {real3d && resolvedModelUrl && runtimeReady ? (
        <div className="min-h-96 bg-muted/20 relative">
          <model-viewer
            data-ai-design-model="true"
            src={resolvedModelUrl}
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
      ) : real3d && !runtimeError ? (
        <div className="min-h-80 grid place-items-center">
          <div className="text-center">
            <Loader2 className="h-7 w-7 animate-spin mx-auto" />
            <p className="text-sm mt-2">Menyiapkan viewer dan asset 3D…</p>
          </div>
        </div>
      ) : (
        <div className="min-h-80 grid place-items-center p-8 text-center">
          <div>
            {resolvedPreviewUrl ? (
              <img src={resolvedPreviewUrl} alt="2D design preview" className="max-h-72 mx-auto rounded-lg" />
            ) : (
              <Box className="h-16 w-16 mx-auto text-muted-foreground" />
            )}
            <p className="mt-4 font-medium">
              {runtimeError && real3d ? "Viewer 3D gagal dimuat" : "Asset 3D belum tersedia"}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              {runtimeError && real3d
                ? "Asset GLB tersedia, tetapi runtime viewer gagal dimuat."
                : "Generate GLB nyata dengan Blender lokal. Viewer tidak membuat rotasi 360° palsu dari satu gambar."}
            </p>

            {!real3d && (
              <Button
                className="mt-4"
                onClick={() => void generateLocal3d()}
                disabled={generationStatus === "queued" || generationStatus === "running"}
              >
                {generationStatus === "queued" || generationStatus === "running" ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{generationStatus === "running" ? "Merender 3D…" : "Menunggu worker…"}</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" />Generate 3D Lokal</>
                )}
              </Button>
            )}

            {generationError && (
              <div className="mt-3 text-xs text-destructive flex items-center justify-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                {generationError}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="border-t p-3 flex flex-wrap gap-2">
        {effectiveScene.objects.map((object) => (
          <Button
            key={object.id}
            size="sm"
            variant="outline"
            disabled={object.locked}
            onClick={() => onSelectObject?.(object.id)}
          >
            {object.visible === false
              ? <EyeOff className="h-3.5 w-3.5 mr-1" />
              : <Eye className="h-3.5 w-3.5 mr-1" />}
            {object.name}
            {object.quantity && object.quantity > 1 ? ` ×${object.quantity}` : ""}
          </Button>
        ))}
      </div>
    </section>
  );
}
