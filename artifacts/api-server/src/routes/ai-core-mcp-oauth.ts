import { Router, type Request, type Response } from "express";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  getInternalUserById,
} from "../services/internalAuthService.js";
import {
  AI_CORE_MCP_SCOPES,
  exchangeAuthorizationCode,
  issueAuthorizationCode,
  issueDynamicClientId,
  isAllowedChatGptClient,
  isAllowedChatGptRedirect,
  normalizeScopes,
  oauthIssuer,
  oauthResource,
  refreshAccessToken,
} from "../services/aiCoreMcpOAuthService.js";
import {
  approveMcpOauthPairing,
  createMcpOauthPairing,
  getMcpOauthPairing,
} from "../services/aiCoreMcpPairingService.js";

const router = Router();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch));
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function oauthParams(source: Record<string, unknown>) {
  return {
    responseType: readString(source["response_type"]),
    clientId: readString(source["client_id"]),
    redirectUri: readString(source["redirect_uri"]),
    codeChallenge: readString(source["code_challenge"]),
    codeChallengeMethod: readString(source["code_challenge_method"]),
    state: readString(source["state"]),
    scope: readString(source["scope"]),
    resource: readString(source["resource"]),
  };
}

function validateAuthorizationRequest(params: ReturnType<typeof oauthParams>): string | null {
  if (params.responseType !== "code") return "unsupported_response_type";
  if (!isAllowedChatGptClient(params.clientId)) return "invalid_client";
  if (!isAllowedChatGptRedirect(params.clientId, params.redirectUri)) return "invalid_redirect_uri";
  if (!params.codeChallenge || params.codeChallengeMethod !== "S256") return "invalid_request";
  if (params.resource !== oauthResource()) return "invalid_target";
  return null;
}

function redirectWithError(res: Response, params: ReturnType<typeof oauthParams>, error: string): void {
  if (!isAllowedChatGptRedirect(params.clientId, params.redirectUri)) {
    res.status(400).json({ error });
    return;
  }
  const url = new URL(params.redirectUri);
  url.searchParams.set("error", error);
  if (params.state) url.searchParams.set("state", params.state);
  url.searchParams.set("iss", oauthIssuer());
  res.redirect(302, url.toString());
}

async function resolveSessionUser(req: Request) {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
  const payload = token ? verifySessionToken(token) : null;
  const user = payload ? await getInternalUserById(payload.sub) : null;
  return user && user.status === "active" && user.accountType === "internal" ? user : null;
}

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}

