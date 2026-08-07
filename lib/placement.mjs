export const MAX_ALTERNATIVES = 3;
export const MAX_ITEMS = 50;

const EPSILON = 0.0001;
const SOFT_WEIGHTS = Object.freeze({
  wallAlignment: 22,
  symmetry: 18,
  gridSnap: 14,
  centerOpen: 18,
  balancedQuadrant: 14,
  clearanceInsideRoom: 14
});

const finite = (value) => Number.isFinite(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 100) / 100;

export function footprint(item) {
  const width = Number(item.width);
  const depth = Number(item.depth);
  const rotated = Math.abs((Number(item.rotation) || 0) % 180) === 90;
  return {
    x: Number(item.x),
    y: Number(item.y),
    width: rotated ? depth : width,
    depth: rotated ? width : depth
  };
}

export function intersects(a, b, clearance = 0) {
  const left = Math.max(a.x - clearance, b.x);
  const right = Math.min(a.x + a.width + clearance, b.x + b.width);
  const top = Math.max(a.y - clearance, b.y);
  const bottom = Math.min(a.y + a.depth + clearance, b.y + b.depth);
  return right - left > EPSILON && bottom - top > EPSILON;
}

function pushRule(rules, code, severity, message, itemIds = []) {
  rules.push({ code, severity, message, itemIds });
}

export function evaluateHardRules(room, items, options = {}) {
  const rules = [];
  const clearance = Math.max(0, Number(options.clearance ?? room.defaultClearance ?? 0.35));
  const wallGap = Math.max(0, Number(options.wallGap ?? 0.12));
  const minimumSpacing = Math.max(0, Number(options.minimumSpacing ?? 0.18));
  const activeItems = items.map((item) => ({ ...item, box: footprint(item) }));

  if (!room || !finite(room.width) || !finite(room.depth) || room.width <= 0 || room.depth <= 0) {
    pushRule(rules, "HR-1", "hard", "Room bounds are not valid.");
  }

  for (const item of activeItems) {
    if (![item.box.x, item.box.y, item.box.width, item.box.depth, Number(item.height)].every(finite) ||
        item.box.width <= 0 || item.box.depth <= 0 || Number(item.height) <= 0) {
      pushRule(rules, "HR-2", "hard", `${item.name || "Furniture"} has invalid dimensions.`, [item.id]);
      continue;
    }
    if (item.box.x < -EPSILON || item.box.y < -EPSILON ||
        item.box.x + item.box.width > room.width + EPSILON ||
        item.box.y + item.box.depth > room.depth + EPSILON) {
      pushRule(rules, "HR-1", "hard", `${item.name} is outside the room bounds.`, [item.id]);
    }
    if (item.box.x < wallGap - EPSILON || item.box.y < wallGap - EPSILON ||
        room.width - item.box.x - item.box.width < wallGap - EPSILON ||
        room.depth - item.box.y - item.box.depth < wallGap - EPSILON) {
      pushRule(rules, "HR-5", "hard", `${item.name} violates the minimum wall gap.`, [item.id]);
    }
    if (item.clearanceZone) {
      const zone = { x: item.box.x - item.clearanceZone.x, y: item.box.y - item.clearanceZone.y,
        width: item.box.width + item.clearanceZone.x * 2, depth: item.box.depth + item.clearanceZone.y * 2 };
      if (zone.x < -EPSILON || zone.y < -EPSILON || zone.x + zone.width > room.width + EPSILON || zone.y + zone.depth > room.depth + EPSILON) {
        pushRule(rules, "HR-7", "hard", `${item.name} clearance zone overlaps the room boundary.`, [item.id]);
      }
    }
  }

  for (let i = 0; i < activeItems.length; i += 1) {
    for (let j = i + 1; j < activeItems.length; j += 1) {
      const a = activeItems[i];
      const b = activeItems[j];
      if (intersects(a.box, b.box)) {
        pushRule(rules, "HR-3", "hard", `${a.name} overlaps ${b.name}.`, [a.id, b.id]);
      } else if (intersects(a.box, b.box, minimumSpacing)) {
        pushRule(rules, "HR-6", "hard", `${a.name} and ${b.name} are too close.`, [a.id, b.id]);
      }
      const aClearance = a.clearanceZone ? { x: a.box.x - a.clearanceZone.x, y: a.box.y - a.clearanceZone.y, width: a.box.width + a.clearanceZone.x * 2, depth: a.box.depth + a.clearanceZone.y * 2 } : null;
      const bClearance = b.clearanceZone ? { x: b.box.x - b.clearanceZone.x, y: b.box.y - b.clearanceZone.y, width: b.box.width + b.clearanceZone.x * 2, depth: b.box.depth + b.clearanceZone.y * 2 } : null;
      if ((aClearance && intersects(aClearance, b.box)) || (bClearance && intersects(bClearance, a.box))) {
        pushRule(rules, "HR-4", "hard", `Clearance zone encroachment between ${a.name} and ${b.name}.`, [a.id, b.id]);
      }
    }
  }
  if (activeItems.length > MAX_ITEMS) {
    pushRule(rules, "HR-8", "hard", `Session exceeds the ${MAX_ITEMS}-item capacity.`);
  }
  const unique = new Map();
  for (const rule of rules) unique.set(`${rule.code}:${rule.message}`, rule);
  return [...unique.values()];
}

