const sessionId = "7cb3f3a4-04d8-47b0-8c28-4e87c3c187b0";
let session;
let alternatives = [];
let selectedId = "";
let zoom = 1;
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
const drawFurniture = (items) => {
  const layer = $("#furnitureLayer");
  layer.innerHTML = "";
  const scaleX = 600 / session.roomTemplate.width;
  const scaleY = 450 / session.roomTemplate.depth;
  items.forEach((item) => {
    const el = document.createElement("div");
    el.className = `furniture ${item.locked || item.manual ? "locked" : ""}`;
    el.dataset.id = item.id;
    el.style.left = `${item.x * scaleX}px`;
    el.style.top = `${item.y * scaleY}px`;
    el.style.width = `${item.width * scaleX}px`;
    el.style.height = `${item.depth * scaleY}px`;
    el.style.background = item.color;
    el.innerHTML = `<span>${item.name}</span>${item.clearanceZone ? '<i class="clearance"></i>' : ""}`;
    el.addEventListener("click", () => {
      document.querySelectorAll(".furniture").forEach((node) => node.classList.remove("selected"));
      el.classList.add("selected");
      showToast(`${item.name}${item.locked || item.manual ? " · locked in place" : " · editable placement"}`);
    });
    layer.appendChild(el);
  });
};
const renderAlternatives = () => {
  const container = $("#alternatives");
  container.innerHTML = alternatives.map((alternative, index) => `
    <div class="alternative ${alternative.id === selectedId ? "selected" : ""}" data-id="${alternative.id}">
      <div class="alt-head"><span class="alt-name">${strategyLabel(alternative.strategy)}${index === 0 ? " · Recommended" : ""}</span><span class="alt-score">${alternative.score}</span></div>
      <div class="alt-meta">${alternative.valid ? "All hard rules pass" : `${alternative.hardRules.length} hard rule${alternative.hardRules.length > 1 ? "s" : ""} need attention`} · ${alternative.warnings.length} soft warning${alternative.warnings.length === 1 ? "" : "s"}</div>
      <div class="mini-bars"><i style="width:${alternative.score}%"></i></div>
    </div>`).join("");
  container.querySelectorAll(".alternative").forEach((el) => el.addEventListener("click", () => selectAlternative(el.dataset.id)));
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
  const alternative = alternatives.find((entry) => entry.id === id);
  renderAlternatives();
  renderRules(alternative);
  drawFurniture(alternative.items);
};
const loadPreview = async (items = undefined) => {
  try {
    const body = { maxAlternatives: 3 };
    if (items) body.items = items;
    const data = await api(`/api/ai/layout-sessions/${sessionId}/suggest-placement`, { method: "POST", body: JSON.stringify(body) });
    alternatives = data.alternatives;
    selectedId = alternatives[0]?.id || "";
    renderAlternatives();
    selectAlternative(selectedId);
  } catch (error) { showToast(error.message, true); }
};
const init = async () => {
  try {
    session = await api(`/api/ai/layout-sessions/${sessionId}`);
    $("#lockedCount").textContent = `${session.placements.filter((item) => item.locked || item.manual).length} locked item`;
    await loadPreview();
  } catch (error) { showToast(error.message, true); }
};
$("#applyBtn").addEventListener("click", async () => {
  const candidate = alternatives.find((entry) => entry.id === selectedId);
  if (!candidate) return;
  if (!candidate.valid) return showToast("This alternative has hard-rule violations.", true);
  try {
    await api(`/api/ai/layout-sessions/${sessionId}/apply-placement`, { method: "POST", body: JSON.stringify({ candidateId: candidate.id }) });
    session.placements = candidate.items;
    showToast("Placement applied to revision 13");
  } catch (error) { showToast(error.message, true); }
});
$("#resetBtn").addEventListener("click", () => loadPreview());
$("#zoomIn").addEventListener("click", () => { zoom = Math.min(1.2, zoom + .1); $("#canvas").style.transform = `scale(${zoom})`; $("#zoomValue").textContent = `${Math.round(zoom * 100)}%`; });
$("#zoomOut").addEventListener("click", () => { zoom = Math.max(.8, zoom - .1); $("#canvas").style.transform = `scale(${zoom})`; $("#zoomValue").textContent = `${Math.round(zoom * 100)}%`; });
init();