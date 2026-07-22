import { useRef, useEffect, useCallback, useState, memo } from "react";
import { cn } from "@/lib/utils";
import type { DesignElement, CanvasState, ResizeHandle, ToolType, Guide } from "./types";
import { makeElement } from "./types";

// ── Element renderer ──────────────────────────────────────────────────────────
// memo prevents sibling elements from re-rendering when only one changes.

const ElementRenderer = memo(function ElementRenderer({ el }: { el: DesignElement }) {
  const style: React.CSSProperties = {
    position: "absolute",
    left: el.x,
    top: el.y,
    width: el.width,
    height: el.height,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    transformOrigin: "center center",
    opacity: el.opacity,
    zIndex: el.zIndex,
    pointerEvents: "none",
    userSelect: "none",
  };

  if (el.type === "text") {
    return (
      <div style={{
        ...style,
        fontSize: el.fontSize ?? 16,
        fontFamily: el.fontFamily ?? "Inter, sans-serif",
        fontWeight: el.fontWeight ?? "400",
        textAlign: (el.textAlign ?? "left") as React.CSSProperties["textAlign"],
        color: el.color ?? "#111827",
        lineHeight: el.lineHeight ?? 1.4,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflow: "hidden",
      }}>
        {el.text ?? ""}
      </div>
    );
  }

  if (el.type === "image") {
    if (el.src) {
      return (
        <img
          src={el.src}
          alt={el.name}
          draggable={false}
          loading="lazy"
          decoding="async"
          style={{
            ...style,
            objectFit: (el.objectFit ?? "cover") as React.CSSProperties["objectFit"],
            borderRadius: el.borderRadius,
            border: el.strokeWidth ? `${el.strokeWidth}px solid ${el.stroke}` : undefined,
          }}
        />
      );
    }
    // Placeholder
    return (
      <div style={{
        ...style,
        background: "#f3f4f6",
        borderRadius: el.borderRadius,
        border: "2px dashed #d1d5db",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        color: "#9ca3af",
      }}>
        🖼 Image
      </div>
    );
  }

  if (el.type === "line") {
    return (
      <div style={{
        ...style,
        height: Math.max(el.strokeWidth ?? 2, 1),
        background: el.stroke || "#6366f1",
        borderRadius: 1,
      }} />
    );
  }

  // rect, circle, frame
  const borderRadius = el.type === "circle" ? 9999 : (el.borderRadius ?? 0);
  return (
    <div style={{
      ...style,
      background: el.fill || "transparent",
      borderRadius,
      border: el.strokeWidth ? `${el.strokeWidth}px solid ${el.stroke}` : "none",
      boxSizing: "border-box",
    }} />
  );
});

// ── Resize handles ────────────────────────────────────────────────────────────

const HANDLES: { id: ResizeHandle; cx: number; cy: number; cursor: string }[] = [
  { id: "nw", cx: 0,   cy: 0,   cursor: "nw-resize" },
  { id: "n",  cx: 0.5, cy: 0,   cursor: "n-resize" },
  { id: "ne", cx: 1,   cy: 0,   cursor: "ne-resize" },
  { id: "e",  cx: 1,   cy: 0.5, cursor: "e-resize" },
  { id: "se", cx: 1,   cy: 1,   cursor: "se-resize" },
  { id: "s",  cx: 0.5, cy: 1,   cursor: "s-resize" },
  { id: "sw", cx: 0,   cy: 1,   cursor: "sw-resize" },
  { id: "w",  cx: 0,   cy: 0.5, cursor: "w-resize" },
];

const HS = 7; // handle size

interface SelectionOverlayProps {
  element: DesignElement;
  zoom: number;
  onResizeStart: (handle: ResizeHandle) => void;
}

function SelectionOverlay({ element: el, zoom, onResizeStart }: SelectionOverlayProps) {
  const pad = 2 / zoom;
  return (
    <div
      style={{
        position: "absolute",
        left: el.x - pad,
        top: el.y - pad,
        width: el.width + pad * 2,
        height: el.height + pad * 2,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        transformOrigin: "center center",
        pointerEvents: "none",
        zIndex: 9999,
        boxSizing: "border-box",
        border: `${1.5 / zoom}px solid #6366f1`,
        outline: `${1 / zoom}px solid rgba(99,102,241,0.2)`,
      }}
    >
      {HANDLES.map((h) => (
        <div
          key={h.id}
          style={{
            position: "absolute",
            width: HS / zoom,
            height: HS / zoom,
            left: `calc(${h.cx * 100}% - ${HS / (2 * zoom)}px)`,
            top: `calc(${h.cy * 100}% - ${HS / (2 * zoom)}px)`,
            background: "white",
            border: `${1.5 / zoom}px solid #6366f1`,
            borderRadius: 2 / zoom,
            cursor: h.cursor,
            pointerEvents: "all",
            zIndex: 10000,
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart(h.id);
          }}
        />
      ))}
    </div>
  );
}

