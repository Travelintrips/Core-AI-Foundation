/**
 * EditorCanvas — CSS-based canvas rendering (no Konva/Fabric dependency)
 * Handles drag/move, resize handles, rotation, selection
 */
import { useRef, useCallback, useState, useEffect, useMemo } from "react";
import type { SceneElement, Scene } from "@/lib/designTemplateAdapter";
import type { TemplateVariable } from "@/lib/designTemplateTypes";

interface Props {
  scene: Scene;
  selectedIds: string[];
  zoom: number;
  onSelect: (id: string | null, multi: boolean) => void;
  onUpdate: (id: string, changes: Partial<SceneElement>) => void;
  onAdd?: (el: SceneElement) => void;
  readOnly?: boolean;
  /** Variable definitions from the scene — used to resolve defaultValue for preview */
  variables?: TemplateVariable[];
}

type DragState = {
  kind: "move";
  id: string; startX: number; startY: number; origX: number; origY: number;
} | {
  kind: "resize";
  id: string; handle: string; startX: number; startY: number;
  origX: number; origY: number; origW: number; origH: number;
};

const HANDLE_SIZE = 8;
const HANDLES = ["nw","n","ne","e","se","s","sw","w"] as const;

function handleCursor(h: string) {
  const map: Record<string,string> = {
    nw:"nw-resize",n:"n-resize",ne:"ne-resize",e:"e-resize",
    se:"se-resize",s:"s-resize",sw:"sw-resize",w:"w-resize",
  };
  return map[h] ?? "pointer";
}

function handleOffset(h: string, w: number, ht: number): {left:number;top:number} {
  const mid = HANDLE_SIZE / 2;
  switch(h) {
    case "nw": return {left:-mid,top:-mid};
    case "n":  return {left:w/2-mid,top:-mid};
    case "ne": return {left:w-mid,top:-mid};
    case "e":  return {left:w-mid,top:ht/2-mid};
    case "se": return {left:w-mid,top:ht-mid};
    case "s":  return {left:w/2-mid,top:ht-mid};
    case "sw": return {left:-mid,top:ht-mid};
    case "w":  return {left:-mid,top:ht/2-mid};
    default:   return {left:0,top:0};
  }
}

const EMPTY_MAP = new Map<string, string>();

