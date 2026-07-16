/**
 * Factory functions for creating new elements with sensible defaults.
 * Canvas center is passed to place elements in the middle of the visible area.
 */

import type {
  TextElement,
  ImageElement,
  ShapeElement,
  QrCodeElement,
  LineElement,
  DesignElement,
} from "../../state/design-editor/types";
import { ELEMENT_DEFAULTS } from "./constants";

function genId(): string {
  return `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function center(canvasW: number, canvasH: number, w: number, h: number) {
  return {
    x: Math.round(canvasW / 2 - w / 2),
    y: Math.round(canvasH / 2 - h / 2),
  };
}

export function createTextElement(canvasW: number, canvasH: number, nextZ: number): TextElement {
  const { width, height } = ELEMENT_DEFAULTS.text;
  return {
    ...center(canvasW, canvasH, width, height),
    id: genId(),
    type: "text",
    name: "Text",
    width,
    height,
    zIndex: nextZ,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    content: "New Text",
    fontFamily: "Inter",
    fontSize: 24,
    fontWeight: 400,
    color: "#000000",
    textAlign: "left",
    lineHeight: 1.4,
    overflow: "wrap",
  };
}

export function createImageElement(canvasW: number, canvasH: number, nextZ: number): ImageElement {
  const { width, height } = ELEMENT_DEFAULTS.image;
  return {
    ...center(canvasW, canvasH, width, height),
    id: genId(),
    type: "image",
    name: "Image",
    width,
    height,
    zIndex: nextZ,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    objectFit: "cover",
    borderRadius: 0,
  };
}

export function createShapeElement(
  canvasW: number,
  canvasH: number,
  nextZ: number,
  shape: "rectangle" | "circle" | "rounded-rectangle" = "rectangle",
): ShapeElement {
  const { width, height } = ELEMENT_DEFAULTS.shape;
  return {
    ...center(canvasW, canvasH, width, height),
    id: genId(),
    type: "shape",
    name: shape === "circle" ? "Circle" : shape === "rounded-rectangle" ? "Rounded Rect" : "Rectangle",
    width: shape === "circle" ? height : width,
    height,
    zIndex: nextZ,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    shape,
    fill: "#7C6EFA",
    borderRadius: shape === "rounded-rectangle" ? 12 : shape === "circle" ? height / 2 : 0,
  };
}

export function createQrElement(canvasW: number, canvasH: number, nextZ: number): QrCodeElement {
  const { width, height } = ELEMENT_DEFAULTS.qrcode;
  return {
    ...center(canvasW, canvasH, width, height),
    id: genId(),
    type: "qrcode",
    name: "QR Code",
    width,
    height,
    zIndex: nextZ,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    content: "https://example.com",
    fgColor: "#000000",
    bgColor: "#ffffff",
    errorLevel: "M",
  };
}

export function createLineElement(canvasW: number, canvasH: number, nextZ: number): LineElement {
  const { width, height } = ELEMENT_DEFAULTS.line;
  return {
    ...center(canvasW, canvasH, width, height),
    id: genId(),
    type: "line",
    name: "Line",
    width,
    height,
    zIndex: nextZ,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    stroke: "#000000",
    strokeWidth: 2,
  };
}

export function nextZIndexFromList(elements: DesignElement[]): number {
  if (elements.length === 0) return 1;
  return Math.max(...elements.map((e) => e.zIndex)) + 1;
}