// ── Alignment guides ──────────────────────────────────────────────────────────

function AlignmentGuides({ guides, canvasW, canvasH }: { guides: Guide[]; canvasW: number; canvasH: number }) {
  return (
    <>
      {guides.map((g) =>
        g.axis === "x" ? (
          <div
            key={g.id}
            style={{
              position: "absolute",
              left: g.value,
              top: 0,
              width: 1,
              height: canvasH,
              background: "#ef4444",
              pointerEvents: "none",
              zIndex: 9998,
            }}
          />
        ) : (
          <div
            key={g.id}
            style={{
              position: "absolute",
              top: g.value,
              left: 0,
              width: canvasW,
              height: 1,
              background: "#ef4444",
              pointerEvents: "none",
              zIndex: 9998,
            }}
          />
        )
      )}
    </>
  );
}

// ── Main Canvas Area ──────────────────────────────────────────────────────────

interface Props {
  canvas: CanvasState;
  selectedIds: string[];
  activeTool: ToolType;
  zoom: number;
  showGrid: boolean;
  onSelect: (id: string | null, multi: boolean) => void;
  onUpdate: (id: string, changes: Partial<DesignElement>) => void;
  onAdd: (element: DesignElement) => void;
}

export function CanvasArea({
  canvas, selectedIds, activeTool, zoom, showGrid,
  onSelect, onUpdate, onAdd,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [guides, setGuides] = useState<Guide[]>([]);

  // Drag state (refs to avoid stale closures)
  const dragRef = useRef<{
    type: "move" | "resize";
    elementId: string;
    handle?: ResizeHandle;
    startX: number;
    startY: number;
    origEl: DesignElement;
  } | null>(null);

  // Compute alignment guides during drag
  const computeGuides = useCallback((el: DesignElement): Guide[] => {
    const others = canvas.elements.filter((e) => e.id !== el.id && e.visible);
    const guideList: Guide[] = [];
    const SNAP = 8 / zoom;

    const myEdges = {
      left: el.x, centerX: el.x + el.width / 2, right: el.x + el.width,
      top: el.y, centerY: el.y + el.height / 2, bottom: el.y + el.height,
    };
    const targets = [0, canvas.width / 2, canvas.width, canvas.height / 2, 0, canvas.height];
    const xEdges: number[] = [0, canvas.width / 2, canvas.width];
    const yEdges: number[] = [0, canvas.height / 2, canvas.height];

    others.forEach((o) => {
      xEdges.push(o.x, o.x + o.width / 2, o.x + o.width);
      yEdges.push(o.y, o.y + o.height / 2, o.y + o.height);
    });

    if (Math.abs(myEdges.left - xEdges.find((v) => Math.abs(v - myEdges.left) < SNAP)!) < SNAP) {
      const v = xEdges.find((v) => Math.abs(v - myEdges.left) < SNAP);
      if (v !== undefined) guideList.push({ id: `x-l-${v}`, axis: "x", value: v });
    }
    if (Math.abs(myEdges.centerX - (xEdges.find((v) => Math.abs(v - myEdges.centerX) < SNAP) ?? Infinity)) < SNAP) {
      const v = xEdges.find((v) => Math.abs(v - myEdges.centerX) < SNAP);
      if (v !== undefined) guideList.push({ id: `x-c-${v}`, axis: "x", value: v });
    }
    if (Math.abs(myEdges.top - (yEdges.find((v) => Math.abs(v - myEdges.top) < SNAP) ?? Infinity)) < SNAP) {
      const v = yEdges.find((v) => Math.abs(v - myEdges.top) < SNAP);
      if (v !== undefined) guideList.push({ id: `y-t-${v}`, axis: "y", value: v });
    }
    if (Math.abs(myEdges.centerY - (yEdges.find((v) => Math.abs(v - myEdges.centerY) < SNAP) ?? Infinity)) < SNAP) {
      const v = yEdges.find((v) => Math.abs(v - myEdges.centerY) < SNAP);
      if (v !== undefined) guideList.push({ id: `y-c-${v}`, axis: "y", value: v });
    }

    void targets;
    return guideList.slice(0, 6);
  }, [canvas.elements, canvas.width, canvas.height, zoom]);

  // Global mouse handlers
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;

      const dx = (e.clientX - d.startX) / zoom;
      const dy = (e.clientY - d.startY) / zoom;
      const o = d.origEl;

      if (d.type === "move") {
        const newEl = { ...o, x: o.x + dx, y: o.y + dy };
        const gs = computeGuides(newEl);
        setGuides(gs);
        onUpdate(d.elementId, { x: o.x + dx, y: o.y + dy });
      } else if (d.type === "resize" && d.handle) {
        const h = d.handle;
        let { x, y, width, height } = o;

        if (h.includes("e")) { width = Math.max(10, o.width + dx); }
        if (h.includes("w")) { x = o.x + dx; width = Math.max(10, o.width - dx); }
        if (h.includes("s")) { height = Math.max(10, o.height + dy); }
        if (h.includes("n")) { y = o.y + dy; height = Math.max(10, o.height - dy); }

        onUpdate(d.elementId, { x, y, width, height });
      }
    }

    function onMouseUp() {
      if (dragRef.current) {
        setGuides([]);
        dragRef.current = null;
      }
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [zoom, onUpdate, computeGuides]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length > 0) {
        // Parent handles deletion via selection state — signal via custom event
        window.dispatchEvent(new CustomEvent("design-delete-selected"));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds]);

  function handleCanvasMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    // Clicked on bare canvas (not an element)
    if (e.target === e.currentTarget || (e.target as HTMLElement).dataset["canvas"] === "true") {
      onSelect(null, false);

      // If a shape tool is active — create element at click position
      const shapeTools: ToolType[] = ["text", "rect", "circle", "frame", "line", "image"];
      if (shapeTools.includes(activeTool)) {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - rect.left) / zoom;
        const y = (e.clientY - rect.top) / zoom;
        const el = makeElement(activeTool as "text" | "rect" | "circle" | "frame" | "line" | "image", x, y);
        // Set zIndex to max + 1
        const maxZ = canvas.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
        onAdd({ ...el, zIndex: maxZ + 1 });
      }
    }
  }

  function handleElementMouseDown(e: React.MouseEvent, el: DesignElement) {
    e.stopPropagation();
    if (el.locked) return;
    if (activeTool !== "select") return;

    onSelect(el.id, e.shiftKey || e.metaKey);
    dragRef.current = {
      type: "move",
      elementId: el.id,
      startX: e.clientX,
      startY: e.clientY,
      origEl: { ...el },
    };
  }

  function handleResizeStart(el: DesignElement, handle: ResizeHandle) {
    dragRef.current = {
      type: "resize",
      elementId: el.id,
      handle,
      startX: 0,
      startY: 0,
      origEl: { ...el },
    };

    function onMouseDown(e: MouseEvent) {
      if (dragRef.current) {
        dragRef.current.startX = e.clientX;
        dragRef.current.startY = e.clientY;
      }
    }
    // The mousedown already fired on the handle, grab current position
    const lastMousePos = { x: 0, y: 0 };
    window.addEventListener("mousemove", function capture(e) {
      if (!lastMousePos.x) {
        dragRef.current!.startX = e.clientX;
        dragRef.current!.startY = e.clientY;
        dragRef.current!.origEl = { ...el };
      }
      window.removeEventListener("mousemove", capture);
    }, { once: true });

    void onMouseDown;
  }

  const gridBg = showGrid
    ? `repeating-linear-gradient(#e5e7eb 0 1px, transparent 1px 100%),
       repeating-linear-gradient(90deg, #e5e7eb 0 1px, transparent 1px 100%)`
    : undefined;
  const gridSize = 20;

  const sorted = [...canvas.elements].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div
      ref={containerRef}
      data-canvas="true"
      className={cn(
        "relative select-none",
        activeTool === "hand" ? "cursor-grab" : activeTool === "select" ? "cursor-default" : "cursor-crosshair"
      )}
      style={{
        width: canvas.width,
        height: canvas.height,
        background: canvas.background,
        backgroundImage: gridBg,
        backgroundSize: showGrid ? `${gridSize}px ${gridSize}px` : undefined,
        boxShadow: "0 4px 32px rgba(0,0,0,0.12)",
        flexShrink: 0,
      }}
      onMouseDown={handleCanvasMouseDown}
    >
      {/* Elements */}
      {sorted.filter((el) => el.visible).map((el) => (
        <div
          key={el.id}
          style={{
            position: "absolute",
            left: el.x,
            top: el.y,
            width: el.width,
            height: el.height,
            cursor: el.locked ? "not-allowed" : activeTool === "select" ? "move" : "crosshair",
            zIndex: el.zIndex,
          }}
          onMouseDown={(e) => handleElementMouseDown(e, el)}
        >
          <ElementRenderer el={el} />
        </div>
      ))}

      {/* Selection overlays */}
      {selectedIds.map((id) => {
        const el = canvas.elements.find((e) => e.id === id);
        if (!el) return null;
        return (
          <SelectionOverlay
            key={id}
            element={el}
            zoom={zoom}
            onResizeStart={(handle) => handleResizeStart(el, handle)}
          />
        );
      })}

      {/* Alignment guides */}
      <AlignmentGuides guides={guides} canvasW={canvas.width} canvasH={canvas.height} />
    </div>
  );
}
