import { Router, type RequestHandler, type Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { requireAuth, requireInternalRole, requirePasswordChanged } from "../middleware/internalAuth.js";
import { SESSION_COOKIE_NAME } from "../services/internalAuthService.js";
import {
  createGpt02ReaderCustodyWorkerIssuer,
  Gpt02WorkerCustodyIssuerError,
} from "../services/gpt02ReaderCustodyWorkerIssuer.js";

export const GPT02_WORKER_CUSTODY_ISSUER_ROUTE = "/ai/agent-runtime/credentials/:id/custody-attestation";
const DEV_HOST = "dev.cstlogistic.co.id";
const DEV_ORIGIN = `https://${DEV_HOST}`;
const CredentialId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const IssuanceRequest = z.object({ expectedCredentialBinding: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

function deny(res: Response, error: unknown): void {
  const code = error instanceof Gpt02WorkerCustodyIssuerError ? error.code : "WORKER_CUSTODY_ISSUER_UNAVAILABLE";
  const status = code === "WORKER_CUSTODY_ISSUER_DISABLED" ? 404
    : code === "WORKER_CUSTODY_INVALID_REQUEST" ? 400
    : code === "WORKER_CUSTODY_OWNER_REQUIRED" ? 403
    : code === "WORKER_CUSTODY_CREDENTIAL_UNAVAILABLE" || code === "WORKER_CUSTODY_CREDENTIAL_CHANGED" ||
      code === "WORKER_CUSTODY_ATTESTATION_EXPIRED" ? 409 : 503;
  res.status(status).json({ error: code });
}

/** Preserve existing auth policy elsewhere; contain dependency errors only on
 * this endpoint so SQL/session failures cannot disclose internal exceptions. */
function boundedAuth(guard: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    try { await guard(req, res, next); }
    catch (error) { if (!res.headersSent) deny(res, error); }
  };
}

/** Decoding is only a rejection filter, never authentication. The following
 * requireAuth still verifies the signature/expiry and re-fetches the user.
 * Password-reset and magic-login JWTs share the existing signing secret, but
 * their purpose-specific claims must not be usable directly as this session. */
const requireSessionPurpose: RequestHandler = (req, res, next) => {
  try {
    const token = (req.cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE_NAME];
    const decoded = typeof token === "string" && token.length <= 4096 ? jwt.decode(token) : null;
    const payload = decoded && typeof decoded === "object" ? decoded as Record<string, unknown> : null;
    if (!payload ||
        Object.keys(payload).length !== 3 || Object.keys(payload).some((key) => !["sub", "iat", "exp"].includes(key)) ||
        typeof payload.sub !== "number" || !Number.isSafeInteger(payload.sub) || payload.sub < 1 ||
        typeof payload.iat !== "number" || !Number.isSafeInteger(payload.iat) || payload.iat < 0 ||
        typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp) || payload.exp <= payload.iat) {
      res.status(401).json({ error: "WORKER_CUSTODY_SESSION_REQUIRED" }); return;
    }
    next();
  } catch { res.status(401).json({ error: "WORKER_CUSTODY_SESSION_REQUIRED" }); }
};

export function createGpt02ReaderCustodyWorkerIssuerRouter(
  issuer = createGpt02ReaderCustodyWorkerIssuer(),
) {
  const router = Router();
  router.post(
    GPT02_WORKER_CUSTODY_ISSUER_ROUTE,
    (req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      try { issuer.verifyRuntimeIsolation(); }
      catch (error) { deny(res, error); return; }
      // Fixed deployment target, checked before session authentication can
      // query a database. Forwarded or caller-selected origins are not trust.
      if (req.headers.host !== DEV_HOST || req.headers.origin !== DEV_ORIGIN) {
        res.status(403).json({ error: "WORKER_CUSTODY_SAME_ORIGIN_REQUIRED" }); return;
      }
      if (!req.is("application/json")) {
        res.status(415).json({ error: "WORKER_CUSTODY_JSON_REQUIRED" }); return;
      }
      next();
    },
    requireSessionPurpose,
    boundedAuth(requireAuth),
    boundedAuth(requireInternalRole("owner")),
    boundedAuth(requirePasswordChanged),
    async (req, res) => {
      const id = CredentialId.safeParse(req.params["id"]);
      const body = IssuanceRequest.safeParse(req.body);
      if (!id.success || !body.success) {
        res.status(400).json({ error: "WORKER_CUSTODY_INVALID_REQUEST" }); return;
      }
      if (!req.internalUser) { res.status(401).json({ error: "Not authenticated" }); return; }
      try {
        const envelope = await issuer.issue({
          ownerId: req.internalUser.id,
          credentialId: id.data,
          expectedCredentialBinding: body.data.expectedCredentialBinding,
        });
        // Public evidence only. A later authorized custody installation is
        // separate; repeated POSTs never replace the active worker proof.
        res.status(201).json(envelope);
      } catch (error) { deny(res, error); }
    },
  );
  return router;
}
