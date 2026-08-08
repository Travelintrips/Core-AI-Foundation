export interface CoordinatePoint {
  x: number;
  y: number;
}

export interface CoordinateDimensions {
  width: number;
  height: number;
}

export interface CoordinatePan {
  x: number;
  y: number;
}

export interface CoordinateTransform {
  scale: number;
  roomToCanvas(point: CoordinatePoint): CoordinatePoint;
  canvasToRoom(point: CoordinatePoint): CoordinatePoint;
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
}

function assertFinitePoint(point: CoordinatePoint, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${label} coordinates must be finite.`);
  }
}

export function createCoordinateTransform(
  room: CoordinateDimensions,
  canvas: CoordinateDimensions,
  zoom = 1,
  pan: CoordinatePan = { x: 0, y: 0 },
): CoordinateTransform {
  assertPositiveFinite(room.width, "Room width");
  assertPositiveFinite(room.height, "Room height");
  assertPositiveFinite(canvas.width, "Canvas width");
  assertPositiveFinite(canvas.height, "Canvas height");
  assertPositiveFinite(zoom, "Zoom");
  assertFinitePoint(pan, "Pan");

  const scale = Math.min(canvas.width / room.width, canvas.height / room.height);
  assertPositiveFinite(scale, "Coordinate scale");

  return {
    scale,
    roomToCanvas(point) {
      assertFinitePoint(point, "Room");
      return {
        x: pan.x + point.x * scale * zoom,
        y: pan.y + point.y * scale * zoom,
      };
    },
    canvasToRoom(point) {
      assertFinitePoint(point, "Canvas");
      return {
        x: (point.x - pan.x) / (scale * zoom),
        y: (point.y - pan.y) / (scale * zoom),
      };
    },
  };
}