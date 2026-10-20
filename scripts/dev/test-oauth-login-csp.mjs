/**
 * Browser regression for the OAuth login page. Local HTTPS only; auth is a dummy
 * handler. Reads the real app Helmet/CORS options and uses the real login router.
 * No credentials, cookies or request bodies are included in test output.
 */
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import https from "node:https";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createAiCoreMcpOAuthLoginRouter, OAUTH_LOGIN_PATH, OAUTH_LOGIN_SCRIPT_PATH } from "../../artifacts/api-server/src/routes/ai-core-mcp-oauth-login.ts";
import { oauthNavigationCors } from "../../artifacts/api-server/src/middleware/oauthNavigationCors.ts";

const apiRequire = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const express = apiRequire("express"), cors = apiRequire("cors"), helmet = apiRequire("helmet");
const browserRequire = createRequire(path.join(process.env.AI_CORE_TEST_BROWSER_PACKAGES ??
  fileURLToPath(new URL("../../", import.meta.url)), "package.json"));
const { chromium: playwrightChromium } = browserRequire("playwright");
const chromiumPackage = browserRequire("@sparticuz/chromium");
const chromium = chromiumPackage.default ?? chromiumPackage;
const source = readFileSync(new URL("../../artifacts/api-server/src/app.ts", import.meta.url), "utf8");
const helmetMatch = source.match(/helmet\((\{[\s\S]*?\})\s*\)\s*,?\s*\);/);
const corsMatch = source.match(/origin:\s*(\(origin,\s*callback\)\s*=>\s*\{[\s\S]*?\})\s*,\s*methods:/);
assert.ok(helmetMatch && corsMatch, "Production security option boundaries must be available");
const helmetOptions = vm.runInNewContext("(" + helmetMatch[1] + ")");
const allowedOrigins = [];
const originPolicy = vm.runInNewContext("(" + corsMatch[1] + ")", {
  allowedOrigins, process: { env: { NODE_ENV: "production" } },
});
const fixture = mkdtempSync(path.join(tmpdir(), "aicore-login-csp-"));
const key = path.join(fixture, "key.pem"), cert = path.join(fixture, "cert.pem");
assert.equal(spawnSync("openssl", ["req", "-x509", "-nodes", "-newkey", "rsa:2048",
  "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" }).status, 0);

const observed = [];
let authCount = 0, authStatus = 200, delayResponse = false;
const app = express(); app.set("env", "production");
app.use(helmet(helmetOptions));
app.use((req, _res, next) => {
  if (req.method === "POST") observed.push({
    path: req.path, method: req.method, origin: req.headers.origin,
    site: req.headers["sec-fetch-site"], mode: req.headers["sec-fetch-mode"],
    dest: req.headers["sec-fetch-dest"], hasQuery: req.url.includes("?"),
  });
  next();
});
app.use(oauthNavigationCors(cors({ origin: originPolicy, credentials: true })));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(createAiCoreMcpOAuthLoginRouter(async () => null));
app.post(["/api/internal/auth/login", "/api/internal/auth/request-magic-link"], async (req, res) => {
  authCount++;
  const parsed = typeof req.body?.email === "string" &&
    (req.path.endsWith("/request-magic-link") || typeof req.body?.password === "string");
  assert.equal(parsed, true, "Dummy auth must receive a parsed form body");
  assert.equal(req.headers.cookie?.includes("synthetic_session=local_fixture"), true);
  if (delayResponse) await new Promise(resolve => setTimeout(resolve, 80));
  res.status(authStatus).json({ dummy: true });
});
const server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, app);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = "https://127.0.0.1:" + server.address().port;
allowedOrigins.push(origin);
const results = [];
let browser;

