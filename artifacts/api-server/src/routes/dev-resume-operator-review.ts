/** DEV-only operator identity readback for GPT02 resume approval readiness.
 * No signer, grant issuer, lease acquisition or dispatch; the existing\n * role middleware may write a standard access audit entry.
 * This endpoint is intentionally authenticated with the Internal Portal's
 * session cookie and re-read DB role, NOT the permissive admin API key guard.
 */
import { Router } from "express";
import { requireAuth, requireInternalRole, requirePasswordChanged } from "../middleware/internalAuth.js";
import { getDevResumeOperatorCommandPreflight } from "../services/jobLifecycleOperatorCommandPreflight.js";
import { getDevCommandRecoveryReview } from "../services/jobLifecycleRecoveryReview.js";
import { signDevOperatorReviewIntent } from "../services/jobLifecycleOperatorReviewSigner.js";
import { persistSignedDevOperatorReviewIntent } from "../services/jobLifecycleOperatorReviewPersistence.js";
import { isTrustedDevReviewWriterReady } from "../services/jobLifecycleReviewWriterReadiness.js";
import { getDevStoredReviewReadback } from "../services/jobLifecycleStoredReviewReadback.js";
import { getDevCommandEvidenceSummary } from "../services/jobLifecycleDevEvidenceSummary.js";

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
/** Read-only consolidated DEV command evidence. Not a release permit. */
router.get(
  "/ai/core-chat/dev/resume/commands/:commandId/evidence-summary",
  requireAuth,requireInternalRole("owner","admin"),requirePasswordChanged,
  async(req,res):Promise<void>=>{
    res.setHeader("Cache-Control","no-store");
    if(process.env["APP_ENV"]!=="development"||process.env["NODE_ENV"]==="production"){
      res.status(404).json({error:"Not found"});return;
    }
    const commandId=String(req.params["commandId"]??"");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)){
      res.status(400).json({error:"Invalid command ID",releaseDecision:"NO_GO",
        maySign:false,mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false});return;
    }
    try{
      const summary=await getDevCommandEvidenceSummary(commandId);
      res.status(summary.found?200:404).json(summary);
    }catch{
      res.status(503).json({error:"DEV evidence summary unavailable",releaseDecision:"NO_GO",
        maySign:false,mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false});
    }
  },
);
/** Diagnostic verification of an existing review, never grant issuance.
 * Session + current DB role are enforced by the existing middleware.
 * No signing flag required because this endpoint is strictly read-only.
 */
router.get(
  "/ai/core-chat/dev/resume/reviews/:reviewId/verification",
  requireAuth,requireInternalRole("owner","admin"),requirePasswordChanged,
  async(req,res):Promise<void>=>{
    res.setHeader("Cache-Control","no-store");
    if(process.env["APP_ENV"]!=="development"||process.env["NODE_ENV"]==="production"){
      res.status(404).json({error:"Not found"});return;
    }
    const reviewId=String(req.params["reviewId"]??"");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reviewId)){
      res.status(400).json({error:"Invalid review ID",mayIssueGrant:false,mayDispatchWorker:false});return;
    }
    try {
      const result=await getDevStoredReviewReadback({
        reviewId,trustedPublicKeyDerBase64:
          process.env["AI_CORE_DEV_OPERATOR_APPROVAL_PUBLIC_KEY_DER_BASE64"],
      });
      res.status(result.reason==="STORED_REVIEW_NOT_FOUND"?404:200).json(result);
    }catch{
      res.status(503).json({verified:false,reason:"STORED_REVIEW_VERIFICATION_UNAVAILABLE",
        mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false});
    }
  },
);
/** Deliberately disabled unless separate DEV-only signing flag, verified
 * same-origin request and operator acknowledgement are all present.
 * Output is a REVIEW INTENT, NEVER an actionable grant or dispatch.
 */
