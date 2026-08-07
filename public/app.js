import { roomToCanvas, canvasToRoom, itemFootprint } from "./coordinates.js";

const sessionId = "7cb3f3a4-04d8-47b0-8c28-4e87c3c187b0";
const canvasSize = { width: 600, height: 450 };
let session;
let alternatives = [];
let selectedId = "";
let state = {
  serverPlacements: [],
  previewPlacements: [],
  alternativeBasePlacements: [],
  selectedItemId: "",
  selectedAlternativeId: "",
  manualDirty: false,
  view: { zoom: 1, panX: 0, panY: 0 },
  dragging: null,
  readOnly: false
};
const $ = (selector) => document.querySelector(selector);
const api = async (path, options = {}) => {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", "x-admin-role": "admin", ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Request failed");
  return data;
};
const showToast = (message, error = false) => {
  const toast = $("#toast");
  toast.textContent = message;
  toast.style.background = error ? "#8b4d3d" : "#27372b";
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
};
const strategyLabel = (strategy) => strategy.replace("WALL_", "Wall ").replace("CENTER", "Center").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const currentItem = () => state.previewPlacements.find((item) => item.id === state.selectedItemId);
const isProtected = (item) => Boolean(item?.locked || item?.manual);
const setDirty = (dirty) => {
  state.manualDirty = dirty;
  $("#dirtyPill").hidden = !dirty;
  $("#resetBtn").textContent = dirty ? "Reset changes" : "Reset preview";
};
const renderView = () => {
  const { zoom: scale, panX, panY } = state.view;
  $("#canvas").style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  $("#zoomValue").textContent = `${Math.round(scale * 100)}%`;
};
const selectItem = (id) => {
  state.selectedItemId = id;
  document.querySelectorAll(".furniture").forEach((node) => node.classList.toggle("selected", node.dataset.id === id));
  renderInspector();
};
const renderInspector = () => {
  const item = currentItem();
  if (!item) {
    $("#selectedName").textContent = "Select furniture";
    $("#selectedType").textContent = "—";
    $("#selectedPosition").textContent = "—";
    $("#selectedFootprint").textContent = "—";
    $("#selectedRotation").textContent = "—";
    $("#selectedState").textContent = "—";
    $("#selectionHint").textContent = "Click an item on the canvas to edit its preview position.";
    $("#rotateBtn").disabled = true;
    $("#lockBtn").disabled = true;
    return;
  }
  const footprint = itemFootprint(item);
  $("#selectedName").textContent = item.name;
  $("#selectedType").textContent = item.category || "Furniture";
  $("#selectedPosition").textContent = `${item.x.toFixed(2)}m, ${item.y.toFixed(2)}m`;
  $("#selectedFootprint").textContent = `${footprint.width.toFixed(2)} × ${footprint.depth.toFixed(2)}m`;
  $("#selectedRotation").textContent = `${((item.rotation || 0) + 360) % 360}°`;
  $("#selectedState").textContent = isProtected(item) ? "Locked" : "Editable";
  $("#selectionHint").textContent = isProtected(item) ? "This item is protected from drag and rotation." : "Drag, rotate, or use arrow keys to adjust the preview.";
  $("#rotateBtn").disabled = state.readOnly || isProtected(item);
  $("#lockBtn").disabled = state.readOnly;
  $("#lockBtn").textContent = isProtected(item) ? "⌑ Unlock" : "⌑ Lock";
};
const localViolationIds = (items) => new Set(items.filter((item) => {
  const box = itemFootprint(item);
  return item.x < 0 || item.y < 0 || item.x + box.width > session.roomTemplate.width || item.y + box.depth > session.roomTemplate.depth;
}).map((item) => item.id));
const drawFurniture = (items) => {
  const layer = $("#furnitureLayer");
  layer.innerHTML = "";
  const violationIds = localViolationIds(items);
  items.forEach((item) => {
    const el = document.createElement("div");
    const footprint = itemFootprint(item);
    const selectedAlternative = alternatives.find((entry) => entry.id === state.selectedAlternativeId);
    const serverViolationIds = new Set((selectedAlternative?.hardRules || []).flatMap((rule) => rule.itemIds || []));
    const violation = violationIds.has(item.id) || serverViolationIds.has(item.id);
    el.className = `furniture ${isProtected(item) ? "locked" : ""} ${violation ? "violation" : ""}`;
    el.dataset.id = item.id;
    const point = roomToCanvas({ x: item.x, y: item.y }, session.roomTemplate, canvasSize);
    const size = roomToCanvas({ x: footprint.width, y: footprint.depth }, session.roomTemplate, canvasSize);
    el.style.left = `${point.x}px`;
    el.style.top = `${point.y}px`;
    el.style.width = `${size.x}px`;
    el.style.height = `${size.y}px`;
    el.style.transform = `rotate(${item.rotation || 0}deg)`;
    el.style.background = item.color;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", `${item.name}, ${isProtected(item) ? "locked" : "editable"}${violation ? ", rule violation" : ""}`);
    el.innerHTML = `<span>${item.name}</span>${isProtected(item) ? '<b class="lock-mark" aria-hidden="true">⌑</b>' : ""}${violation ? '<b class="violation-mark" aria-hidden="true">!</b>' : ""}${item.clearanceZone ? '<i class="clearance"></i>' : ""}`;
    el.addEventListener("click", () => {
      selectItem(item.id);
      showToast(`${item.name}${isProtected(item) ? " · locked in place" : " · editable preview"}`);
    });
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectItem(item.id); }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) moveSelected(event.key, event.shiftKey ? 0.25 : 0.05);
    });
    el.addEventListener("pointerdown", (event) => startDrag(event, item));
    layer.appendChild(el);
  });
  selectItem(state.selectedItemId);
  renderInspector();
};
const screenToRoom = (event) => {
  const rect = $("#canvas").getBoundingClientRect();
  return canvasToRoom({ x: (event.clientX - rect.left) / state.view.zoom, y: (event.clientY - rect.top) / state.view.zoom }, session.roomTemplate, canvasSize);
};
const moveSelected = (key, amount) => {
  const item = currentItem();
  if (!item || state.readOnly || isProtected(item)) return;
  if (key === "ArrowUp") item.y -= amount;
  if (key === "ArrowDown") item.y += amount;
  if (key === "ArrowLeft") item.x -= amount;
  if (key === "ArrowRight") item.x += amount;
  item.x = Math.round(item.x * 100) / 100;
  item.y = Math.round(item.y * 100) / 100;
  setDirty(true);
  drawFurniture(state.previewPlacements);
};
const startDrag = (event, item) => {
  event.stopPropagation();
  selectItem(item.id);
  if (state.readOnly || isProtected(item)) {
    showToast(`${item.name} is locked and cannot move`, true);
    return;
  }
  const start = screenToRoom(event);
  state.dragging = { id: item.id, start, x: item.x, y: item.y };
  event.currentTarget.setPointerCapture?.(event.pointerId);
};
const onPointerMove = (event) => {
  if (!state.dragging) return;
  const item = state.previewPlacements.find((entry) => entry.id === state.dragging.id);
  if (!item) return;
  const point = screenToRoom(event);
  item.x = Math.round((state.dragging.x + point.x - state.dragging.start.x) * 100) / 100;
  item.y = Math.round((state.dragging.y + point.y - state.dragging.start.y) * 100) / 100;
  setDirty(true);
  drawFurniture(state.previewPlacements);
};
const stopDrag = () => { state.dragging = null; };
const rotateSelected = () => {
  const item = currentItem();
  if (!item || state.readOnly || isProtected(item)) return;
  item.rotation = ((item.rotation || 0) + 90) % 360;
  setDirty(true);
  drawFurniture(state.previewPlacements);
};
const toggleLock = () => {
  const item = currentItem();
  if (!item || state.readOnly) return;
  const nextLocked = !isProtected(item);
  item.locked = nextLocked;
  item.manual = nextLocked;
  setDirty(true);
  drawFurniture(state.previewPlacements);
};
const renderAlternatives = () => {
  const container = $("#alternatives");
  container.innerHTML = alternatives.map((alternative, index) => `
    <div class="alternative ${alternative.id === selectedId ? "selected" : ""}" data-id="${alternative.id}">
      <div class="alt-head"><span class="alt-name"><em>#${index + 1}</em> ${strategyLabel(alternative.strategy)}${index === 0 ? " · Recommended" : ""}</span><span class="alt-score">${alternative.score}</span></div>
      <div class="alt-meta">${alternative.valid ? "All hard rules pass" : `${alternative.hardRules.length} hard rule${alternative.hardRules.length > 1 ? "s" : ""} need attention`} · ${alternative.warnings.length} soft warning${alternative.warnings.length === 1 ? "" : "s"}</div>
      <div class="mini-bars"><i style="width:${alternative.score}%"></i></div>
      <button class="preview-alt" data-preview="${alternative.id}">Preview</button>
    </div>`).join("");
  container.querySelectorAll(".alternative").forEach((el) => el.addEventListener("click", (event) => {
    if (event.target.closest(".preview-alt")) event.stopPropagation();
    selectAlternative(el.dataset.id);
  }));
  container.querySelectorAll(".preview-alt").forEach((button) => button.addEventListener("click", () => selectAlternative(button.dataset.preview)));
  $("#altCount").textContent = alternatives.length;
};
const renderRules = (alternative) => {
  const rules = alternative?.scoring || [];
  $("#validBadge").textContent = alternative?.valid ? "VALID" : "REVIEW";
  $("#validBadge").style.color = alternative?.valid ? "#597961" : "#a9674f";
  $("#validBadge").style.background = alternative?.valid ? "#edf5ee" : "#faeee9";
  $("#ruleList").innerHTML = rules.map((rule) => `<div class="rule"><span class="rule-icon">${rule.value > 0 ? "✓" : "!"}</span><div><strong>${rule.label}</strong><small>${rule.detail}</small></div><span class="rule-score">+${rule.value}</span></div>`).join("");
  if (alternative?.hardRules?.length) $("#ruleList").insertAdjacentHTML("afterbegin", alternative.hardRules.slice(0, 2).map((rule) => `<div class="rule"><span class="rule-icon" style="background:#faece7;color:#b0674f">!</span><div><strong>${rule.code} · Hard constraint</strong><small>${rule.message}</small></div><span class="rule-score">FAIL</span></div>`).join(""));
};
const selectAlternative = (id) => {
  selectedId = id;
  state.selectedAlternativeId = id;
  const alternative = alternatives.find((entry) => entry.id === id);
  if (!alternative) return;
  renderAlternatives();
  renderRules(alternative);
  state.previewPlacements = structuredClone(alternative.items);
  state.selectedItemId = state.previewPlacements.find((item) => item.id === state.selectedItemId)?.id || state.previewPlacements[0]?.id || "";
  drawFurniture(state.previewPlacements);
};
const loadPreview = async (items = undefined) => {
  try {
    const baseItems = structuredClone(items || state.serverPlacements);
    const body = { maxAlternatives: 3, items: baseItems };
    const data = await api(`/api/ai/layout-sessions/${sessionId}/suggest-placement`, { method: "POST", body: JSON.stringify(body) });
    alternatives = data.alternatives;
    state.alternativeBasePlacements = baseItems;
    selectedId = alternatives[0]?.id || "";
    renderAlternatives();
    selectAlternative(selectedId);
  } catch (error) { showToast(error.message, true); }
};
const init = async () => {
  try {
    session = await api(`/api/ai/layout-sessions/${sessionId}`);
    state.serverPlacements = structuredClone(session.placements);
    state.previewPlacements = structuredClone(session.placements);
    state.readOnly = session.status === "approved_for_rendering";
    $("#lockedCount").textContent = `${session.placements.filter((item) => item.locked || item.manual).length} locked item`;
    $("#revisionLabel").textContent = `REVISION ${session.revision}`;
    if (state.readOnly) {
      $("#immutableNotice").hidden = false;
      $("#modePill").innerHTML = "<i></i> Read-only snapshot";
      $("#applyBtn").disabled = true;
      $("#suggestBtn").disabled = true;
      $("#rotateBtn").disabled = true;
      $("#lockBtn").disabled = true;
    }
    state.selectedItemId = state.previewPlacements[0]?.id || "";
    drawFurniture(state.previewPlacements);
    if (!state.readOnly) await loadPreview(state.serverPlacements);
  } catch (error) { showToast(error.message, true); }
};
$("#applyBtn").addEventListener("click", async () => {
  const candidate = alternatives.find((entry) => entry.id === selectedId);
  if (!candidate) return;
  if (!candidate.valid) return showToast("This alternative has hard-rule violations.", true);
  try {
    const result = await api(`/api/ai/layout-sessions/${sessionId}/apply-placement`, { method: "POST", body: JSON.stringify({ candidateId: candidate.id, items: state.alternativeBasePlacements }) });
    session = await api(`/api/ai/layout-sessions/${sessionId}`);
    state.serverPlacements = structuredClone(session.placements);
    state.previewPlacements = structuredClone(session.placements);
    setDirty(false);
    $("#revisionLabel").textContent = `REVISION ${result.revision}`;
    await loadPreview(state.serverPlacements);
    showToast(result.idempotent ? "Placement already applied" : `Placement applied to revision ${result.revision}`);
  } catch (error) { showToast(error.message, true); }
});
$("#resetBtn").addEventListener("click", () => { state.previewPlacements = structuredClone(state.serverPlacements); setDirty(false); loadPreview(state.serverPlacements); });
$("#suggestBtn").addEventListener("click", () => loadPreview(state.previewPlacements));
$("#rotateBtn").addEventListener("click", rotateSelected);
$("#lockBtn").addEventListener("click", toggleLock);
$("#zoomIn").addEventListener("click", () => { state.view.zoom = Math.min(1.5, state.view.zoom + .1); renderView(); });
$("#zoomOut").addEventListener("click", () => { state.view.zoom = Math.max(.7, state.view.zoom - .1); renderView(); });
$("#resetView").addEventListener("click", () => { state.view = { zoom: 1, panX: 0, panY: 0 }; renderView(); });
$("#canvas").addEventListener("pointerdown", (event) => {
  if (event.target !== $("#canvas")) return;
  state.view.panStart = { x: event.clientX, y: event.clientY, panX: state.view.panX, panY: state.view.panY };
  $("#canvas").setPointerCapture?.(event.pointerId);
});
$("#canvas").addEventListener("pointermove", (event) => {
  if (!state.view.panStart || state.dragging) return;
  state.view.panX = state.view.panStart.panX + event.clientX - state.view.panStart.x;
  state.view.panY = state.view.panStart.panY + event.clientY - state.view.panStart.y;
  renderView();
});
$("#canvas").addEventListener("pointerup", () => { state.view.panStart = null; });
document.addEventListener("pointermove", onPointerMove);
document.addEventListener("pointerup", stopDrag);
window.addEventListener("beforeunload", (event) => { if (state.manualDirty) { event.preventDefault(); event.returnValue = ""; } });
init();