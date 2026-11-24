import { Router, type Request, type Response } from "express";
import type { Gpt02OwnerActor } from "../services/gpt02RelockOwnerApprovalService.js";

const HOST = "dev-ai-task.cstlogistic.co.id";
const CHALLENGE_UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const OWNER_EMAIL = "admcst001@gmail.com";

export type OwnerLedgerReceipt = Readonly<{
  challengeId: string;
  scope: "GPT02_RELOCK_CST_DEV";
  status: "CONSUMED";
  decision: "APPROVED";
  manifestSha256: string;
  decidedAt: string;
}>;

export type OwnerLedgerReadOptions = Readonly<{
  verifyOwnerSession: (token: string) => Promise<Gpt02OwnerActor>;
  verifyOwnerEligibility: (actor: Gpt02OwnerActor, token: string) => Promise<boolean>;
  // This MUST use the separately authenticated, pinned-TLS, least-privilege
  // gpt02_owner_ledger_reader_dev Postgres role. No main runtime DB fallback.
  readReceipt: (challengeId: string, actor: Gpt02OwnerActor) => Promise<OwnerLedgerReceipt | null>;
}>;

function countHeader(req: Request, name: string): number {
  let count = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i]?.toLowerCase() === name) count++;
  }
  return count;
}

function tokenFrom(req: Request): string | null {
  if (countHeader(req, "authorization") !== 1) return null;
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  if (token.length < 48 || token.length > 4096 || /\s/.test(token)) return null;
  return token;
}

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

export function createGpt02OwnerLedgerReadRouter(options: OwnerLedgerReadOptions): Router {
  if (
    typeof options?.verifyOwnerSession !== "function" ||
    typeof options?.verifyOwnerEligibility !== "function" ||
    typeof options?.readReceipt !== "function"
  ) throw new Error("GPT02_OWNER_LEDGER_TRUSTED_ADAPTERS_REQUIRED");
  const router = Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store").set("Pragma", "no-cache");
    if (
      req.method !== "GET" ||
      countHeader(req, "host") !== 1 ||
      req.get("host") !== HOST ||
      countHeader(req, "origin") > 1 ||
      (req.get("origin") && req.get("origin") !== `https://${HOST}`) ||
      countHeader(req, "cookie") > 0 ||
      countHeader(req, "transfer-encoding") > 0
    ) {
      fail(res, 404, "GPT02_LEDGER_ROUTE_NOT_FOUND");
      return;
    }
    next();
  });

  router.get("/decision/:challengeId", async (req, res): Promise<void> => {
    const challengeId = req.params.challengeId;
    if (typeof challengeId !== "string" || !CHALLENGE_UUID.test(challengeId)) {
      fail(res, 400, "GPT02_LEDGER_CHALLENGE_INVALID");
      return;
    }
    const token = tokenFrom(req);
    if (!token) {
      fail(res, 401, "GPT02_LEDGER_FRESH_OWNER_SESSION_REQUIRED");
      return;
    }
    try {
      const actor = await options.verifyOwnerSession(token);
      if (
        actor.role !== "super_admin" ||
        actor.email.toLowerCase() !== OWNER_EMAIL ||
        !(actor.companyId === null || actor.companyId === "default") ||
        !await options.verifyOwnerEligibility(actor, token)
      ) {
        fail(res, 403, "GPT02_LEDGER_VERIFIED_OWNER_REQUIRED");
        return;
      }
      const receipt = await options.readReceipt(challengeId, actor);
      if (!receipt) {
        fail(res, 404, "GPT02_LEDGER_DECISION_NOT_FOUND");
        return;
      }
      if (
        receipt.challengeId !== challengeId ||
        receipt.scope !== "GPT02_RELOCK_CST_DEV" ||
        receipt.status !== "CONSUMED" ||
        receipt.decision !== "APPROVED" ||
        !/^[a-f0-9]{64}$/.test(receipt.manifestSha256) ||
        !Number.isFinite(Date.parse(receipt.decidedAt))
      ) {
        fail(res, 503, "GPT02_LEDGER_RECEIPT_INVALID");
        return;
      }
      res.status(200).json({
        ...receipt,
        readOnly: true,
        executionPermitted: false,
        signingPermitted: false,
        dispatchPermitted: false,
        releaseDecision: "NO_GO",
      });
    } catch {
      // Never expose underlying database / token / signature errors.
      fail(res, 503, "GPT02_LEDGER_READER_OR_SESSION_UNAVAILABLE");
    }
  });
  return router;
}
