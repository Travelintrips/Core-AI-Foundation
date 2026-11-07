/** DEV-only operator identity readback for GPT02 resume approval readiness.
 * No signer, grant issuer, lease acquisition or dispatch; the existing\n * role middleware may write a standard access audit entry.
 * This endpoint is intentionally authenticated with the Internal Portal's
 * session cookie and re-read DB role, NOT the permissive admin API key guard.
 */
import { Router } from "express";
import { requireAuth, requireInternalRole, requirePasswordChanged } from "../middleware/internalAuth.js";
import { getDevResumeOperatorCommandPreflight } from "../services/jobLifecycleOperatorCommandPreflight.js";

const router=Router();
router.get(
  "/ai/core-chat/dev/resume/operator-readiness",
  requireAuth,requireInternalRole("owner","admin"),requirePasswordChanged,
  (req,res):void=>{
    if(process.env["APP_ENV"]!=="development"||process.env["NODE_ENV"]==="production"){
      res.status(404).json({error:"Not found"});return;
    }
    const operator=req.internalUser;
    if(!operator||operator.status!=="active"||operator.accountType!=="internal"||
       (operator.role!=="owner"&&operator.role!=="admin")||
       operator.mustChangePassword){
      res.status(403).json({error:"Verified internal operator required"});return;
    }
    // Never return the session token, password hash, or database credentials.
    res.json({
      verifiedInternalOperator:true,
      operatorId:String(operator.id),
      operatorRole:operator.role,
      approvalSigningConfigured:false,
      operatorGrantIssuanceEnabled:false,
      mayIssueGrant:false,
      mayDispatchWorker:false,
      mayCloseJob:false,
      reason:"AUTHENTICATED_OPERATOR_ONLY_NO_SIGNER_OR_GRANT_ISSUER",
    });
  },
);
// Read-only live CST-DEV command evidence. An authenticated owner/admin can
// inspect why grant issuance is blocked; never sign, issue or resume here.
router.get(
  "/ai/core-chat/dev/resume/commands/:commandId/approval-preflight",
  requireAuth,requireInternalRole("owner","admin"),requirePasswordChanged,
  async (req,res):Promise<void>=>{
    if(process.env["APP_ENV"]!=="development"||process.env["NODE_ENV"]==="production"){
      res.status(404).json({error:"Not found"});return;
    }
    const commandId=String(req.params["commandId"]??"");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)){
      res.status(400).json({error:"Invalid command ID"});return;
    }
    try{
      const result=await getDevResumeOperatorCommandPreflight(commandId);
      res.status(result.found?200:404).json(result);
    }catch{
      res.status(503).json({error:"DEV approval preflight unavailable",
        mayIssueGrant:false,mayDispatchWorker:false});
    }
  },
);
export default router;
