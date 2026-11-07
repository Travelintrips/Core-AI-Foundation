/** DEV-only operator identity readback for GPT02 resume approval readiness.
 * No signer, grant issuer, lease acquisition, dispatch or database mutation.
 * This endpoint is intentionally authenticated with the Internal Portal's
 * session cookie and re-read DB role, NOT the permissive admin API key guard.
 */
import { Router } from "express";
import { requireAuth, requireInternalRole, requirePasswordChanged } from "../middleware/internalAuth.js";

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
export default router;
