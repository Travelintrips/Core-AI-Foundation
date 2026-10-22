import type { RequestHandler } from "express";

/** OAuth consent is a browser navigation, not a cross-origin API read.
 * Redirected or embedded browsers can submit its form with an opaque Origin.
 * Leave CORS headers absent for this endpoint; OAuth still validates the client,
 * redirect URI, resource and PKCE, and verifies the signed login session.
 */
export function oauthNavigationCors(apiCors: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (
      req.path === "/api/ai/core-chat/oauth/authorize" &&
      (req.method === "GET" || req.method === "POST")
    ) {
      next();
      return;
    }
    // Allow only same-origin opaque navigation to the anonymous, rate-limited
    // magic-link form. Do not grant cross-origin response access.
    if (req.path === "/api/internal/auth/request-magic-link" &&
        req.method === "POST" && req.headers.origin === "null" &&
        req.headers["sec-fetch-site"] === "same-origin" &&
        req.headers["sec-fetch-mode"] === "navigate") {
      next();
      return;
    }
    apiCors(req, res, next);
  };
}
