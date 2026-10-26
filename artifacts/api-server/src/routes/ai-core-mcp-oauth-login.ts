import { Router, type Request } from "express";

export const OAUTH_LOGIN_PATH = "/api/ai/core-chat/oauth/login";
export const OAUTH_LOGIN_SCRIPT_PATH = "/api/ai/core-chat/oauth/login-client.js";

/** Public, static client code. Credentials stay in same-origin POST bodies. */
export const OAUTH_LOGIN_CLIENT_SCRIPT = String.raw`"use strict";
(() => {
  function bindForm(formId, fieldsId, statusId, magic) {
    const form = document.getElementById(formId);
    const fields = document.getElementById(fieldsId);
    const status = document.getElementById(statusId);
    if (!(form instanceof HTMLFormElement) || !(fields instanceof HTMLFieldSetElement) || !status) return;
    const endpoint = new URL(form.action, window.location.href);
    const expectedPath = magic ? "/api/internal/auth/request-magic-link" : "/api/internal/auth/login";
    if (form.method.toUpperCase() !== "POST" || endpoint.origin !== window.location.origin ||
        endpoint.pathname !== expectedPath || endpoint.search || endpoint.hash) {
      status.textContent = "Formulir belum siap. Muat ulang halaman ini.";
      return;
    }
    let pending = false;
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (pending) return;
      const body = new URLSearchParams(new FormData(form));
      pending = true;
      fields.disabled = true;
      status.textContent = magic ? "Memproses permintaan..." : "Memeriksa login...";
      try {
        const response = await fetch(endpoint.href, {
          method: "POST",
          mode: "cors",
          body,
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        status.textContent = magic
          ? (response.ok ? "Jika akun aktif terdaftar, link login akan dikirim ke email."
            : "Pengiriman belum berhasil. Coba lagi atau gunakan login password.")
          : (response.ok ? "Login berhasil. Kembali ke halaman approval dan muat ulang."
            : "Login gagal. Periksa email dan password.");
      } catch {
        status.textContent = "Koneksi gagal. Coba lagi.";
      } finally {
        pending = false;
        fields.disabled = false;
      }
    });
    // Enable only after the submit handler is installed. A missing/blocked asset
    // must not fall back to a document POST with an opaque Origin.
    fields.disabled = false;
    status.textContent = "";
  }
  bindForm("mcp-login-form", "mcp-login-fields", "login-status", false);
  bindForm("mcp-magic-form", "mcp-magic-fields", "magic-status", true);
})();
`;

function loginPage(): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login AI Core MCP</title>
<style>body{font:16px system-ui;max-width:460px;margin:56px auto;padding:0 20px}form,fieldset{display:grid;gap:14px}fieldset{border:0;padding:0;margin:0;min-width:0}label{display:grid;gap:5px}input{padding:10px}button{padding:12px;font-weight:bold}.muted{color:#555}</style>
<script src="${OAUTH_LOGIN_SCRIPT_PATH}" defer></script></head><body>
<h1>Login AI Core MCP</h1><p>Masuk dengan akun internal AI Core untuk menyetujui koneksi ChatGPT.</p>
<noscript><p>Aktifkan JavaScript lalu muat ulang halaman ini untuk menggunakan formulir login.</p></noscript>
<form method="post" action="/api/internal/auth/login" autocomplete="on" id="mcp-login-form">
<fieldset id="mcp-login-fields" disabled>
<label>Email<input type="email" name="email" autocomplete="username" required></label>
<label>Password<input type="password" name="password" autocomplete="current-password" required></label>
<button type="submit">Masuk</button></fieldset><p id="login-status" role="status" aria-live="polite">Memuat formulir login...</p></form>
<h2>Login melalui email</h2><form method="post" action="/api/internal/auth/request-magic-link" id="mcp-magic-form">
<fieldset id="mcp-magic-fields" disabled><label>Email akun AI Core<input type="email" name="email" autocomplete="email" required></label>
<button type="submit">Kirim tautan login ke email</button></fieldset><p id="magic-status" role="status" aria-live="polite">Memuat formulir login...</p></form>
<p class="muted">Tautan berlaku 10 menit. Setelah membukanya di browser yang sama, kembali ke halaman persetujuan OAuth dan muat ulang.</p>
</body></html>`;
}

/** Only the authenticated user's own address may be displayed, and always escaped. */
function sessionIdentityLabel(user: unknown): string {
  if (typeof user !== "object" || user === null || !("email" in user) ||
      typeof user.email !== "string") return "akun internal aktif";
  const email = user.email.trim().slice(0, 254);
  if (!email || /[\x00-\x1f\x7f]/.test(email)) return "akun internal aktif";
  return email.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch));
}

/** The parent OAuth router supplies its existing signed-session user resolver. */
export function createAiCoreMcpOAuthLoginRouter(resolveSessionUser: (req: Request) => Promise<unknown>): Router {
  const router = Router();
  router.get(OAUTH_LOGIN_SCRIPT_PATH, (_req, res): void => {
    res.setHeader("Cache-Control", "no-store");
    res.type("application/javascript").send(OAUTH_LOGIN_CLIENT_SCRIPT);
  });
  router.get(OAUTH_LOGIN_PATH, async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const user = await resolveSessionUser(req);
    if (user) {
      res.type("html").send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login AI Engine berhasil</title></head><body style="font:16px system-ui;max-width:540px;margin:64px auto;padding:20px"><h1>Login berhasil</h1><p>Sesi AI Engine aktif sebagai <strong>${sessionIdentityLabel(user)}</strong>.</p><p><strong>Pastikan ini akun yang sama dengan pemilik job lama.</strong> Event dan Final ACK dibatasi oleh akun OAuth serta client ID ChatGPT yang sama. Login saja belum berarti ChatGPT telah tersambung atau mengirim ACK.</p><p>Jika ChatGPT sudah memulai OAuth, kembali ke halaman permintaan autentikasi tersebut. Kode pairing hanya muncul jika permintaan OAuth memang membuat pairing baru.</p><p><a href="/api/ai/core-chat/oauth/pair/enter">Buka halaman persetujuan pairing</a></p></body></html>`);
      return;
    }
    res.type("html").send(loginPage());
  });
  return router;
}

