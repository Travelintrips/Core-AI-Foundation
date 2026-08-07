const finite = (value) => Number.isFinite(value);

export function roomToCanvas(point, room, canvas) {
  if (!point || !room || !canvas || !finite(point.x) || !finite(point.y) || !finite(room.width) || !finite(room.depth) || !finite(canvas.width) || !finite(canvas.height)) {
    throw new TypeError("roomToCanvas requires finite coordinates and dimensions.");
  }
  return {
    x: (point.x / room.width) * canvas.width,
    y: (point.y / room.depth) * canvas.height
  };
}

export function canvasToRoom(point, room, canvas) {
  if (!point || !room || !canvas || !finite(point.x) || !finite(point.y) || !finite(room.width) || !finite(room.depth) || !finite(canvas.width) || !finite(canvas.height)) {
    throw new TypeError("canvasToRoom requires finite coordinates and dimensions.");
  }
  return {
    x: (point.x / canvas.width) * room.width,
    y: (point.y / canvas.height) * room.depth
  };
}

export function itemFootprint(item) {
  const rotated = Math.abs((Number(item.rotation) || 0) % 180) === 90;
  return {
    width: rotated ? item.depth : item.width,
    depth: rotated ? item.width : item.depth
  };
}