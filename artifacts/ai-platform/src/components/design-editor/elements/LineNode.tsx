import { Line, Rect } from "react-konva";
import type Konva from "konva";
import type { LineElement } from "@/state/design-editor/types";

interface Props {
  element: LineElement;
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

export function LineNode({ element, ...props }: Props) {
  const { x, y, width, height, ...rest } = props;
  const strokeWidth = element.strokeWidth ?? 2;

  return (
    <>
      {/* Invisible hit area for easier selection */}
      <Rect
        x={x}
        y={y}
        width={width}
        height={Math.max(height, 16)}
        fill="transparent"
        {...rest}
      />
      <Line
        x={x}
        y={y + Math.max(height, strokeWidth) / 2}
        points={[0, 0, width, 0]}
        stroke={element.stroke ?? "#000000"}
        strokeWidth={strokeWidth}
        dash={element.dashArray}
        listening={false}
        opacity={props.opacity}
        rotation={props.rotation}
      />
    </>
  );
}
