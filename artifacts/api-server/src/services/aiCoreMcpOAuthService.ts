import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { getInternalUserById } from "./internalAuthService.js";

const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const CODE_TTL_SECONDS = 5 * 60;
const EMAIL_LOGIN_TTL_SECONDS = 10 * 60;

export const AI_CORE_MCP_SCOPES = [
  "ai_core.command",
  "ai_core.progress",
  "ai_core.events",
  "profile",
  "offline_access",
] as const;

export function oauthIssuer(): string {
  return (process.env["AI_CORE_PUBLIC_BASE_URL"] ?? process.env["PUBLIC_APP_URL"] ?? "https://aicore.cstlogistic.co.id").replace(/\/$/, "");
}

export function oauthResource(): string {
  return `${oauthIssuer()}/api/ai/core-chat/mcp`;
}

function secret(): string {
  const value = process.env["SESSION_SECRET"]?.trim();
  if (!value) throw new Error("SESSION_SECRET is required for AI Core MCP OAuth");
  return value;
}

const DYNAMIC_CLIENT_PREFIX = "aicore_dcr_";

function isSafeChatGptRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    const isLoopbackHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    const validPort = parsed.port === "" || (/^\d+$/.test(parsed.port) && Number(parsed.port) >= 1 && Number(parsed.port) <= 65535);
    if (
      parsed.protocol === "http:" &&
      isLoopbackHost &&
      validPort &&
      parsed.pathname === "/callback" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === ""
    ) {
      return true;
    }
    if (
      parsed.protocol === "https:" &&
      parsed.hostname === "chatgpt.com" &&
      (
        parsed.pathname === "/connector_platform_oauth_redirect" ||
        /^\/connector\/oauth\/[^/]+$/.test(parsed.pathname)
      ) &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.hash === ""
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function decodeDynamicClient(clientId: string): DynamicClientClaims | null {
  if (!clientId.startsWith(DYNAMIC_CLIENT_PREFIX)) return null;
  try {
    const decoded = jwt.verify(clientId.slice(DYNAMIC_CLIENT_PREFIX.length), secret(), {
      algorithms: ["HS256"],
      issuer: oauthIssuer(),
      audience: oauthResource(),
    }) as unknown as DynamicClientClaims;
    if (decoded.purpose !== "mcp_dynamic_client" || !Array.isArray(decoded.redirectUris)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function issueDynamicClientId(redirectUris: string[]): string {
  const normalized = [...new Set(redirectUris.map((uri) => uri.trim()).filter(Boolean))];
  if (!normalized.length || normalized.some((uri) => !isSafeChatGptRedirectUri(uri))) {
    throw new Error("invalid_redirect_uri");
  }
  const token = jwt.sign(
    {
      purpose: "mcp_dynamic_client",
      redirectUris: normalized,
      jti: randomUUID(),
    } satisfies DynamicClientClaims,
    secret(),
    {
      algorithm: "HS256",
      issuer: oauthIssuer(),
      audience: oauthResource(),
      expiresIn: 365 * 24 * 60 * 60,
    },
  );
  return DYNAMIC_CLIENT_PREFIX + token;
}

export function isAllowedChatGptClient(clientId: string): boolean {
  return clientId === "https://chatgpt.com/oauth/client.json" ||
    /^https:\/\/chatgpt\.com\/oauth\/[^/]+\/client\.json$/.test(clientId) ||
    decodeDynamicClient(clientId) !== null;
}

export function isAllowedChatGptRedirect(clientId: string, uri: string): boolean {
  const dynamic = decodeDynamicClient(clientId);
  if (dynamic) {
    return dynamic.redirectUris.includes(uri) && isSafeChatGptRedirectUri(uri);
  }
  if (clientId === "https://chatgpt.com/oauth/codex/client.json") {
    return isSafeChatGptRedirectUri(uri);
  }
  if (uri === "https://chatgpt.com/connector_platform_oauth_redirect") return true;
  return /^https:\/\/chatgpt\.com\/connector\/oauth\/[^/]+$/.test(uri);
}

export function normalizeScopes(scope: string | undefined): string[] {
  const requested = (scope ?? "").split(/\s+/).map((x) => x.trim()).filter(Boolean);
  const allowed = new Set<string>(AI_CORE_MCP_SCOPES);
  const result = requested.length ? requested.filter((x) => allowed.has(x)) : ["ai_core.command", "ai_core.progress", "ai_core.events", "profile", "offline_access"];
  return [...new Set(result)];
}

type CodeClaims = {
  purpose: "mcp_code";
  sub: number;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  jti: string;
};

type EmailLoginClaims = {
  purpose: "mcp_email_login";
  sub: number;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  state: string;
  jti: string;
};

type TokenClaims = {
  purpose: "mcp_access" | "mcp_refresh";
  sub: number;
  clientId: string;
  scope: string;
  resource: string;
  jti: string;
};

type DynamicClientClaims = {
  purpose: "mcp_dynamic_client";
  redirectUris: string[];
  jti: string;
};

const usedCodes = new Map<string, number>();

function cleanupUsedCodes(): void {
  const now = Date.now();
  for (const [jti, expiresAt] of usedCodes) if (expiresAt <= now) usedCodes.delete(jti);
}


export function issueEmailLoginToken(input: Omit<EmailLoginClaims, "purpose" | "jti">): string {
  return jwt.sign(
    { ...input, purpose: "mcp_email_login", jti: randomUUID() } satisfies EmailLoginClaims,
    secret(),
    {
      algorithm: "HS256",
      issuer: oauthIssuer(),
      audience: oauthResource(),
      expiresIn: EMAIL_LOGIN_TTL_SECONDS,
    },
  );
}

export async function consumeEmailLoginToken(token: string): Promise<EmailLoginClaims> {
  cleanupUsedCodes();
  const decoded = jwt.verify(token, secret(), {
    algorithms: ["HS256"],
    issuer: oauthIssuer(),
    audience: oauthResource(),
  }) as unknown as EmailLoginClaims;
  if (decoded.purpose !== "mcp_email_login") throw new Error("invalid_grant");
  const user = await getInternalUserById(decoded.sub);
  if (!user || user.status !== "active" || user.accountType !== "internal") throw new Error("invalid_grant");
  return decoded;
}

export function issueAuthorizationCode(input: Omit<CodeClaims, "purpose" | "jti">): string {
  return jwt.sign(
    { ...input, purpose: "mcp_code", jti: randomUUID() } satisfies CodeClaims,
    secret(),
    {
      algorithm: "HS256",
      issuer: oauthIssuer(),
      audience: oauthResource(),
      expiresIn: CODE_TTL_SECONDS,
    },
  );
}

function verifyCodeVerifier(verifier: string, challenge: string): boolean {
  const actual = createHash("sha256").update(verifier).digest("base64url");
  return actual === challenge;
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string;
}) {
  cleanupUsedCodes();
  const decoded = jwt.verify(input.code, secret(), {
    algorithms: ["HS256"],
    issuer: oauthIssuer(),
    audience: oauthResource(),
  }) as unknown as CodeClaims;
  if (decoded.purpose !== "mcp_code") throw new Error("invalid_grant");
  if (usedCodes.has(decoded.jti)) throw new Error("invalid_grant");
  if (decoded.clientId !== input.clientId || decoded.redirectUri !== input.redirectUri) throw new Error("invalid_grant");
  if (decoded.resource !== input.resource || input.resource !== oauthResource()) throw new Error("invalid_target");
  if (!verifyCodeVerifier(input.codeVerifier, decoded.codeChallenge)) throw new Error("invalid_grant");
  const user = await getInternalUserById(decoded.sub);
  if (!user || user.status !== "active" || user.accountType !== "internal") throw new Error("invalid_grant");
  usedCodes.set(decoded.jti, Date.now() + CODE_TTL_SECONDS * 1000);
  return issueTokenPair(decoded.sub, decoded.clientId, decoded.scope.split(" "), decoded.resource);
}

export async function refreshAccessToken(input: {
  refreshToken: string;
  clientId: string;
  resource: string;
}) {
  const decoded = jwt.verify(input.refreshToken, secret(), {
    algorithms: ["HS256"],
    issuer: oauthIssuer(),
    audience: oauthResource(),
  }) as unknown as TokenClaims;
  if (decoded.purpose !== "mcp_refresh") throw new Error("invalid_grant");
  if (decoded.clientId !== input.clientId) throw new Error("invalid_client");
  if (decoded.resource !== input.resource || input.resource !== oauthResource()) throw new Error("invalid_target");
  const user = await getInternalUserById(decoded.sub);
  if (!user || user.status !== "active" || user.accountType !== "internal") throw new Error("invalid_grant");
  return issueTokenPair(decoded.sub, decoded.clientId, decoded.scope.split(" "), decoded.resource);
}

function issueTokenPair(userId: number, clientId: string, scopes: string[], resource: string) {
  const scope = scopes.join(" ");
  const common = { sub: userId, clientId, scope, resource };
  const accessToken = jwt.sign(
    { ...common, purpose: "mcp_access", jti: randomUUID() } satisfies TokenClaims,
    secret(),
    { algorithm: "HS256", issuer: oauthIssuer(), audience: resource, expiresIn: ACCESS_TTL_SECONDS },
  );
  const refreshToken = jwt.sign(
    { ...common, purpose: "mcp_refresh", jti: randomUUID() } satisfies TokenClaims,
    secret(),
    { algorithm: "HS256", issuer: oauthIssuer(), audience: resource, expiresIn: REFRESH_TTL_SECONDS },
  );
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: refreshToken,
    scope,
  };
}

export async function verifyMcpAccessToken(token: string) {
  const decoded = jwt.verify(token, secret(), {
    algorithms: ["HS256"],
    issuer: oauthIssuer(),
    audience: oauthResource(),
  }) as unknown as TokenClaims;
  if (decoded.purpose !== "mcp_access" || decoded.resource !== oauthResource()) throw new Error("invalid_token");
  const user = await getInternalUserById(decoded.sub);
  if (!user || user.status !== "active" || user.accountType !== "internal") throw new Error("invalid_token");
  return { user, scopes: new Set(decoded.scope.split(" ").filter(Boolean)), clientId: decoded.clientId };
}
