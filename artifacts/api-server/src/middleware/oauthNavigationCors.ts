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
    apiCors(req, res, next);
  };
}