function renderAuthorizePage(params: ReturnType<typeof oauthParams>, loggedInEmail?: string): string {
  const scopes = normalizeScopes(params.scope);
  const hiddenFields = [
    hidden("response_type", params.responseType),
    hidden("client_id", params.clientId),
    hidden("redirect_uri", params.redirectUri),
    hidden("code_challenge", params.codeChallenge),
    hidden("code_challenge_method", params.codeChallengeMethod),
    hidden("state", params.state),
    hidden("scope", scopes.join(" ")),
    hidden("resource", params.resource),
  ].join("");
  const identity = loggedInEmail
    ? `<p>Login sebagai <strong>${escapeHtml(loggedInEmail)}</strong>.</p>`
    : `<p><strong>Session AI Core belum terdeteksi.</strong></p>
       <p class="muted">Buka AI Core dan pastikan Anda sudah login di browser ini, lalu kembali ke halaman ini dan refresh.</p>
       <p><a href="/login" target="_blank" rel="noopener noreferrer">Buka Login AI Core</a></p>`;
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hubungkan AI Core</title><style>body{font-family:system-ui;max-width:560px;margin:48px auto;padding:0 20px}form{display:grid;gap:14px}label{display:grid;gap:6px}input{padding:10px}button{padding:11px 16px;font-weight:600}li{margin:6px 0}.muted{color:#666}</style></head><body>
  <h1>Hubungkan ChatGPT ke AI Core</h1>
  <p>ChatGPT meminta akses ke AI Core internal.</p>
  <form method="post" action="/api/ai/core-chat/oauth/authorize">${hiddenFields}
    ${identity}
    <p>Izin yang diminta:</p><ul>${scopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join("")}</ul>
    ${loggedInEmail ? '<button type="submit">Izinkan & Hubungkan</button>' : ''}
  </form>
  <p class="muted">Akses dapat dihentikan dengan menonaktifkan koneksi app di ChatGPT atau menonaktifkan akun internal.</p>
</body></html>`;
}


function renderPairingWaitPage(pairing: { id: string; code: string; expiresAt: Date }): string {
  const waitUrl = `${oauthIssuer()}/api/ai/core-chat/oauth/pair/wait?id=${encodeURIComponent(pairing.id)}`;
  const approvalPageUrl = `${oauthIssuer()}/mcp-pair?code=${encodeURIComponent(pairing.code)}`;
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="2;url=${escapeHtml(waitUrl)}">
  <title>Pairing AI Core</title><style>body{font-family:system-ui;max-width:620px;margin:48px auto;padding:0 20px}.code{font-size:34px;font-weight:800;letter-spacing:6px;padding:18px;border:1px solid #ccc;border-radius:12px;text-align:center}a.button,button.button{display:inline-block;padding:12px 16px;background:#111;color:#fff;text-decoration:none;border:0;border-radius:8px;font-weight:700;cursor:pointer}.muted{color:#666}.url{word-break:break-all;font-family:ui-monospace,monospace;font-size:12px;padding:10px;background:#f4f4f4;border-radius:8px}</style></head><body>
  <h1>Hubungkan ChatGPT ke AI Core</h1>
  <p>Kode pairing:</p>
  <div class="code">${escapeHtml(pairing.code)}</div>
  <p><strong>Buka AI Core di browser tempat Anda sudah login</strong>, lalu buka halaman <code>/mcp-pair</code> dan masukkan kode di atas.</p>
  <p><a class="button" href="${escapeHtml(approvalPageUrl)}" target="_blank" rel="noopener noreferrer">Buka Halaman Pairing AI Core</a></p>
  <p class="url" id="approval-url">${escapeHtml(approvalPageUrl)}</p>
  <p><button class="button" type="button" onclick="navigator.clipboard.writeText(document.getElementById('approval-url').textContent || '')">Salin Link Approval</button></p>
  <p class="muted">Halaman ini mengecek approval otomatis setiap 2 detik. Setelah approval berhasil, koneksi akan lanjut sendiri ke ChatGPT.</p>
  <p class="muted">Pairing berlaku sampai ${escapeHtml(pairing.expiresAt.toISOString())}.</p>
  </body></html>`;
}

function renderPairingApprovalPage(code: string, email: string): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Approve Pairing AI Core</title><style>body{font-family:system-ui;max-width:560px;margin:48px auto;padding:0 20px}form{display:grid;gap:14px}button{padding:12px 16px;font-weight:700}.code{font-size:30px;font-weight:800;letter-spacing:5px}.muted{color:#666}</style></head><body>
  <h1>Approve koneksi ChatGPT</h1>
  <p>Login sebagai <strong>${escapeHtml(email)}</strong>.</p>
  <p>Kode pairing:</p><div class="code">${escapeHtml(code)}</div>
  <form method="post" action="/api/ai/core-chat/oauth/pair/approve">
    <input type="hidden" name="code" value="${escapeHtml(code)}">
    <button type="submit">Approve & Hubungkan</button>
  </form>
  <p class="muted">Setelah disetujui, kembali ke jendela OAuth. Jendela tersebut akan lanjut otomatis.</p>
  </body></html>`;
}

router.get("/.well-known/oauth-protected-resource", (_req, res): void => {
  res.json({
    resource: oauthResource(),
    authorization_servers: [oauthIssuer()],
    scopes_supported: AI_CORE_MCP_SCOPES,
    resource_documentation: `${oauthIssuer()}/api/ai/core-chat/connector/openapi.json`,
  });
});

router.get("/.well-known/oauth-authorization-server", (_req, res): void => {
  const issuer = oauthIssuer();
  res.json({
    issuer,
    authorization_response_iss_parameter_supported: true,
    authorization_endpoint: `${issuer}/api/ai/core-chat/oauth/authorize`,
    token_endpoint: `${issuer}/api/ai/core-chat/oauth/token`,
    registration_endpoint: `${issuer}/api/ai/core-chat/oauth/register`,
    client_id_metadata_document_supported: true,
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    scopes_supported: AI_CORE_MCP_SCOPES,
  });
});

router.post("/api/ai/core-chat/oauth/register", (req, res): void => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const redirectUris = Array.isArray(body["redirect_uris"])
    ? body["redirect_uris"].filter((value): value is string => typeof value === "string")
    : [];
  const tokenEndpointAuthMethod = readString(body["token_endpoint_auth_method"]) || "none";
  const grantTypes = Array.isArray(body["grant_types"])
    ? body["grant_types"].filter((value): value is string => typeof value === "string")
    : ["authorization_code", "refresh_token"];
  const responseTypes = Array.isArray(body["response_types"])
    ? body["response_types"].filter((value): value is string => typeof value === "string")
    : ["code"];

  if (tokenEndpointAuthMethod !== "none") {
    res.status(400).json({ error: "invalid_client_metadata", error_description: "Only public PKCE clients are supported." });
    return;
  }
  if (!grantTypes.every((value) => ["authorization_code", "refresh_token"].includes(value))) {
    res.status(400).json({ error: "invalid_client_metadata", error_description: "Unsupported grant type." });
    return;
  }
  if (!responseTypes.length || !responseTypes.every((value) => value === "code")) {
    res.status(400).json({ error: "invalid_client_metadata", error_description: "Only code response type is supported." });
    return;
  }

  try {
    const clientId = issueDynamicClientId(redirectUris);
    res.status(201).json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: [...new Set(grantTypes)],
      response_types: ["code"],
      scope: AI_CORE_MCP_SCOPES.join(" "),
      ...(typeof body["client_name"] === "string" ? { client_name: body["client_name"] } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_client_metadata";
    res.status(400).json({
      error: message === "invalid_redirect_uri" ? "invalid_redirect_uri" : "invalid_client_metadata",
    });
  }
});

router.get("/api/ai/core-chat/oauth/authorize", async (req, res): Promise<void> => {
  const params = oauthParams(req.query as Record<string, unknown>);
  const error = validateAuthorizationRequest(params);
  if (error) { redirectWithError(res, params, error); return; }
  const user = await resolveSessionUser(req);
  if (user) {
    res.type("html").send(renderAuthorizePage(params, user.email));
    return;
  }

  const scopes = normalizeScopes(params.scope);
  const pairing = await createMcpOauthPairing({
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    scope: scopes.join(" "),
    resource: params.resource,
    state: params.state,
  });
  res.redirect(302, `/api/ai/core-chat/oauth/pair/wait?id=${encodeURIComponent(pairing.id)}`);
});

router.post("/api/ai/core-chat/oauth/authorize", async (req, res): Promise<void> => {
  const params = oauthParams((req.body ?? {}) as Record<string, unknown>);
  const error = validateAuthorizationRequest(params);
  if (error) { redirectWithError(res, params, error); return; }

  const scopes = normalizeScopes(params.scope);

  try {
    const user = await resolveSessionUser(req);
    if (user) {
      const code = issueAuthorizationCode({
        sub: user.id,
        clientId: params.clientId,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        scope: scopes.join(" "),
        resource: params.resource,
      });
      const url = new URL(params.redirectUri);
      url.searchParams.set("code", code);
      if (params.state) url.searchParams.set("state", params.state);
      url.searchParams.set("iss", oauthIssuer());
      res.redirect(302, url.toString());
      return;
    }
  } catch (sessionError) {
    req.log?.error?.({ err: sessionError }, "[mcp-oauth] authorize POST session path failed; falling back to pairing");
  }

  try {
    const pairing = await createMcpOauthPairing({
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scope: scopes.join(" "),
      resource: params.resource,
      state: params.state,
    });
    res.redirect(302, `/api/ai/core-chat/oauth/pair/wait?id=${encodeURIComponent(pairing.id)}`);
  } catch (pairingError) {
    req.log?.error?.({ err: pairingError }, "[mcp-oauth] authorize POST pairing fallback failed");
    res.status(503).type("html").send(
      "<h1>Koneksi sementara gagal</h1><p>AI Core sedang sibuk. Klik Authenticate lagi beberapa detik lagi.</p>",
    );
  }
});


router.get("/api/ai/core-chat/oauth/pair/wait", async (req, res): Promise<void> => {
  const id = readString(req.query["id"]);
  const pairing = id ? await getMcpOauthPairing(id) : null;
  if (!pairing) {
    res.status(404).type("html").send("<p>Pairing tidak ditemukan. Mulai ulang Authenticate dari ChatGPT.</p>");
    return;
  }
  if (pairing.expiresAt.getTime() <= Date.now()) {
    res.status(410).type("html").send("<p>Pairing sudah kedaluwarsa. Mulai ulang Authenticate dari ChatGPT.</p>");
    return;
  }
  if (pairing.status !== "approved" || !pairing.approvedUserId) {
    res.type("html").send(renderPairingWaitPage(pairing));
    return;
  }

  const user = await getInternalUserById(pairing.approvedUserId);
  if (!user || user.status !== "active" || user.accountType !== "internal") {
    res.status(403).type("html").send("<p>Akun approval tidak aktif.</p>");
    return;
  }

  const code = issueAuthorizationCode({
    sub: user.id,
    clientId: pairing.clientId,
    redirectUri: pairing.redirectUri,
    codeChallenge: pairing.codeChallenge,
    scope: pairing.scope,
    resource: pairing.resource,
  });
  const url = new URL(pairing.redirectUri);
  url.searchParams.set("code", code);
  if (pairing.state) url.searchParams.set("state", pairing.state);
  url.searchParams.set("iss", oauthIssuer());
  res.redirect(302, url.toString());
});

router.get("/api/ai/core-chat/oauth/pair/approve", async (req, res): Promise<void> => {
  const code = readString(req.query["code"]);
  const user = await resolveSessionUser(req);
  if (!user) {
    res.status(401).type("html").send(`<p>Session AI Core belum terdeteksi di browser ini.</p><p><a href="/login" target="_blank" rel="noopener noreferrer">Login ke AI Core</a>, lalu buka kembali URL approval ini.</p><p>Kode pairing: <strong>${escapeHtml(code)}</strong></p>`);
    return;
  }
  if (!code) {
    res.status(400).type("html").send("<p>Kode pairing tidak valid.</p>");
    return;
  }
  res.type("html").send(renderPairingApprovalPage(code, user.email));
});

router.post("/api/ai/core-chat/oauth/pair/approve", async (req, res): Promise<void> => {
  const user = await resolveSessionUser(req);
  if (!user) {
    res.status(401).type("html").send("<p>Session AI Core tidak ditemukan. Login ulang lalu coba approve lagi.</p>");
    return;
  }
  const code = readString(req.body?.code);
  if (code && !/^\d{8}$/.test(code)) {
    res.status(400).type("html").send("<p>Kode pairing tidak valid.</p>");
    return;
  }
  const approved = await approveMcpOauthPairing(code, user.id);
  if (!approved) {
    res.status(400).type("html").send("<p>Pairing tidak ditemukan, sudah disetujui, atau kedaluwarsa.</p>");
    return;
  }
  res.type("html").send("<h1>Pairing disetujui</h1><p>Kembali ke jendela OAuth. Koneksi ChatGPT akan dilanjutkan otomatis.</p>");
});

router.post("/api/ai/core-chat/oauth/token", async (req, res): Promise<void> => {
  try {
    const grantType = readString(req.body?.grant_type);
    const clientId = readString(req.body?.client_id);
    const resource = readString(req.body?.resource);
    if (!isAllowedChatGptClient(clientId)) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }

    if (grantType === "authorization_code") {
      const result = await exchangeAuthorizationCode({
        code: readString(req.body?.code),
        clientId,
        redirectUri: readString(req.body?.redirect_uri),
        codeVerifier: readString(req.body?.code_verifier),
        resource,
      });
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
      return;
    }

    if (grantType === "refresh_token") {
      const result = await refreshAccessToken({
        refreshToken: readString(req.body?.refresh_token),
        clientId,
        resource,
      });
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
      return;
    }

    res.status(400).json({ error: "unsupported_grant_type" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_grant";
    const allowed = new Set(["invalid_grant", "invalid_client", "invalid_target"]);
    res.status(400).json({ error: allowed.has(message) ? message : "invalid_grant" });
  }
});

export default router;
