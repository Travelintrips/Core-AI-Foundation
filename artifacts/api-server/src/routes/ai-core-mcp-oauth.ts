import { Router, type Request, type Response } from "express";
import { verifyPassword } from "../services/passwordService.js";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  getInternalUserById,
  getInternalUserByEmail,
} from "../services/internalAuthService.js";
import {
  AI_CORE_MCP_SCOPES,
  exchangeAuthorizationCode,
  issueAuthorizationCode,
  isAllowedChatGptClient,
  isAllowedChatGptRedirect,
  normalizeScopes,
  oauthIssuer,
  oauthResource,
  refreshAccessToken,
} from "../services/aiCoreMcpOAuthService.js";

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
  if (!isAllowedChatGptRedirect(params.redirectUri)) return "invalid_redirect_uri";
  if (!params.codeChallenge || params.codeChallengeMethod !== "S256") return "invalid_request";
  if (params.resource !== oauthResource()) return "invalid_target";
  return null;
}

function redirectWithError(res: Response, params: ReturnType<typeof oauthParams>, error: string): void {
  if (!isAllowedChatGptRedirect(params.redirectUri)) {
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
    : `<label>Email<input name="email" type="email" autocomplete="username" required></label>
       <label>Password<input name="password" type="password" autocomplete="current-password" required></label>`;
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hubungkan AI Core</title><style>body{font-family:system-ui;max-width:560px;margin:48px auto;padding:0 20px}form{display:grid;gap:14px}label{display:grid;gap:6px}input{padding:10px}button{padding:11px 16px;font-weight:600}li{margin:6px 0}.muted{color:#666}</style></head><body>
  <h1>Hubungkan ChatGPT ke AI Core</h1>
  <p>ChatGPT meminta akses ke AI Core internal.</p>
  ${identity}
  <p>Izin yang diminta:</p><ul>${scopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join("")}</ul>
  <form method="post" action="/api/ai/core-chat/oauth/authorize">${hiddenFields}
    <button type="submit">Izinkan & Hubungkan</button>
  </form>
  <p class="muted">Akses dapat dihentikan dengan menonaktifkan koneksi app di ChatGPT atau menonaktifkan akun internal.</p>
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
    client_id_metadata_document_supported: true,
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    scopes_supported: AI_CORE_MCP_SCOPES,
  });
});

router.get("/api/ai/core-chat/oauth/authorize", async (req, res): Promise<void> => {
  const params = oauthParams(req.query as Record<string, unknown>);
  const error = validateAuthorizationRequest(params);
  if (error) { redirectWithError(res, params, error); return; }
  const user = await resolveSessionUser(req);
  res.type("html").send(renderAuthorizePage(params, user?.email));
});

router.post("/api/ai/core-chat/oauth/authorize", async (req, res): Promise<void> => {
  const params = oauthParams(req.body as Record<string, unknown>);
  const error = validateAuthorizationRequest(params);
  if (error) { redirectWithError(res, params, error); return; }

  let user = await resolveSessionUser(req);
  if (!user) {
    const email = readString(req.body?.email).toLowerCase();
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const candidate = email ? await getInternalUserByEmail(email) : null;
    if (!candidate || candidate.status !== "active" || candidate.accountType !== "internal" || !(await verifyPassword(password, candidate.passwordHash))) {
      res.status(401).type("html").send(renderAuthorizePage(params) + "<p>Email atau password salah.</p>");
      return;
    }
    user = candidate;
  }

  const scopes = normalizeScopes(params.scope);
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