function ElementDisplay({
  el,
  zoom,
  variableDefaults = EMPTY_MAP,
}: {
  el: SceneElement;
  zoom: number;
  /** Map of variableKey → defaultValue for preview rendering */
  variableDefaults?: Map<string, string>;
}) {
  // NOTE: position/size/rotation/zIndex are handled by the wrapper div in EditorCanvas.
  // ElementDisplay only adds opacity, visibility, and type-specific styles.
  const style: React.CSSProperties = {
    position: "absolute", left: 0, top: 0,
    width: "100%", height: "100%",
    opacity: el.opacity,
    pointerEvents: "none", userSelect: "none",
    display: el.visible ? undefined : "none",
  };

  if (el.type === "text") {
    // For variable-bound elements: show fallback (binding.fallback) → defaultValue → key label
    const content = el.contentMode === "variable"
      ? (() => {
          const key = el.variableBinding?.variableKey;
          if (!key) return "[variable]";
          // binding.fallback carries the AI-generated defaultValue from the pipeline
          const fromFallback = el.variableBinding?.fallback;
          if (fromFallback) return fromFallback;
          // Also check the scene's variable definitions
          const fromScene = variableDefaults.get(key);
          if (fromScene) return fromScene;
          // Last resort: show key in brackets so it's obvious it's unresolved
          return `[${key}]`;
        })()
      : el.staticContent;
    return (
      <div style={{
        ...style,
        fontSize: (el.fontSize ?? 16) * zoom,
        fontFamily: el.fontFamily,
        fontWeight: el.fontWeight as React.CSSProperties["fontWeight"],
        fontStyle: el.italic ? "italic" : "normal",
        textDecoration: el.underline ? "underline" : "none",
        color: el.color,
        textAlign: el.textAlign as React.CSSProperties["textAlign"],
        lineHeight: el.lineHeight,
        letterSpacing: el.letterSpacing,
        textTransform: el.textTransform as React.CSSProperties["textTransform"],
        overflow: "hidden", whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>{content}</div>
    );
  }

  if (el.type === "image") {
    if (el.previewUrl) {
      return <img src={el.previewUrl} alt={el.name} draggable={false}
        style={{...style, objectFit: el.objectFit as React.CSSProperties["objectFit"],
          borderRadius: (el.borderRadius ?? 0) * zoom}} />;
    }
    const label = el.variableBinding ? `[${el.variableBinding.variableKey}]` : "Image";
    return (
      <div style={{...style, background:"#f3f4f6", border:"2px dashed #d1d5db",
        borderRadius:(el.borderRadius??0)*zoom, display:"flex",alignItems:"center",
        justifyContent:"center", fontSize:12*zoom, color:"#9ca3af"}}>{label}</div>
    );
  }

  if (el.type === "shape") {
    const br = el.shapeKind === "circle" ? 9999 : (el.cornerRadius ?? 0) * zoom;
    return (
      <div style={{...style, background: el.fillColor, borderRadius: br,
        border: el.strokeWidth > 0 ? `${el.strokeWidth*zoom}px solid ${el.strokeColor}` : "none",
        boxSizing:"border-box"}} />
    );
  }

  if (el.type === "line") {
    return (
      <div style={{...style, height: Math.max((el.strokeWidth??2)*zoom,1),
        background: el.strokeColor, borderRadius:1}} />
    );
  }

  if (el.type === "qrcode") {
    const label = el.contentMode === "variable"
      ? `QR — ${el.variableBinding?.variableKey ?? "variable"}`
      : "QR Code";
    return (
      <div style={{...style, background: el.bgColor, display:"flex",flexDirection:"column",
        alignItems:"center",justifyContent:"center",fontSize:11*zoom,color:el.fgColor,
        border:`2px solid ${el.fgColor}`, boxSizing:"border-box"}}>
        <div style={{fontSize:28*zoom,lineHeight:1}}>▦</div>
        <div style={{fontSize:10*zoom,marginTop:4*zoom}}>{label}</div>
      </div>
    );
  }
  return null;
}

export function EditorCanvas({ scene, selectedIds, zoom, onSelect, onUpdate, readOnly, variables }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [localPositions, setLocalPositions] = useState<Record<string, {x:number;y:number;w:number;h:number}>>({});

  // Build a fast lookup: variableKey → defaultValue for rendering variable-bound text
  const variableDefaults = useMemo(() => new Map<string, string>(
    (variables ?? scene.variables ?? [])
      .filter((v) => v.defaultValue !== undefined && v.defaultValue !== null)
      .map((v) => [v.key, String(v.defaultValue)]),
  ), [variables, scene.variables]);

  useEffect(() => { setLocalPositions({}); }, [scene.elements]);

  const startDrag = useCallback((e: React.MouseEvent, id: string) => {
    if (readOnly) return;
    const el = scene.elements.find(el => el.id === id);
    if (!el || el.locked) return;
    e.stopPropagation();
    dragRef.current = { kind:"move", id, startX:e.clientX, startY:e.clientY, origX:el.x, origY:el.y };
    if (!selectedIds.includes(id)) onSelect(id, e.shiftKey || e.metaKey);
  }, [scene.elements, selectedIds, onSelect, readOnly]);

  const startResize = useCallback((e: React.MouseEvent, id: string, handle: string) => {
    if (readOnly) return;
    const el = scene.elements.find(el => el.id === id);
    if (!el || el.locked) return;
    e.stopPropagation();
    dragRef.current = { kind:"resize", id, handle, startX:e.clientX, startY:e.clientY,
      origX:el.x, origY:el.y, origW:el.width, origH:el.height };
  }, [scene.elements, readOnly]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / zoom;
    const dy = (e.clientY - d.startY) / zoom;

    if (d.kind === "move") {
      setLocalPositions(prev => ({...prev, [d.id]: {
        x: d.origX + dx, y: d.origY + dy,
        w: scene.elements.find(el=>el.id===d.id)?.width ?? 100,
        h: scene.elements.find(el=>el.id===d.id)?.height ?? 100,
      }}));
    } else if (d.kind === "resize") {
      let nx=d.origX, ny=d.origY, nw=d.origW, nh=d.origH;
      const h = d.handle;
      if (h.includes("e")) nw = Math.max(10, d.origW + dx);
      if (h.includes("s")) nh = Math.max(10, d.origH + dy);
      if (h.includes("w")) { nx = d.origX + dx; nw = Math.max(10, d.origW - dx); }
      if (h.includes("n")) { ny = d.origY + dy; nh = Math.max(10, d.origH - dy); }
      setLocalPositions(prev => ({...prev, [d.id]: {x:nx,y:ny,w:nw,h:nh}}));
    }
  }, [zoom, scene.elements]);

  const handleMouseUp = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    const lp = localPositions[d.id];
    if (!lp) return;
    if (d.kind === "move") {
      onUpdate(d.id, { x: Math.round(lp.x), y: Math.round(lp.y) });
    } else {
      onUpdate(d.id, { x: Math.round(lp.x), y: Math.round(lp.y), width: Math.round(lp.w), height: Math.round(lp.h) });
    }
    setLocalPositions(prev => { const n={...prev}; delete n[d.id]; return n; });
  }, [localPositions, onUpdate]);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const sorted = [...scene.elements].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div
      ref={containerRef}
      style={{ width: scene.canvas.width * zoom, height: scene.canvas.height * zoom,
        background: scene.canvas.backgroundColor, position: "relative",
        flexShrink: 0, boxShadow: "0 4px 32px rgba(0,0,0,0.18)",
        overflow: "hidden" }}
      onClick={(e) => { if (e.target === e.currentTarget) onSelect(null, false); }}
    >
      {sorted.map((el) => {
        const lp = localPositions[el.id];
        const displayEl = lp ? { ...el, x: lp.x, y: lp.y, width: lp.w, height: lp.h } : el;
        const isSelected = selectedIds.includes(el.id);

        return (
          <div key={el.id} style={{ position:"absolute", left:0, top:0, width:"100%", height:"100%" }}>
            {/* Element display */}
            <div
              style={{ position:"absolute", left:displayEl.x*zoom, top:displayEl.y*zoom,
                width:displayEl.width*zoom, height:displayEl.height*zoom, cursor: el.locked?"default":"move",
                transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined, transformOrigin:"center center",
                zIndex:el.zIndex, outline: isSelected ? "2px solid #6366f1" : undefined }}
              onMouseDown={(e) => { if(e.button===0) startDrag(e, el.id); }}
              onClick={(e) => { e.stopPropagation(); onSelect(el.id, e.shiftKey||e.metaKey); }}
            >
              <ElementDisplay el={displayEl} zoom={zoom} variableDefaults={variableDefaults} />
            </div>

            {/* Selection handles */}
            {isSelected && !readOnly && (
              <>
                {HANDLES.map((h) => {
                  const off = handleOffset(h, displayEl.width*zoom, displayEl.height*zoom);
                  return (
                    <div key={h}
                      style={{ position:"absolute", zIndex:999,
                        left: displayEl.x*zoom + off.left, top: displayEl.y*zoom + off.top,
                        width:HANDLE_SIZE, height:HANDLE_SIZE, background:"white",
                        border:"1.5px solid #6366f1", borderRadius:2, cursor:handleCursor(h) }}
                      onMouseDown={(e) => { e.stopPropagation(); startResize(e, el.id, h); }}
                    />
                  );
                })}
                {/* Rotation handle */}
                <div style={{ position:"absolute", zIndex:999,
                  left: displayEl.x*zoom + displayEl.width*zoom/2 - 4,
                  top: displayEl.y*zoom - 24,
                  width:8, height:8, background:"#6366f1", borderRadius:"50%", cursor:"grab" }}
                  title="Drag to rotate (hold Shift for 45° snaps)"
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
