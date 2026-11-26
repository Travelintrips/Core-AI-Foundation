/** CST-DEV Issue238: authenticated, READ-ONLY bound AI Core claim verification.
 * No work creation, approval, nonce reservation, permit or QA execution.
 */
import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { z } from "zod";
import { requireAgentServiceScope } from "../middleware/agentServiceAuth.js";

const ID = z.string().uuid();
const WORKER = "openclaw-vps-main";
const TOKEN_NAME = "openclaw-vps-dev-consumer";
const PURPOSE = "issue238-pg17-disposable-qa";

type VerifiedClaim = { commandId: string; jobId: string; leaseExpiresAt: string };
type ReadClaim = (commandId: string, claimToken: string) => Promise<VerifiedClaim | null>;

export const readIssue238ActiveClaim: ReadClaim = async (commandId, claimToken) => {
  // Every predicate is applied inside the DB using its own current clock.
  // Do not accept worker-provided status, assignment, purpose or expiry.
  const rows = await db.execute(sql`
    SELECT id::text AS "commandId", task_id::text AS "jobId",
           metadata_json->>'claimLeaseExpiresAt' AS "leaseExpiresAt"
    FROM ai_platform.ai_coding_bridge_commands
    WHERE id = ${commandId}::uuid
      AND task_id IS NOT NULL
      AND status = 'PROCESSING'
      AND metadata_json->>'assignedClientId' = ${WORKER}
      AND metadata_json->>'claimedBy' = ${WORKER}
      AND metadata_json->>'issue238QaPurpose' = ${PURPOSE}
      AND metadata_json->>'claimToken' = ${claimToken}
      AND (metadata_json->>'claimLeaseExpiresAt')::timestamptz > clock_timestamp()
      AND (metadata_json->>'claimLeaseExpiresAt')::timestamptz <=
          clock_timestamp() + INTERVAL '5 minutes'
    LIMIT 1
  `);
  const row = rows.rows?.[0] as Record<string, unknown> | undefined;
  return row && typeof row.commandId === "string" &&
    typeof row.jobId === "string" && typeof row.leaseExpiresAt === "string"
      ? { commandId:row.commandId,jobId:row.jobId,leaseExpiresAt:row.leaseExpiresAt }
      : null;
};

export function createIssue238ReadonlyClaimRouter(readClaim: ReadClaim = readIssue238ActiveClaim) {
  const router = Router();
  router.get("/:commandId", requireAgentServiceScope("agent:work"), async (req,res) => {
    res.setHeader("Cache-Control","no-store");
    if (process.env.APP_ENV !== "development" ||
        req.hostname !== "dev.cstlogistic.co.id") {
      res.status(403).json({error:"CST_DEV_ONLY"}); return;
    }
    const service = res.locals.aiAgentService as
      {id?:string;name?:string;scopes?:string[]} | undefined;
    if (!service?.id || service.name !== TOKEN_NAME ||
        !service.scopes?.includes("agent:work")) {
      res.status(403).json({error:"VPS_WORKER_CREDENTIAL_REQUIRED"});return;
    }
    const commandId=ID.safeParse(req.params.commandId);
    const claimToken=ID.safeParse(req.header("x-ai-claim-token"));
    if (!commandId.success || !claimToken.success) {
      res.status(400).json({error:"BOUND_COMMAND_AND_CLAIM_REQUIRED"});return;
    }
    try {
      const claim=await readClaim(commandId.data,claimToken.data);
      if (!claim) {res.status(404).json({error:"NO_VERIFIED_ACTIVE_ISSUE238_CLAIM"});return;}
      res.status(200).json({
        status:"VERIFIED_ACTIVE_CLAIM",
        purpose:PURPOSE,workerId:WORKER,
        commandId:claim.commandId,jobId:claim.jobId,
        leaseExpiresAt:claim.leaseExpiresAt,
        approvalIssued:false,permitIssued:false,qaExecuted:false,
      });
    } catch {
      res.status(503).json({error:"CLAIM_VERIFICATION_UNAVAILABLE"});
    }
  });
  return router;
}
