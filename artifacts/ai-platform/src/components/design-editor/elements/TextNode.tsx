import { Text } from "react-konva";
import type Konva from "konva";
import type { TextElement, VariableBinding } from "@/state/design-editor/types";

interface Props {
  element: TextElement;
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
  if (val !== undefined && val !== null) return String(val);
  return content.binding.fallback ?? `{{${content.binding.variableKey}}}`;
}

export function TextNode({ element, sampleData = {}, ...props }: Props) {
  const text = resolveContent(element.content, sampleData);
  const align = element.textAlign === "justify" ? "left" : (element.textAlign ?? "left");

  return (
    <Text
      {...props}
      text={text}
      fontFamily={element.fontFamily ?? "Inter"}
      fontSize={element.fontSize ?? 24}
      fontStyle={[
        element.italic ? "italic" : "",
        (element.fontWeight === "bold" || (element.fontWeight as number) >= 700) ? "bold" : "",
      ].filter(Boolean).join(" ") || "normal"}
      fill={element.color ?? "#000000"}
      align={align as "left" | "center" | "right"}
      lineHeight={element.lineHeight ?? 1.4}
      wrap={element.overflow === "wrap" ? "word" : "none"}
      ellipsis={element.overflow === "truncate"}
      textDecoration={element.underline ? "underline" : ""}
    />
  );
}