function distanceToNearestWall(box, room) {
  return Math.min(box.x, box.y, room.width - box.x - box.width, room.depth - box.y - box.depth);
}

export function scoreSoftRules(room, items, options = {}) {
  const safeItems = items.map((item) => ({ ...item, box: footprint(item) }));
  const warnings = [];
  const contributions = [];
  const preferredZones = options.preferredZones || [];
  const centerX = room.width / 2;
  const centerY = room.depth / 2;

  const wallAligned = safeItems.filter(({ box }) => distanceToNearestWall(box, room) <= 0.3).length / Math.max(1, safeItems.length);
  const wallValue = SOFT_WEIGHTS.wallAlignment * wallAligned;
  contributions.push({ rule: "SR-1", label: "Wall alignment", value: round(wallValue), detail: `${Math.round(wallAligned * 100)}% of items align to a wall` });

  const pairs = [];
  for (const item of safeItems) {
    const mirrorX = room.width - item.box.x - item.box.width;
    const nearest = safeItems.filter((other) => other.id !== item.id).reduce((best, other) => {
      const delta = Math.abs(other.box.x - mirrorX) + Math.abs(other.box.y - item.box.y);
      return Math.min(best, delta);
    }, Infinity);
    if (nearest < 1.2) pairs.push(item.id);
  }
  const symmetryValue = SOFT_WEIGHTS.symmetry * (safeItems.length ? pairs.length / safeItems.length : 1);
  contributions.push({ rule: "SR-2", label: "Symmetry", value: round(symmetryValue), detail: `${pairs.length} mirrored relationships found` });

  const gridHits = safeItems.filter(({ box }) => [box.x, box.y].every((value) => Math.abs(value / 0.25 - Math.round(value / 0.25)) < 0.06)).length;
  const gridValue = SOFT_WEIGHTS.gridSnap * (safeItems.length ? gridHits / safeItems.length : 1);
  contributions.push({ rule: "SR-3", label: "Grid snap", value: round(gridValue), detail: `${gridHits}/${safeItems.length || 0} items on the 25 cm grid` });

  const centerOpen = safeItems.some(({ box }) => intersects({ x: centerX - 0.9, y: centerY - 0.9, width: 1.8, depth: 1.8 }, box)) ? 0 : 1;
  const centerValue = SOFT_WEIGHTS.centerOpen * centerOpen;
  contributions.push({ rule: "SR-4", label: "Center open", value: centerValue, detail: centerOpen ? "Central circulation zone is clear" : "Center has an obstruction" });

  const quadrants = [0, 0, 0, 0];
  safeItems.forEach(({ box }) => quadrants[(box.x + box.width / 2 > centerX ? 1 : 0) + (box.y + box.depth / 2 > centerY ? 2 : 0)] += 1);
  const spread = Math.min(...quadrants) / Math.max(1, Math.max(...quadrants));
  const balanceValue = SOFT_WEIGHTS.balancedQuadrant * spread;
  contributions.push({ rule: "SR-5", label: "Balanced quadrant", value: round(balanceValue), detail: `Quadrant distribution ${quadrants.join(" · ")}` });

  const insidePreferred = preferredZones.length === 0 ? 1 : safeItems.filter(({ box }) =>
    preferredZones.some((zone) => box.x >= zone.x && box.y >= zone.y && box.x + box.width <= zone.x + zone.width && box.y + box.depth <= zone.y + zone.depth)
  ).length / safeItems.length;
  const clearanceValue = SOFT_WEIGHTS.clearanceInsideRoom * insidePreferred;
  contributions.push({ rule: "SR-6", label: "Clearance inside room", value: round(clearanceValue), detail: preferredZones.length ? `${Math.round(insidePreferred * 100)}% in preferred zones` : "All preferred zones satisfied" });
  const rawScore = contributions.reduce((sum, contribution) => sum + contribution.value, 0);
  if (centerValue === 0) warnings.push("Central circulation is blocked");
  if (wallValue < SOFT_WEIGHTS.wallAlignment * 0.4) warnings.push("Furniture is not wall-aligned");
  return { score: round(clamp(rawScore, 0, 100)), contributions, warnings };
}

