// Synthetic browser test: exercises actual inline GPT02 DEV login controller.
// No live Supabase credentials, OTP, token exchange, or network calls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../../deploy/ai-coding-standalone-dev/admin_login.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "inline UI script must exist");

function element() {
  const states = new Set();
  return {
    value: "", textContent: "", disabled: false, children: [],
    focus() {},
    append(...xs) { this.children.push(...xs); },
    replaceChildren(...xs) { this.children = [...xs]; },
    classList: {
      add(x) { states.add(x); },
      remove(x) { states.delete(x); },
      contains(x) { return states.has(x); },
    },
  };
}

async function runCase({ hash = "", initialRefresh = null, rejectUser = false }) {
  const elements = new Map();
  function el(id) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  }
  el("work").classList.add("hidden");
  const calls = [];
  const updates = [];
  const storage = new Map(initialRefresh ? [["dev_refresh", initialRefresh]] : []);
  const location = { hash, pathname: "/gpt02-approval.html", search: "" };
  const history = { replaceState(_state, _name, url) {
    updates.push(url);
    location.hash = "";
  } };
  let refreshCalls = 0;
  const access = "dummy." + Buffer.from(JSON.stringify({ aal: "aal1", sub: "synthetic-admin" })).toString("base64url") + ".sig";
  const fetch = async (url, options = {}) => {
    assert.equal(location.hash, "", "bearer token must be removed before first request");
    calls.push({ url: String(url), options });
    const respond = (body, ok = true) => ({
      ok,
      status: ok ? 200 : 401,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    if (String(url).endsWith("/user"))
      return respond(rejectUser ? { error: "invalid_token" } : { email_confirmed_at: "2026-01-01T00:00:00Z" }, !rejectUser);
    if (String(url).includes("/token?grant_type=refresh_token")) {
      refreshCalls += 1;
      return respond({ access_token: access, refresh_token: "synthetic-refresh-new" });
    }
    if (String(url).endsWith("/api/dashboard"))
      return respond({ jobs_by_status: {}, tasks_by_status: {}, coding_execution_enabled: false });
    if (String(url).endsWith("/api/jobs")) return respond({ jobs: [] });
    if (String(url).endsWith("/api/tasks")) return respond({ tasks: [] });
    if (String(url).endsWith("/api/approvals")) return respond({ approvals: [] });
    if (String(url).endsWith("/api/gpt02/issue159/approval-intent/pending"))
      return respond({ pending: false, reason: "NO_PENDING_REQUEST" });
    throw new Error("UNEXPECTED_FETCH: " + String(url));
  };
  const context = vm.createContext({
    document: { getElementById: el, createElement: () => element() },
    sessionStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    },
    history, location, fetch, URLSearchParams,
    atob: (input) => Buffer.from(input, "base64").toString("binary"),
    confirm: () => false,
  });
  // The last expression in the inline controller is restoreSession().
  await vm.runInContext(script, context, { timeout: 2000 });
  return { elements, el, storage, updates, calls, refreshCalls, access };
}

{
  const token = "dummy." + Buffer.from(JSON.stringify({ aal: "aal1" })).toString("base64url") + ".sig";
  const result = await runCase({
    hash: "#access_token=" + encodeURIComponent(token) + "&refresh_token=magiclink-refresh&type=magiclink",
  });
  assert.deepEqual(result.updates, ["/gpt02-approval.html"]);
  assert.equal(result.refreshCalls, 0, "Magic Link must use its bearer token, not refresh a previous session");
  assert.equal(result.el("loginPanel").classList.contains("hidden"), true);
  assert.equal(result.el("work").classList.contains("hidden"), false);
  assert.equal(result.storage.get("dev_refresh"), "magiclink-refresh");
  assert.ok(result.calls.some(c => c.url.endsWith("/api/dashboard")), "must verify backend admin API");
}
{
  const token = "dummy." + Buffer.from(JSON.stringify({ aal: "aal1" })).toString("base64url") + ".sig";
  const result = await runCase({
    hash: "#access_token=" + encodeURIComponent(token) + "&refresh_token=invalid-refresh",
    rejectUser: true,
  });
  assert.deepEqual(result.updates, ["/gpt02-approval.html"]);
  assert.equal(result.el("loginPanel").classList.contains("hidden"), false);
  assert.equal(result.el("work").classList.contains("hidden"), true);
  assert.equal(result.storage.has("dev_refresh"), false);
  assert.ok(result.el("loginStatus").textContent.includes("gagal diverifikasi"));
}
{
  const result = await runCase({ initialRefresh: "synthetic-old-refresh" });
  assert.equal(result.refreshCalls, 1, "existing refresh-only login must be preserved");
  assert.equal(result.el("loginPanel").classList.contains("hidden"), true);
  assert.equal(result.storage.get("dev_refresh"), "synthetic-refresh-new");
}
console.log("GPT02_DEV_MAGIC_LINK_CALLBACK_BROWSER_SIMULATION_PASS 3/3");
