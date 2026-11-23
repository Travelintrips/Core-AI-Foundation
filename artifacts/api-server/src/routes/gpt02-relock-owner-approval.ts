import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  createGpt02RelockOwnerChallenge,
  verifyAndRecordGpt02RelockOwnerApproval,
  type Gpt02OwnerActor,
} from "../services/gpt02RelockOwnerApprovalService.js";

const OWNER_HOST = "dev-ai-task.cstlogistic.co.id";
const OWNER_ORIGIN = `https://${OWNER_HOST}`;
const PREPARE_PATH = "/prepare";
const APPROVE_PATH = "/approve";

export type Gpt02RelockOwnerSessionVerifier = (input: {
  bearerToken: string;
  request: Request;
}) => Promise<Gpt02OwnerActor>;

export type Gpt02RelockOwnerApprovalRouterOptions = Readonly<{
  // Must validate the Supabase-Google signed Owner session through the
  // trusted CST Hub identity chain; never map this to adminAuth or an API key.
  verifyOwnerSession: Gpt02RelockOwnerSessionVerifier;
  verifyOwnerEligibility: (actor: Gpt02OwnerActor, bearerToken: string) => Promise<boolean>;
}>;

function countRawHeader(request: Request, name: string): number {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name.toLowerCase()) count += 1;
  }
  return count;
}

function reject(res: Response, status: number, code: string): void {
  res.status(status).set("Cache-Control", "no-store").json({ error: code });
}

function safeErrorCode(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  return /^GPT02_[A-Z0-9_]{1,100}$/.test(message) ? message : fallback;
}

function ownerBearerToken(req: Request): string | null {
  if (countRawHeader(req, "authorization") !== 1) return null;
  const value = req.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  if (token.length < 48 || token.length > 4096 || /\s/.test(token)) return null;
  return token;
}

function validSameOriginJson(req: Request): boolean {
  for (const header of ["host", "origin", "content-type", "content-length"]) {
    if (countRawHeader(req, header) !== 1) return false;
  }
  if (countRawHeader(req, "transfer-encoding") !== 0) return false;
  const length = Number(req.get("content-length"));
  return req.get("host") === OWNER_HOST &&
    req.get("origin") === OWNER_ORIGIN &&
    req.is("application/json") === "application/json" &&
    Number.isSafeInteger(length) && length > 0 && length <= 8192;
}

export function createGpt02RelockOwnerApprovalRouter(
  options: Gpt02RelockOwnerApprovalRouterOptions,
): Router {
  if (typeof options?.verifyOwnerSession !== "function" || typeof options?.verifyOwnerEligibility !== "function") {
    throw new Error("GPT02_TRUSTED_OWNER_SESSION_ADAPTER_REQUIRED");
  }
  const router = Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("Pragma", "no-cache");
    if (req.method !== "POST" || !validSameOriginJson(req)) {
      reject(res, 404, "GPT02_OWNER_APPROVAL_ROUTE_NOT_FOUND");
      return;
    }
    next();
  });

  router.post(PREPARE_PATH, async (req, res): Promise<void> => {
    const token = ownerBearerToken(req);
    if (!token) {
      reject(res, 401, "GPT02_OWNER_SESSION_REQUIRED");
      return;
    }
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
        Object.keys(req.body).length !== 1 || req.body.action !== "PREPARE_GPT02_RELOCK_OWNER_APPROVAL") {
      reject(res, 400, "GPT02_OWNER_APPROVAL_PREPARE_BODY_INVALID");
      return;
    }
    try {
      const actor = await options.verifyOwnerSession({ bearerToken: token, request: req });
      const challenge = await createGpt02RelockOwnerChallenge({
        actor,
        verifyOwner: (candidate) => options.verifyOwnerEligibility(candidate, token),
      });
      res.status(201).json({
        challengeId: challenge.challengeId,
        scope: "GPT02_RELOCK_CST_DEV",
        environment: "DEV",
        manifest: challenge.manifest,
        canonicalPayload: challenge.canonicalPayload,
        manifestSha256: challenge.manifestSha256,
        approvalMethod: challenge.approvalMethod,
        expiresAt: challenge.expiresAt,
        ownerApprovalGranted: false,
        executionPermitted: false,
        signingPermitted: false,
        dispatchPermitted: false,
      });
    } catch (error) {
      const code = safeErrorCode(error, "GPT02_OWNER_APPROVAL_PREPARATION_FAILED");
      const unauthorized = code.includes("SUPERADMIN_SESSION_REQUIRED") ||
        code.includes("OWNER_IDENTITY_NOT_ELIGIBLE") ||
        code.includes("OWNER_SESSION_REQUIRED") ||
        code.includes("HUB_OWNER_SESSION") ||
        code.includes("HUB_OWNER_GOOGLE_SESSION");
      reject(res, unauthorized ? 403 : 503, unauthorized ? "GPT02_VERIFIED_OWNER_REQUIRED" : code);
    }
  });

  router.post(APPROVE_PATH, async (req, res): Promise<void> => {
    const token = ownerBearerToken(req);
    if (!token) {
      reject(res, 401, "GPT02_OWNER_SESSION_REQUIRED");
      return;
    }
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
        Object.keys(req.body).sort().join(",") !== "challengeId,decision,manifestSha256" ||
        typeof req.body.challengeId !== "string" || req.body.decision !== "APPROVE" ||
        typeof req.body.manifestSha256 !== "string") {
      reject(res, 400, "GPT02_OWNER_APPROVAL_SUBMISSION_INVALID");
      return;
    }
    try {
      const actor = await options.verifyOwnerSession({ bearerToken: token, request: req });
      const result = await verifyAndRecordGpt02RelockOwnerApproval({
        actor,
        verifyOwner: (candidate) => options.verifyOwnerEligibility(candidate, token),
        challengeId: req.body.challengeId,
        manifestSha256: req.body.manifestSha256,
        signedSessionSha256: createHash("sha256").update(token, "utf8").digest("hex"),
      });
      res.status(200).json({
        ...result,
        scope: "GPT02_RELOCK_CST_DEV",
        executionPermitted: false,
        signingPermitted: false,
        dispatchPermitted: false,
      });
    } catch (error) {
      const code = safeErrorCode(error, "GPT02_OWNER_APPROVAL_FAILED");
      const status = code.includes("NOT_FOUND") ? 404 :
        code.includes("EXPIRED") || code.includes("REPLAY") || code.includes("MISMATCH") || code.includes("NOT_PENDING") ? 409 :
        code.includes("TRUST") || code.includes("KEY") || code.includes("CUSTODY") || code.includes("FINGERPRINT") ? 503 :
        code.includes("OWNER") ? 403 : 503;
      reject(res, status, code);
    }
  });

  return router;
}