router.post(
  "/ai/core-chat/dev/resume/commands/:commandId/sign-review-intent",
  requireAuth,requireInternalRole("owner","admin"),requirePasswordChanged,
  async(req,res):Promise<void>=>{
    if(process.env["APP_ENV"]!=="development"||process.env["NODE_ENV"]==="production"){
      res.status(404).json({error:"Not found"});return;
    }
    if(process.env["AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED"]!=="true"){
      res.status(404).json({error:"Not found"});return;
    }
    const trustedOrigin=process.env["AI_CORE_DEV_OPERATOR_REVIEW_ORIGIN"]?.trim();
    const requestOrigin=req.get("origin");
    // Origin and non-simple custom header protect the cookie-authenticated
    // browser endpoint against cross-site form submissions.
    if(!trustedOrigin||!requestOrigin||requestOrigin!==trustedOrigin||
       !req.is("application/json")||
       req.get("x-ai-core-review-intent")!=="explicit"){
      res.status(403).json({error:"Verified same-origin operator action required"});return;
    }
    const body=req.body as unknown;
    if(!body||typeof body!=="object"||Array.isArray(body)||
       Object.keys(body as Record<string,unknown>).sort().join(",")!=="acknowledgement"||
       (body as Record<string,unknown>)["acknowledgement"]!=="SIGN_REVIEW_INTENT_ONLY"){
      res.status(400).json({error:"Explicit review-only acknowledgement required"});return;
    }
    const commandId=String(req.params["commandId"]??"");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)){
      res.status(400).json({error:"Invalid command ID"});return;
    }
    const user=req.internalUser;
    if(!user){res.status(401).json({error:"Not authenticated"});return;}
    // Hard fail-closed until a separate, proof-bound, atomic writer exists.
    // Do not let an env flag alone activate review signing or persistence.
    if(!isTrustedDevReviewWriterReady()){
      res.status(503).json({signed:false,reason:"TRUSTED_REVIEW_WRITER_NOT_IMPLEMENTED",
        mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false});return;
    }
    try{
      const review=await getDevCommandRecoveryReview(commandId);
      if(!review.found){res.status(404).json({error:"Command not found"});return;}
      const signing=signDevOperatorReviewIntent({
       operator:{id:user.id,role:user.role,status:user.status,
        accountType:user.accountType,mustChangePassword:user.mustChangePassword},
       commandId,commandStatus:review.commandStatus,
       checkpointResponseId:review.checkpointResponseId,
       blockerResponseId:review.blockingResponseId,
       workerId:"openclaw-dell-chatgpt-wake-dev",
       now:new Date(),commandEvidenceVerified:true,
       checkpointAttested:review.checkpointAttested,
       nativeAckVerified:review.receiverAckVerified,
       blockerEvidenceVerified:review.blockerEvidenceValid,
       responseSnapshotComplete:review.responseSnapshotComplete,
       explicitReviewAcknowledgement:true,
       appEnv:process.env["APP_ENV"],nodeEnv:process.env["NODE_ENV"],
       enabledByServer:process.env["AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED"]==="true",
       privateKeyDerBase64:process.env["AI_CORE_DEV_OPERATOR_APPROVAL_PRIVATE_KEY_DER_BASE64"],
       trustedPublicKeyDerBase64:process.env["AI_CORE_DEV_OPERATOR_APPROVAL_PUBLIC_KEY_DER_BASE64"],
      });
      res.setHeader("Cache-Control","no-store");
      if(!signing.signed||!signing.proof){
        res.status(409).json(signing);return;
      }
      // Persist atomically before returning any signed proof. Failure refuses
      // a success response; this is NOT a grant issuance or resume.
      const persisted=await persistSignedDevOperatorReviewIntent({
        proof:signing.proof,
        trustedPublicKeyDerBase64:process.env["AI_CORE_DEV_OPERATOR_APPROVAL_PUBLIC_KEY_DER_BASE64"],
        operatorUserId:user.id,operatorRole:user.role as "owner"|"admin",now:new Date(),
      });
      if(!persisted.recorded){
        res.status(409).json({signed:false,reason:persisted.reason,
          mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false});return;
      }
      res.status(200).json({...signing,recorded:true,recordId:persisted.recordId});
    }catch{
      res.status(503).json({error:"Signing review unavailable",
       mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false});
    }
  },
);
export default router;
