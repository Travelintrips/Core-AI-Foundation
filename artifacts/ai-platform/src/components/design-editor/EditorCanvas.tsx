/**
 * EditorCanvas — Konva-based canvas workspace
 *
 * Renders all elements using react-konva.
 * Handles: select, drag, resize, rotate, keyboard delete, arrow keys.
 * Uses a single Transformer for selected elements.
 */

import {
  useRef, useEffect, useCallback, useMemo,
} from "react";
import { Stage, Layer, Transformer, Rect, Group } from "react-konva";
import type Konva from "konva";
import { useEditorState, useEditorDispatch } from "@/state/design-editor/context";
import { NUDGE_DISTANCE, NUDGE_DISTANCE_LARGE } from "@/utils/design-editor/constants";
import { TextNode } from "./elements/TextNode";
import { ImageNode } from "./elements/ImageNode";
import { ShapeNode } from "./elements/ShapeNode";
import { QrNode } from "./elements/QrNode";
import { LineNode } from "./elements/LineNode";
import type { DesignElement } from "@/state/design-editor/types";

interface Props {
  containerWidth: number;
  containerHeight: number;
}

export function EditorCanvas({ containerWidth, containerHeight }: Props) {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);

  const { canvas, elements, selectedElementIds, zoom } = state;

  // ── Sorted elements ────────────────────────────────────────────────────────
  const sortedElements = useMemo(
    () => [...elements].sort((a, b) => a.zIndex - b.zIndex),
    [elements],
  );

  // ── Update transformer on selection change ─────────────────────────────────
  useEffect(() => {
    if (!transformerRef.current || !layerRef.current) return;
    const tr = transformerRef.current;
    if (selectedElementIds.length === 0) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const nodes = selectedElementIds
      .map((id) => layerRef.current!.findOne(`#${CSS.escape(id)}`))
      .filter(Boolean) as Konva.Node[];
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedElementIds]);

  // ── Click on empty stage → deselect ───────────────────────────────────────
  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.target === stageRef.current || e.target.name() === "canvas-bg") {
        dispatch({ type: "DESELECT_ALL" });
      }
    },
    [dispatch],
  );

  // ── Element click ──────────────────────────────────────────────────────────
  const handleElementClick = useCallback(
    (id: string, multi: boolean) => {
      const el = elements.find((e) => e.id === id);
      if (el?.locked) return;
      if (multi) {
        dispatch({ type: "SELECT_ELEMENTS", ids: [id], toggle: true });
      } else {
        dispatch({ type: "SELECT_ELEMENTS", ids: [id] });
      }
    },
    [elements, dispatch],
  );

  // ── Drag start/end ─────────────────────────────────────────────────────────
  const handleDragStart = useCallback(
    (_id: string) => {
      // nothing — we use transient mode during drag
    },
    [],
  );

  const handleDragMove = useCallback(
    (id: string, x: number, y: number) => {
      dispatch({ type: "UPDATE_ELEMENT_TRANSIENT", id, patch: { x: Math.round(x), y: Math.round(y) } });
    },
    [dispatch],
  );

  const handleDragEnd = useCallback(
    (id: string, x: number, y: number) => {
      dispatch({ type: "UPDATE_ELEMENT_TRANSIENT", id, patch: { x: Math.round(x), y: Math.round(y) } });
      dispatch({ type: "COMMIT_TRANSIENT" });
    },
    [dispatch],
  );

  // ── Transform end (resize/rotate) ──────────────────────────────────────────
  const handleTransformEnd = useCallback(() => {
    if (!transformerRef.current) return;
    const nodes = transformerRef.current.nodes();
    for (const node of nodes) {
      const id = node.id();
      const el = elements.find((e) => e.id === id);
      if (!el) continue;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      const newW = Math.max(10, Math.round(node.width() * scaleX));
      const newH = Math.max(10, Math.round(node.height() * scaleY));
      const newRot = Math.round(node.rotation());
      // Reset scale after baking into width/height
      node.scaleX(1);
      node.scaleY(1);
      dispatch({
        type: "UPDATE_ELEMENT",
        id,
        patch: {
          x: Math.round(node.x()),
          y: Math.round(node.y()),
          width: newW,
          height: newH,
          rotation: newRot,
        },
      });
    }
  }, [elements, dispatch]);

  // ── Keyboard handler (delete, arrows) ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName ?? "";
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          dispatch({ type: "DELETE_ELEMENTS", ids: selectedElementIds });
        }
        return;
      }
      if (e.key === "Escape") {
        dispatch({ type: "DESELECT_ALL" });
        return;
      }
      // Undo/redo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "UNDO" });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        dispatch({ type: "REDO" });
        return;
      }
      // Duplicate
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          dispatch({ type: "DUPLICATE_ELEMENTS", ids: selectedElementIds });
        }
        return;
      }
      // Arrow keys
      const arrows: Record<string, [number, number]> = {
        ArrowLeft:  [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp:    [0, -1],
        ArrowDown:  [0, 1],
      };
      const delta = arrows[e.key];
      if (delta && selectedElementIds.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_DISTANCE_LARGE : NUDGE_DISTANCE;
        for (const id of selectedElementIds) {
          const el = elements.find((el) => el.id === id);
          if (!el || el.locked) continue;
          dispatch({
            type: "UPDATE_ELEMENT",
            id,
            patch: { x: el.x + delta[0] * step, y: el.y + delta[1] * step },
          });
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedElementIds, elements, dispatch]);

  // ── Layout ─────────────────────────────────────────────────────────────────
  // Canvas is drawn at native size, then the Stage is scaled by zoom.
  const scaledW = canvas.width * zoom;
  const scaledH = canvas.height * zoom;

  // Center the canvas in the container
  const offsetX = Math.max(0, (containerWidth - scaledW) / 2);
  const offsetY = Math.max(0, (containerHeight - scaledH) / 2);

  const commonProps = (el: DesignElement) => ({
    id: el.id,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    rotation: el.rotation ?? 0,
    opacity: el.opacity ?? 1,
    visible: el.visible !== false,
    draggable: !el.locked,
    onClick: (e: Konva.KonvaEventObject<MouseEvent>) =>
      handleElementClick(el.id, e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey),
    onDragStart: () => handleDragStart(el.id),
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) =>
      handleDragMove(el.id, e.target.x(), e.target.y()),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) =>
      handleDragEnd(el.id, e.target.x(), e.target.y()),
  });

  return (
    <div
      className="flex-1 overflow-auto flex items-center justify-center bg-[#1a1a2e]"
      style={{ minWidth: 0, minHeight: 0 }}
    >
      <div
        style={{
          marginLeft: offsetX,
          marginTop: offsetY,
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
          position: "relative",
        }}
      >
        <Stage
          ref={stageRef}
          width={scaledW}
          height={scaledH}
          scaleX={zoom}
          scaleY={zoom}
          onMouseDown={handleStageMouseDown}
        >
          <Layer ref={layerRef}>
            {/* Canvas background */}
            <Rect
              x={0}
              y={0}
              width={canvas.width}
              height={canvas.height}
              fill={canvas.backgroundColor ?? "#ffffff"}
              name="canvas-bg"
              listening={true}
            />

            {/* Elements */}
            {sortedElements.map((el) => {
              if (!el.visible && !selectedElementIds.includes(el.id)) return null;
              switch (el.type) {
                case "text":
                  return <TextNode key={el.id} element={el as any} {...commonProps(el)} />;
                case "image":
                  return <ImageNode key={el.id} element={el as any} {...commonProps(el)} />;
                case "shape":
                  return <ShapeNode key={el.id} element={el as any} {...commonProps(el)} />;
                case "qrcode":
                  return <QrNode key={el.id} element={el as any} {...commonProps(el)} />;
                case "line":
                  return <LineNode key={el.id} element={el as any} {...commonProps(el)} />;
                default:
                  return null;
              }
            })}

            {/* Transformer */}
            <Transformer
              ref={transformerRef}
              rotateEnabled={true}
              enabledAnchors={[
                "top-left", "top-center", "top-right",
                "middle-right", "middle-left",
                "bottom-left", "bottom-center", "bottom-right",
              ]}
              boundBoxFunc={(oldBox, newBox) => {
                if (Math.abs(newBox.width) < 10 || Math.abs(newBox.height) < 10) return oldBox;
                return newBox;
              }}
              onTransformEnd={handleTransformEnd}
              anchorFill="#7C6EFA"
              anchorStroke="#5F52D0"
              anchorSize={8}
              borderStroke="#7C6EFA"
              borderStrokeWidth={1}
              keepRatio={false}
            />
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
