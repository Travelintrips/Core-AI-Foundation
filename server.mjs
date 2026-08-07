import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { generateCandidates, evaluateHardRules, validatePlacementRequest, MAX_ITEMS } from "./lib/placement.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const sessionId = "7cb3f3a4-04d8-47b0-8c28-4e87c3c187b0";
const tenantId = "tenant-atelier";

const room = { id: "room-template-living-01", name: "Sonder living room", width: 6.4, depth: 4.8, defaultClearance: 0.35 };
const initialItems = [
  { id: "sofa-01", name: "Cloud sofa", category: "Seating", color: "#C47B5A", x: 0.55, y: 0.55, width: 2.45, depth: 0.92, height: 0.78, rotation: 0, locked: true, manual: true, clearanceZone: { x: 0.18, y: 0.28 } },
  { id: "table-01", name: "Low oak table", category: "Table", color: "#D7B47D", x: 2.85, y: 1.7, width: 1.35, depth: 0.72, height: 0.42, rotation: 0, locked: false, manual: false, clearanceZone: { x: 0.2, y: 0.2 } },
  { id: "chair-01", name: "Bouclé lounge chair", category: "Seating", color: "#7D9A91", x: 4.5, y: 2.9, width: 0.88, depth: 0.88, height: 0.82, rotation: 0, locked: false, manual: false, clearanceZone: { x: 0.18, y: 0.18 } },
  { id: "plant-01", name: "Olive tree", category: "Decor", color: "#9AA866", x: 5.35, y: 0.62, width: 0.58, depth: 0.58, height: 1.65, rotation: 0, locked: false, manual: false }
];
const state = {
  tenantId,
  sessionId,
  status: "revision",
  revision: 12,
  approvedSnapshot: null,
  placements: structuredClone(initialItems),
  lastAppliedAt: null
};

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function error(res, status, code, message, details = []) {
  json(res, status, { error: { code, message, details } });
}

async function bodyOf(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (Buffer.concat(chunks).length > 100_000) throw new Error("PAYLOAD_TOO_LARGE");
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sessionView() {
  return {
    sessionId: state.sessionId,
    tenantId: state.tenantId,
    roomTemplate: room,
    status: state.status,
    revision: state.revision,
    placements: state.placements,
    approvedSnapshot: state.approvedSnapshot,
    lastAppliedAt: state.lastAppliedAt
  };
}

function authorized(req) {
  return req.headers["x-admin-role"] === "admin";
}

async function api(req, res, pathname) {
  const match = pathname.match(/^\/api\/ai\/layout-sessions\/([^/]+)(?:\/(suggest-placement|apply-placement))?$/);
  if (!match) return false;
  if (!authorized(req)) {
    error(res, 401, "ADMIN_REQUIRED", "Admin access is required for placement operations.");
    return true;
  }
  if (match[1] !== sessionId) {
    error(res, 404, "SESSION_NOT_FOUND", "Layout session was not found in this tenant.");
    return true;
  }
  if (!match[2] && req.method === "GET") {
    json(res, 200, sessionView());
    return true;
  }
  if (req.method !== "POST" || !match[2]) {
    error(res, 405, "METHOD_NOT_ALLOWED", "Use GET for a session or POST for a placement action.");
    return true;
  }
  let body;
  try {
    body = await bodyOf(req);
  } catch (err) {
    error(res, err.message === "PAYLOAD_TOO_LARGE" ? 413 : 400, "INVALID_JSON", "The request payload is invalid or too large.");
    return true;
  }
  const validationErrors = validatePlacementRequest(body);
  if (validationErrors.length) {
    error(res, 422, "VALIDATION_ERROR", "Placement request failed validation.", validationErrors);
    return true;
  }
  if (body.tenantId && body.tenantId !== tenantId) {
    error(res, 404, "SESSION_NOT_FOUND", "Layout session was not found in this tenant.");
    return true;
  }
  const requestedItems = body.items || state.placements;
  if (!Array.isArray(requestedItems) || requestedItems.length > MAX_ITEMS) {
    error(res, 422, "CAPACITY_EXCEEDED", `At most ${MAX_ITEMS} items can be placed.`);
    return true;
  }
  const candidates = generateCandidates(room, requestedItems, body);
  if (match[2] === "suggest-placement") {
    json(res, 200, { sessionId, previewOnly: true, alternatives: candidates, generatedAt: new Date().toISOString() });
    return true;
  }
  if (state.status === "approved_for_rendering") {
    error(res, 409, "SNAPSHOT_APPROVED", "Approved rendering snapshots are immutable. Create a new revision to apply placement.");
    return true;
  }
  const candidate = candidates.find((entry) => entry.id === body.candidateId) || (body.candidate ? body.candidate : null);
  if (!candidate || !Array.isArray(candidate.items)) {
    error(res, 422, "CANDIDATE_REQUIRED", "Select a preview candidate before applying placement.");
    return true;
  }
  const lockedIds = new Set(state.placements.filter((item) => item.locked || item.manual).map((item) => item.id));
  const attemptedLockedChange = [...lockedIds].some((id) => {
    const current = state.placements.find((item) => item.id === id);
    const next = candidate.items.find((item) => item.id === id);
    return !next || current.x !== next.x || current.y !== next.y || current.rotation !== next.rotation;
  });
  if (attemptedLockedChange) {
    error(res, 422, "LOCKED_PLACEMENT_CHANGE", "Locked or manually positioned furniture cannot be moved.");
    return true;
  }
  const hardRules = evaluateHardRules(room, candidate.items, body);
  if (hardRules.length) {
    error(res, 422, "HARD_RULE_VIOLATION", "This candidate violates hard placement rules.", hardRules);
    return true;
  }
  state.placements = structuredClone(candidate.items);
  state.revision += 1;
  state.lastAppliedAt = new Date().toISOString();
  json(res, 200, { sessionId, applied: true, revision: state.revision, placements: state.placements });
  return true;
}

const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
async function serve(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    if (await api(req, res, url.pathname)) return;
  }
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = normalize(join(publicDir, requested));
  if (!file.startsWith(publicDir)) return error(res, 403, "FORBIDDEN", "Forbidden.");
  try {
    const content = await readFile(file);
    res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(content);
  } catch {
    error(res, 404, "NOT_FOUND", "Resource not found.");
  }
}

const server = http.createServer((req, res) => serve(req, res).catch(() => error(res, 500, "INTERNAL_ERROR", "Unexpected server error.")));
server.listen(5000, "0.0.0.0", () => process.stdout.write("WP-06A placement dashboard listening on port 5000\n"));