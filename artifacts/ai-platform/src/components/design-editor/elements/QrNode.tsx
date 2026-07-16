import { Rect, Text, Line } from "react-konva";
import type Konva from "konva";
import type { QrCodeElement, VariableBinding } from "@/state/design-editor/types";

interface Props {
  element: QrCodeElement;
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  draggable: boolean;
  sampleData?: Record<string, string | number | boolean | null>;
  onClick?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragStart?: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
}

function resolveContent(
  content: string | { binding: VariableBinding },
  sampleData: Record<string, string | number | boolean | null>,
): string {
  if (typeof content === "string") return content;
  const val = sampleData[content.binding.variableKey];
  return typeof val === "string" ? val : (content.binding.fallback ?? "https://example.com");
}

/**
 * QR placeholder — renders a visual QR stand-in for the editor.
 * Final QR is always rendered by the backend renderer.
 */
export function QrNode({ element, sampleData = {}, ...props }: Props) {
  const bg = element.bgColor ?? "#ffffff";
  const fg = element.fgColor ?? "#000000";
  const content = resolveContent(element.content, sampleData);
  const size = Math.min(props.width, props.height);
  const cellSize = Math.floor(size / 7);

  // Simulate a 7×7 QR finder pattern (corners only)
  const finderCells: [number, number][] = [];
  // Top-left finder
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const outer = r === 0 || r === 6 || c === 0 || c === 6;
      const inner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      if (outer || inner) finderCells.push([r, c]);
    }
  }

  return (
    <>
      {/* Background */}
      <Rect {...props} fill={bg} />
      {/* Decorative QR pattern */}
      {finderCells.map(([r, c]) => (
        <Rect
          key={`${r}-${c}`}
          x={props.x + c * cellSize}
          y={props.y + r * cellSize}
          width={cellSize}
          height={cellSize}
          fill={fg}
          listening={false}
        />
      ))}
      {/* Label */}
      <Text
        x={props.x}
        y={props.y + props.height - 18}
        width={props.width}
        text="QR"
        fontSize={11}
        fill={fg}
        align="center"
        listening={false}
      />
    </>
  );
}
