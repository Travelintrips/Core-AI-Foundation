import { Rect, Circle, Ellipse } from "react-konva";
import type Konva from "konva";
import type { ShapeElement } from "@/state/design-editor/types";

interface Props {
  element: ShapeElement;
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  draggable: boolean;
  onClick?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragStart?: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
}

export function ShapeNode({ element, ...props }: Props) {
  const fill = typeof element.fill === "string" ? element.fill : "#7C6EFA";
  const strokeWidth = element.border?.width ?? 0;
  const stroke = element.border?.color ?? undefined;
  const shadowBlur = element.shadow?.blur ?? 0;
  const shadowColor = element.shadow?.color ?? "rgba(0,0,0,0.3)";
  const shadowOffsetX = element.shadow?.offsetX ?? 0;
  const shadowOffsetY = element.shadow?.offsetY ?? 0;

  const shared = {
    ...props,
    fill,
    strokeWidth,
    stroke,
    shadowBlur,
    shadowColor,
    shadowOffsetX,
    shadowOffsetY,
  };

  if (element.shape === "circle") {
    return (
      <Ellipse
        {...shared}
        radiusX={props.width / 2}
        radiusY={props.height / 2}
        x={props.x + props.width / 2}
        y={props.y + props.height / 2}
      />
    );
  }

  return (
    <Rect
      {...shared}
      cornerRadius={
        element.shape === "rounded-rectangle"
          ? (element.borderRadius ?? 12)
          : (element.borderRadius ?? 0)
      }
    />
  );
}
