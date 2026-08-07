import { MAX_ALTERNATIVES, MAX_ITEMS } from "./placement.mjs";

export const PlacementRuleType = Object.freeze([
  "HR-1", "HR-2", "HR-3", "HR-4", "HR-5", "HR-6", "HR-7", "HR-8",
  "SR-1", "SR-2", "SR-3", "SR-4", "SR-5", "SR-6"
]);
export const PlacementRuleSeverity = Object.freeze(["hard", "soft"]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value) => typeof value === "string" && UUID_PATTERN.test(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);

export function validateItem(item, index = 0) {
  const errors = [];
  if (!item || typeof item !== "object") return [`items[${index}] must be an object.`];
  if (!isUuid(item.id)) errors.push(`items[${index}].id must be a UUID.`);
  for (const field of ["x", "y", "width", "depth", "height", "rotation"]) {
    if (!finite(item[field])) errors.push(`items[${index}].${field} must be finite.`);
  }
  for (const field of ["width", "depth", "height"]) {
    if (finite(item[field]) && item[field] <= 0) errors.push(`items[${index}].${field} must be positive.`);
  }
  if (item.clearanceZone !== undefined) {
    if (!item.clearanceZone || !finite(item.clearanceZone.x) || !finite(item.clearanceZone.y) ||
        item.clearanceZone.x < 0 || item.clearanceZone.y < 0) {
      errors.push(`items[${index}].clearanceZone must contain non-negative finite x/y values.`);
    }
  }
  return errors;
}

export function validatePlacementRequest(body = {}) {
  const errors = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) return ["Request body must be an object."];
  if (body.sessionId !== undefined && !isUuid(body.sessionId)) errors.push("sessionId must be a UUID.");
  if (body.roomTemplateId !== undefined && !isUuid(body.roomTemplateId)) errors.push("roomTemplateId must be a UUID.");
  if (body.maxAlternatives !== undefined &&
      (!Number.isInteger(body.maxAlternatives) || body.maxAlternatives < 1 || body.maxAlternatives > MAX_ALTERNATIVES)) {
    errors.push(`maxAlternatives must be between 1 and ${MAX_ALTERNATIVES}.`);
  }
  if (body.maxItems !== undefined &&
      (!Number.isInteger(body.maxItems) || body.maxItems < 1 || body.maxItems > MAX_ITEMS)) {
    errors.push(`maxItems must be between 1 and ${MAX_ITEMS}.`);
  }
  if (body.deadline !== undefined &&
      (!Number.isInteger(body.deadline) || body.deadline < 1 || body.deadline > 30_000)) {
    errors.push("deadline must be an integer between 1 and 30000 milliseconds.");
  }
  if (body.items !== undefined) {
    if (!Array.isArray(body.items)) errors.push("items must be an array.");
    else {
      if (body.items.length > MAX_ITEMS) errors.push(`items must contain at most ${MAX_ITEMS} furniture items.`);
      body.items.forEach((item, index) => errors.push(...validateItem(item, index)));
    }
  }
  for (const field of ["clearance", "wallGap", "minimumSpacing"]) {
    if (body[field] !== undefined && (!finite(body[field]) || body[field] < 0)) {
      errors.push(`${field} must be a non-negative finite number.`);
    }
  }
  return errors;
}

/**
 * These JSDoc contracts are the shared wire shapes until the host repository's
 * TypeScript/Zod package is available. Runtime validation is kept in one place.
 * @typedef {{code: string, severity: "hard"|"soft", message: string, itemIds: string[]}} PlacementRuleResult
 * @typedef {{id: string, strategy: string, items: object[], valid: boolean, hardRules: PlacementRuleResult[], warnings: string[], score: number, scoring: object[], lockedItemIds: string[]}} PlacementCandidate
 * @typedef {{sessionId?: string, roomTemplateId?: string, items?: object[], preferredZones?: object[], excludedZones?: object[], clearance?: number, maxAlternatives?: number, maxItems?: number, deadline?: number}} PlacementPreviewRequest
 * @typedef {{sessionId: string, previewOnly: true, alternatives: PlacementCandidate[], generatedAt: string}} PlacementPreviewResponse
 * @typedef {{sessionId?: string, candidateId: string}} PlacementApplyRequest
 * @typedef {{sessionId: string, applied: boolean, idempotent?: boolean, revision: number, placements: object[]}} PlacementApplyResponse
 */