async function session(options = {}) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, javaScriptEnabled: options.javascript !== false });
  await context.addCookies([{ name: "synthetic_session", value: "local_fixture", url: origin, secure: true }]);
  const page = await context.newPage();
  const violations = [];
  page.on("console", message => {
    if (/Content Security Policy/i.test(message.text())) violations.push(true);
  });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || (options.blockScript && url.pathname === OAUTH_LOGIN_SCRIPT_PATH)) return route.abort();
    return route.continue();
  });
  const response = await page.goto(origin + OAUTH_LOGIN_PATH);
  assert.equal(response.status(), 200);
  assert.match(response.headers()["content-security-policy"], /script-src 'self' https:\/\/ajax\.googleapis\.com/);
  assert.doesNotMatch(response.headers()["content-security-policy"], /script-src[^;]*'unsafe-inline'/);
  return { context, page, violations };
}
async function fillPassword(page) {
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.test");
  await page.getByLabel("Password", { exact: true }).fill("synthetic_fixture_value");
}
function exactFetch(post, expectedPath) {
  assert.deepEqual(post, { path: expectedPath, method: "POST", origin,
    site: "same-origin", mode: "cors", dest: "empty", hasQuery: false });
}
async function check(name, operation) {
  observed.length = 0; authCount = 0; authStatus = 200; delayResponse = false;
  await operation(); results.push(name);
}
try {
  browser = await playwrightChromium.launch({
    headless: true, executablePath: await chromium.executablePath(), args: ["--no-sandbox"],
  });
  for (const keyboard of [false, true]) await check(keyboard ? "password Enter submit" : "password click submit", async () => {
    const { context, page, violations } = await session();
    try {
      await fillPassword(page);
      const wait = page.waitForResponse(response => new URL(response.url()).pathname === "/api/internal/auth/login");
      if (keyboard) await page.getByLabel("Password", { exact: true }).press("Enter");
      else await page.getByRole("button", { name: "Masuk", exact: true }).click();
      assert.equal((await wait).status(), 200);
      await page.waitForFunction(() => document.getElementById("login-status").textContent.startsWith("Login berhasil"));
      assert.equal(new URL(page.url()).pathname, OAUTH_LOGIN_PATH);
      assert.equal(authCount, 1); assert.equal(observed.length, 1); exactFetch(observed[0], "/api/internal/auth/login");
      assert.equal(violations.length, 0);
    } finally { await context.close(); }
  });
  await check("magic-link Enter submit", async () => {
    const { context, page, violations } = await session();
    try {
      const field = page.getByLabel("Email akun AI Core", { exact: true });
      await field.fill("synthetic@example.test");
      const wait = page.waitForResponse(response => new URL(response.url()).pathname === "/api/internal/auth/request-magic-link");
      await field.press("Enter"); assert.equal((await wait).status(), 200);
      await page.waitForFunction(() => document.getElementById("magic-status").textContent.startsWith("Jika akun aktif"));
      assert.equal(new URL(page.url()).pathname, OAUTH_LOGIN_PATH);
      assert.equal(authCount, 1); assert.equal(observed.length, 1); exactFetch(observed[0], "/api/internal/auth/request-magic-link");
      assert.equal(violations.length, 0);
    } finally { await context.close(); }
  });
  await check("HTTP failure remains in the form", async () => {
    authStatus = 401;
    const { context, page } = await session();
    try {
      await fillPassword(page); await page.getByLabel("Password", { exact: true }).press("Enter");
      await page.waitForFunction(() => document.getElementById("login-status").textContent.startsWith("Login gagal"));
      assert.equal(new URL(page.url()).pathname, OAUTH_LOGIN_PATH);
      assert.equal(await page.getByRole("button", { name: "Masuk", exact: true }).isEnabled(), true);
      assert.equal(authCount, 1);
    } finally { await context.close(); }
  });
  await check("pending submission cannot duplicate", async () => {
    delayResponse = true;
    const { context, page } = await session();
    try {
      await fillPassword(page);
      await page.evaluate(() => { const form = document.getElementById("mcp-login-form"); form.requestSubmit(); form.requestSubmit(); });
      await page.waitForFunction(() => document.getElementById("login-status").textContent.startsWith("Login berhasil"));
      assert.equal(authCount, 1); assert.equal(observed.length, 1);
    } finally { await context.close(); }
  });
  for (const blocked of [true, false]) await check(blocked ? "blocked asset has no native fallback" : "disabled JavaScript has no native fallback", async () => {
    const { context, page } = await session(blocked ? { blockScript: true } : { javascript: false });
    try {
      assert.equal(await page.getByLabel("Email", { exact: true }).isDisabled(), true);
      assert.equal(await page.getByLabel("Password", { exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "Masuk", exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "Kirim tautan login ke email", exact: true }).isDisabled(), true);
      await page.keyboard.press("Enter");
      assert.equal(new URL(page.url()).pathname, OAUTH_LOGIN_PATH);
      assert.equal(authCount, 0); assert.equal(observed.length, 0);
    } finally { await context.close(); }
  });
  await check("opaque Origin remains rejected before auth", async () => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const response = await context.request.post(origin + "/api/internal/auth/login", {
        headers: { Origin: "null", "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" },
        form: {},
      });
      assert.equal(response.status(), 500);
      assert.equal((await response.body()).length, 148);
      assert.equal(response.headers()["content-security-policy"], "default-src 'none'");
      assert.equal(authCount, 0);
    } finally { await context.close(); }
  });
  await check("a query-bearing auth action remains disabled", async () => {
    const { context, page } = await session();
    try {
      await page.route("**" + OAUTH_LOGIN_PATH, async route => {
        const response = await route.fetch();
        const html = (await response.text()).replace('action="/api/internal/auth/login"', 'action="/api/internal/auth/login?unexpected=1"');
        await route.fulfill({ response, body: html });
      });
      await page.reload();
      await page.waitForFunction(() => document.getElementById("login-status").textContent.startsWith("Formulir belum siap"));
      assert.equal(await page.getByLabel("Password", { exact: true }).isDisabled(), true);
      assert.equal(authCount, 0); assert.equal(observed.length, 0);
    } finally { await context.close(); }
  });
  console.log(JSON.stringify({ result: "PASS", browser: browser.version(), tests: results.length, cases: results }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  rmSync(fixture, { recursive: true, force: true });
}