function candidateSlots(item, strategy, room) {
  const gap = 0.22;
  const box = footprint({ ...item, x: 0, y: 0 });
  const slots = [];
  const add = (x, y) => {
    if (x >= gap && y >= gap && x + box.width <= room.width - gap && y + box.depth <= room.depth - gap) {
      slots.push({ ...item, x: round(x), y: round(y), rotation: 0 });
    }
  };
  if (strategy === "WALL_LEFT" || strategy === "WALL_RIGHT") {
    const x = strategy === "WALL_LEFT" ? gap : room.width - box.width - gap;
    for (let y = gap; y <= room.depth - box.depth - gap + EPSILON; y += 0.28) add(x, y);
  } else if (strategy === "WALL_TOP" || strategy === "WALL_BOTTOM") {
    const y = strategy === "WALL_TOP" ? gap : room.depth - box.depth - gap;
    for (let x = gap; x <= room.width - box.width - gap + EPSILON; x += 0.28) add(x, y);
  } else {
    const centerX = (room.width - box.width) / 2;
    const centerY = (room.depth - box.depth) / 2;
    for (let ring = 0; ring <= 5; ring += 1) {
      const offset = ring * 0.42;
      add(centerX - offset, centerY);
      add(centerX + offset, centerY);
      add(centerX, centerY - offset);
      add(centerX, centerY + offset);
    }
  }
  return slots;
}

function buildStrategyPlacement(room, items, strategy, options) {
  const locked = items.filter((item) => item.locked || item.manual);
  const movable = items.filter((item) => !item.locked && !item.manual);
  const placed = [...locked];
  const rejected = [];
  for (const item of movable) {
    const slots = candidateSlots(item, strategy, room);
    const feasible = slots.find((slot) => evaluateHardRules(room, [...placed, slot], options).length === 0);
    const chosen = feasible || slots[0];
    if (!chosen) {
      rejected.push(item);
      continue;
    }
    if (!feasible) rejected.push(item);
    placed.push(chosen);
  }
  const byId = new Map(placed.map((item) => [item.id, item]));
  return items.map((item) => byId.get(item.id) || item);
}

export function generateCandidates(room, items, options = {}) {
  const strategies = ["WALL_LEFT", "WALL_RIGHT", "WALL_TOP", "WALL_BOTTOM", "CENTER"];
  const maxAlternatives = clamp(Math.floor(options.maxAlternatives ?? MAX_ALTERNATIVES), 1, MAX_ALTERNATIVES);
  const locked = items.filter((item) => item.locked || item.manual);
  const movable = items.filter((item) => !item.locked && !item.manual);
  const candidates = [];
  strategies.forEach((strategy, strategyIndex) => {
    const next = buildStrategyPlacement(room, items, strategy, options);
    const hardRules = evaluateHardRules(room, next, options);
    const soft = scoreSoftRules(room, next, options);
    candidates.push({
      id: `alternative-${strategy.toLowerCase()}`,
      strategy,
      items: next,
      valid: hardRules.length === 0,
      hardRules,
      warnings: soft.warnings,
      score: soft.score,
      scoring: soft.contributions,
      lockedItemIds: locked.map((item) => item.id),
      tieBreaker: strategyIndex
    });
  });
  return candidates
    .sort((a, b) => Number(b.valid) - Number(a.valid) || b.score - a.score || a.hardRules.length - b.hardRules.length || a.tieBreaker - b.tieBreaker)
    .slice(0, maxAlternatives)
    .map(({ tieBreaker, ...candidate }) => candidate);
}

export function validatePlacementRequest(body) {
  const errors = [];
  if (!body || typeof body !== "object") errors.push("Request body must be an object.");
  if (body?.maxAlternatives !== undefined && (!Number.isInteger(body.maxAlternatives) || body.maxAlternatives < 1 || body.maxAlternatives > MAX_ALTERNATIVES)) errors.push(`maxAlternatives must be between 1 and ${MAX_ALTERNATIVES}.`);
  if (body?.items && (!Array.isArray(body.items) || body.items.length > MAX_ITEMS)) errors.push(`items must contain at most ${MAX_ITEMS} furniture items.`);
  return errors;
}