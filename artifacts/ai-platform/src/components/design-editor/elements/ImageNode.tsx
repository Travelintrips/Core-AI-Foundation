import { useEffect, useRef, useState } from "react";
import { Image as KonvaImage, Rect, Text } from "react-konva";
import type Konva from "konva";
import type { ImageElement, VariableBinding } from "@/state/design-editor/types";

interface Props {
  element: ImageElement;
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

function resolveUrl(
  src: ImageElement["src"],
  sampleData: Record<string, string | number | boolean | null>,
): string | null {
  if (!src) return null;
  if ("binding" in src) {
    const val = sampleData[(src as any).binding.variableKey];
    return typeof val === "string" ? val : null;
  }
  if (src.type === "url") return src.url;
  if (src.type === "storage") return src.url ?? null;
  return null;
}

export function ImageNode({ element, sampleData = {}, ...props }: Props) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  const url = resolveUrl(element.src, sampleData);

  useEffect(() => {
    if (!url) { setImg(null); return; }
    // Never load data: URIs — only HTTPS/relative URLs
    if (url.startsWith("data:")) { setImg(null); return; }
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.src = url;
    image.onload = () => { imageRef.current = image; setImg(image); };
    image.onerror = () => setImg(null);
    return () => { image.src = ""; };
  }, [url]);

  if (!img) {
    // Placeholder
    return (
      <>
        <Rect
          {...props}
          fill="#2a2a4a"
          stroke="#7C6EFA"
          strokeWidth={1}
          dash={[6, 3]}
          cornerRadius={element.borderRadius ?? 0}
        />
        <Text
          x={props.x + 4}
          y={props.y + props.height / 2 - 8}
          width={props.width - 8}
          text="🖼 Image"
          fontSize={13}
          fill="#7C6EFA"
          align="center"
          listening={false}
        />
      </>
    );
  }

  return (
    <KonvaImage
      {...props}
      image={img}
      cornerRadius={element.borderRadius ?? 0}
    />
  );
}
