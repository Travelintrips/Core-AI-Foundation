import { useMemo, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  Box,
  GripVertical,
  LampCeiling,
  Move,
  Palette,
  RotateCw,
  Ruler,
  Sofa,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { FurnitureItem, LightingItem, MaterialItem } from "./InteriorDesignEditor";

export interface ArrangementPlacement {
  xCm: number;
  yCm: number;
  widthCm: number;
  depthCm: number;
  rotationDeg?: number;
  placed?: boolean;
  surface?: boolean;
  surfaceType?: string;
}

type ItemKind = "material" | "furniture" | "lighting";
type ArrangementItem = MaterialItem | FurnitureItem | LightingItem;

interface RoomArrangementEditorProps {
  materials: MaterialItem[];
  furniture: FurnitureItem[];
  lighting: LightingItem[];
  onMaterialsChange: (items: MaterialItem[]) => void;
  onFurnitureChange: (items: FurnitureItem[]) => void;
  onLightingChange: (items: LightingItem[]) => void;
  readOnly?: boolean;
}

const ROOM = { widthCm: 500, depthCm: 400 };
const CANVAS = { width: 760, height: 500 };

function getPlacement(item: ArrangementItem, kind: ItemKind, index: number): ArrangementPlacement {
  if (item.placement) return item.placement;
  if (kind === "furniture") {
    return {
      xCm: 40 + (index % 3) * 145,
      yCm: 55 + Math.floor(index / 3) * 125,
      widthCm: 120,
      depthCm: 70,
      rotationDeg: 0,
    };
  }
  if (kind === "lighting") {
    return {
      xCm: 80 + (index % 4) * 105,
      yCm: 75 + Math.floor(index / 4) * 105,
      widthCm: 42,
      depthCm: 42,
      rotationDeg: 0,
    };
  }
  return {
    xCm: 16 + (index % 4) * 110,
    yCm: 18 + Math.floor(index / 4) * 100,
    widthCm: 95,
    depthCm: 65,
    rotationDeg: 0,
  };
}

function getLabel(item: ArrangementItem, kind: ItemKind): string {
  if (kind === "material") {
    const material = item as MaterialItem;
    return material.name || material.materialType || material.category || "Material";
  }
  if (kind === "furniture") return (item as FurnitureItem).item || "Furniture";
  const light = item as LightingItem;
  return light.lightingType || light.fixtureType || "Lighting";
}

function getColor(item: ArrangementItem, kind: ItemKind): string {
  if (kind === "material") {
    const material = item as MaterialItem;
    return material.color || material.finish || "#64748b";
  }
  if (kind === "lighting") {
    const temp = (item as LightingItem).colorTemperature || "";
    if (temp.startsWith("2700") || temp.startsWith("3000")) return "#f59e0b";
    if (temp.startsWith("3500") || temp.startsWith("4000")) return "#fde68a";
    return "#bae6fd";
  }
  return "#7c3aed";
}

function parseDimension(value: string, fallback: number): number {
  const match = value.match(/\d+(?:[.,]\d+)?/);
  const parsed = match ? Number(match[0].replace(",", ".")) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getInitialSize(item: ArrangementItem, kind: ItemKind): Pick<ArrangementPlacement, "widthCm" | "depthCm"> {
  if (kind === "furniture") {
    const dimensions = (item as FurnitureItem).dimensions || "";
    return {
      widthCm: parseDimension(dimensions, 120),
      depthCm: parseDimension(dimensions.split(/[×xX]/).slice(1).join(" "), 70),
    };
  }
  if (kind === "lighting") return { widthCm: 42, depthCm: 42 };
  return { widthCm: 95, depthCm: 65 };
}

function patchPlacement(
  item: ArrangementItem,
  kind: ItemKind,
  index: number,
  patch: Partial<ArrangementPlacement>,
): ArrangementItem {
  const current = getPlacement(item, kind, index);
  return { ...item, placement: { ...current, ...patch, placed: true } };
}

function itemIcon(kind: ItemKind) {
  if (kind === "material") return Palette;
  if (kind === "lighting") return LampCeiling;
  return Sofa;
}

export function RoomArrangementEditor({
  materials,
  furniture,
  lighting,
  onMaterialsChange,
  onFurnitureChange,
  onLightingChange,
  readOnly = false,
}: RoomArrangementEditorProps) {
  const [selected, setSelected] = useState<{ kind: ItemKind; id: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [surfaceId, setSurfaceId] = useState<string | null>(null);

  const allItems = useMemo(
    () => [
      ...materials.map((item, index) => ({ item, kind: "material" as const, index })),
      ...furniture.map((item, index) => ({ item, kind: "furniture" as const, index })),
      ...lighting.map((item, index) => ({ item, kind: "lighting" as const, index })),
    ],
    [furniture, lighting, materials],
  );

  const selectedEntry = selected
    ? allItems.find((entry) => entry.kind === selected.kind && entry.item.id === selected.id)
    : null;
  const selectedPlacement = selectedEntry
    ? getPlacement(selectedEntry.item, selectedEntry.kind, selectedEntry.index)
    : null;

  const surfaceMaterial = materials.find((item) => item.id === surfaceId)
    ?? materials.find((item) => item.category.toLowerCase() === "floor" && item.placement?.placed !== false)
    ?? materials.find((item) => item.category.toLowerCase() === "floor");

  function updateItem(kind: ItemKind, id: string, patch: Partial<ArrangementPlacement>) {
    if (readOnly) return;
    if (kind === "material") {
      onMaterialsChange(materials.map((item, index) => item.id === id ? patchPlacement(item, kind, index, patch) as MaterialItem : item));
    } else if (kind === "furniture") {
      onFurnitureChange(furniture.map((item, index) => item.id === id ? patchPlacement(item, kind, index, patch) as FurnitureItem : item));
    } else {
      onLightingChange(lighting.map((item, index) => item.id === id ? patchPlacement(item, kind, index, patch) as LightingItem : item));
    }
  }

  function dropItem(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (readOnly) return;
    const raw = event.dataTransfer.getData("application/x-room-item");
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as { kind: ItemKind; id: string };
      const entry = allItems.find((candidate) => candidate.kind === payload.kind && candidate.item.id === payload.id);
      if (!entry) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const displayScale = rect.width / CANVAS.width;
      const roomScale = Math.min(CANVAS.width / ROOM.widthCm, CANVAS.height / ROOM.depthCm);
      const xCm = Math.max(0, Math.min(ROOM.widthCm - 20, (event.clientX - rect.left) / displayScale / roomScale));
      const yCm = Math.max(0, Math.min(ROOM.depthCm - 20, (event.clientY - rect.top) / displayScale / roomScale));
      const size = getInitialSize(entry.item, entry.kind);
      const isSurface = entry.kind === "material" && (entry.item as MaterialItem).category.toLowerCase() === "floor";
      updateItem(entry.kind, entry.item.id, {
        xCm: isSurface ? 0 : xCm,
        yCm: isSurface ? 0 : yCm,
        widthCm: isSurface ? ROOM.widthCm : size.widthCm,
        depthCm: isSurface ? ROOM.depthCm : size.depthCm,
        rotationDeg: 0,
        surface: isSurface,
        surfaceType: isSurface ? (entry.item as MaterialItem).category.toLowerCase() : undefined,
      });
      if (isSurface) {
        setSurfaceId(entry.item.id);
        if (entry.kind === "material") {
          onMaterialsChange(materials.map((item, index) => {
            if (item.id === entry.item.id) return patchPlacement(item, entry.kind, index, {
              xCm: 0,
              yCm: 0,
              widthCm: ROOM.widthCm,
              depthCm: ROOM.depthCm,
              rotationDeg: 0,
              surface: true,
              surfaceType: (entry.item as MaterialItem).category.toLowerCase(),
            }) as MaterialItem;
            if (item.category.toLowerCase() === (entry.item as MaterialItem).category.toLowerCase() && item.placement?.surface) {
              return { ...item, placement: { ...item.placement, placed: false } };
            }
            return item;
          }));
        }
      }
      setSelected({ kind: entry.kind, id: entry.item.id });
    } catch {
      // Ignore malformed drag payloads from unrelated browser sources.
    }
  }

  function handleObjectDrag(event: ReactPointerEvent<HTMLDivElement>, kind: ItemKind, item: ArrangementItem, index: number) {
    if (readOnly || item.placement?.placed === false) return;
    event.stopPropagation();
    setSelected({ kind, id: item.id });
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = getPlacement(item, kind, index);
    const canvas = event.currentTarget.parentElement;
    const displayScale = canvas ? canvas.getBoundingClientRect().width / CANVAS.width : 1;
    const scale = Math.min(CANVAS.width / ROOM.widthCm, CANVAS.height / ROOM.depthCm) * displayScale;
    const onMove = (moveEvent: PointerEvent) => {
      updateItem(kind, item.id, {
        xCm: Math.max(0, Math.min(ROOM.widthCm - initial.widthCm, initial.xCm + (moveEvent.clientX - startX) / scale)),
        yCm: Math.max(0, Math.min(ROOM.depthCm - initial.depthCm, initial.yCm + (moveEvent.clientY - startY) / scale)),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function clearPlacement() {
    if (!selectedEntry || readOnly) return;
    const patch = { ...getPlacement(selectedEntry.item, selectedEntry.kind, selectedEntry.index), placed: false };
    if (selectedEntry.kind === "material") {
      onMaterialsChange(materials.map((item) => item.id === selectedEntry.item.id ? { ...item, placement: patch } : item));
    } else if (selectedEntry.kind === "furniture") {
      onFurnitureChange(furniture.map((item) => item.id === selectedEntry.item.id ? { ...item, placement: patch } : item));
    } else {
      onLightingChange(lighting.map((item) => item.id === selectedEntry.item.id ? { ...item, placement: patch } : item));
    }
    setSelected(null);
  }

  function setNumericField(field: "xCm" | "yCm" | "widthCm" | "depthCm" | "rotationDeg", value: string) {
    const parsed = Number(value);
    if (selectedEntry && Number.isFinite(parsed)) updateItem(selectedEntry.kind, selectedEntry.item.id, { [field]: Math.max(0, parsed) });
  }

  const renderEntries = allItems.filter(({ item, kind }) => {
    if (item.placement?.placed === false) return false;
    return kind !== "material" || (item as MaterialItem).category.toLowerCase() !== "floor";
  });

  return (
    <section className="mb-4 rounded-xl border border-cyan-400/25 bg-cyan-400/5 p-4" data-testid="room-arrangement-editor">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Move className="size-4 text-cyan-300" />
            <h3 className="text-sm font-semibold">Atur Ruangan dengan Drag & Drop</h3>
          </div>
          <p className="mt-1 max-w-2xl text-[11px] text-muted-foreground">
            Tarik material, furniture, atau lighting ke area room. Klik item di kanvas untuk mengatur posisi, ukuran, dan rotasi.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border/50 bg-background/30 px-2 py-1 text-[10px] text-muted-foreground">
          <Ruler className="size-3" /> Grid {ROOM.widthCm / 100} × {ROOM.depthCm / 100} m
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[180px_minmax(0,1fr)_190px]">
        <aside className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tarik ke room</p>
          {([
            ["material", materials, Palette],
            ["furniture", furniture, Sofa],
            ["lighting", lighting, LampCeiling],
          ] as const).map(([kind, items, GroupIcon]) => (
            <div key={kind} className="space-y-1.5">
              <p className="flex items-center gap-1 text-[10px] font-medium capitalize text-cyan-200"><GroupIcon className="size-3" /> {kind}</p>
              {items.length === 0 && <p className="rounded border border-dashed border-border/50 p-2 text-[10px] text-muted-foreground">Belum ada item</p>}
              {items.map((item) => {
                const Icon = itemIcon(kind);
                const isSelected = selected?.kind === kind && selected.id === item.id;
                return (
                  <div
                    key={item.id}
                    draggable={!readOnly}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "copy";
                      event.dataTransfer.setData("application/x-room-item", JSON.stringify({ kind, id: item.id }));
                    }}
                    onClick={() => setSelected({ kind, id: item.id })}
                    className={cn(
                      "flex cursor-grab items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] transition-colors active:cursor-grabbing",
                      isSelected ? "border-cyan-300/70 bg-cyan-300/10 text-cyan-100" : "border-border/50 bg-background/30 hover:border-cyan-300/40 hover:bg-cyan-300/5",
                    )}
                    title="Tarik item ini ke room"
                  >
                    <GripVertical className="size-3 shrink-0 text-muted-foreground" />
                    {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="size-6 shrink-0 rounded object-cover" /> : <Icon className="size-3.5 shrink-0 text-cyan-300" />}
                    <span className="min-w-0 truncate">{getLabel(item, kind)}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </aside>

        <div className="overflow-auto rounded-lg border border-border/70 bg-[#07111f] p-2">
          <div
            className={cn("relative mx-auto overflow-hidden rounded-md border transition-colors", dragOver ? "border-cyan-200 bg-cyan-400/10" : "border-cyan-300/30")}
            style={{
              width: CANVAS.width,
              height: CANVAS.height,
              maxWidth: "100%",
              aspectRatio: `${CANVAS.width}/${CANVAS.height}`,
              backgroundImage: "linear-gradient(rgba(103,232,249,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(103,232,249,.08) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
            onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={dropItem}
          >
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-cyan-100/20">
              {dragOver ? "Lepaskan item di sini" : "ROOM PLAN"}
            </div>
            {surfaceMaterial && (
              <div
                className="pointer-events-none absolute inset-0 opacity-30"
                style={{
                  backgroundColor: getColor(surfaceMaterial, "material"),
                  backgroundImage: "linear-gradient(45deg, rgba(255,255,255,.12) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.12) 75%), linear-gradient(45deg, rgba(255,255,255,.12) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.12) 75%)",
                  backgroundPosition: "0 0, 12px 12px",
                  backgroundSize: "24px 24px",
                }}
              />
            )}
            <div className="pointer-events-none absolute inset-2 rounded border border-cyan-200/25" />
            {renderEntries.map(({ item, kind, index }) => {
              const placement = getPlacement(item, kind, index);
              const selectedItem = selected?.kind === kind && selected.id === item.id;
              const scale = Math.min(CANVAS.width / ROOM.widthCm, CANVAS.height / ROOM.depthCm);
              const Icon = itemIcon(kind);
              return (
                <div
                  key={`${kind}-${item.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected({ kind, id: item.id })}
                  onPointerDown={(event) => handleObjectDrag(event, kind, item, index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setSelected({ kind, id: item.id });
                  }}
                  className={cn(
                    "absolute flex cursor-move select-none items-center justify-center overflow-hidden rounded-md border text-[9px] font-medium shadow-lg transition-shadow",
                    selectedItem ? "z-20 border-cyan-100 bg-cyan-300/30 shadow-[0_0_0_2px_rgba(103,232,249,.35)]" : "z-10 border-violet-200/60 bg-violet-500/30",
                  )}
                  style={{
                    left: placement.xCm * scale,
                    top: placement.yCm * scale,
                    width: Math.max(22, placement.widthCm * scale),
                    height: Math.max(22, placement.depthCm * scale),
                    transform: `rotate(${placement.rotationDeg ?? 0}deg)`,
                    borderColor: kind === "lighting" ? getColor(item, kind) : undefined,
                  }}
                  title={`${getLabel(item, kind)} · ${placement.xCm.toFixed(0)}, ${placement.yCm.toFixed(0)} cm`}
                >
                  {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" /> : <Icon className="relative size-4 shrink-0" />}
                  <span className="relative max-w-full truncate bg-black/30 px-1">{getLabel(item, kind)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="rounded-lg border border-border/50 bg-background/30 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Properti item</p>
          {!selectedEntry || !selectedPlacement ? (
            <div className="space-y-2 text-[10px] text-muted-foreground">
              <Box className="size-5 text-cyan-300/60" />
              <p>Pilih item dari daftar atau kanvas untuk mengatur penempatannya.</p>
            </div>
          ) : (
            <>
              <p className="truncate text-xs font-semibold">{getLabel(selectedEntry.item, selectedEntry.kind)}</p>
              <p className="mt-0.5 text-[10px] capitalize text-cyan-200">{selectedEntry.kind}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {([
                  ["xCm", "X (cm)"],
                  ["yCm", "Y (cm)"],
                  ["widthCm", "Lebar"],
                  ["depthCm", "Kedalaman"],
                  ["rotationDeg", "Rotasi"],
                ] as const).map(([field, label]) => (
                  <div key={field}>
                    <Label className="text-[9px]">{label}</Label>
                    <Input
                      className="mt-0.5 h-7 text-[10px]"
                      type="number"
                      min="0"
                      value={Math.round(selectedPlacement[field] ?? 0)}
                      onChange={(event) => setNumericField(field, event.target.value)}
                      disabled={readOnly}
                    />
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 h-7 w-full gap-1 text-[10px]"
                onClick={() => updateItem(selectedEntry.kind, selectedEntry.item.id, { rotationDeg: ((selectedPlacement.rotationDeg ?? 0) + 90) % 360 })}
                disabled={readOnly}
              >
                <RotateCw className="size-3" /> Putar 90°
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 h-7 w-full gap-1 text-[10px] text-destructive hover:text-destructive"
                onClick={clearPlacement}
                disabled={readOnly}
              >
                <Trash2 className="size-3" /> Hapus dari kanvas
              </Button>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}