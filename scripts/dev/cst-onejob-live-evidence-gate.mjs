/**
 * One-job DEV evidence gate. Safe to run with catalog-only observations.
 * A positive configuration review is NEVER a queue/dispatch permission.
 */
const PROJECT="xssrfshdrtdfupgqwfdw";
const expectedPolicies=[
 "cst_onejob_stage_owner_select","cst_onejob_stage_insert",
 "cst_onejob_stage_select","cst_onejob_stage_approval_insert",
 "cst_onejob_stage_approval_select","cst_onejob_stage_audit_insert"
];
export function evaluateCstOneJobLiveGate(state) {
  const blockers=[];
  const check=(condition,reason)=>{if(!condition)blockers.push(reason)};
  check(state?.project===PROJECT,"DEV_PROJECT_ID_NOT_VERIFIED");
  check(state?.environment==="development","DEV_RUNTIME_NOT_VERIFIED");
  check(state?.sharedRuntimeHealthy===true,"CORE_AI_SHARED_DEV_NOT_HEALTHY");
  check(state?.approvalTablePresent===true&&
        state?.approvalTableForcedRls===true,"OWNER_LEDGER_RLS_MISSING");
  check(state?.oneJobIndexValid===true,"PILOT_REQUEST_UNIQUE_INDEX_MISSING");
  check(state?.writerNoLogin===true&&
        state?.writerNoBypassRls===true,"STAGING_WRITER_UNSAFE");
  check(state?.roleMembershipSetOnly===true,"STAGING_ROLE_MEMBERSHIP_UNSAFE");
  const policies=new Set(Array.isArray(state?.policyNames)?state.policyNames:[]);
  check(expectedPolicies.every(p=>policies.has(p)),"STAGING_RLS_POLICY_INCOMPLETE");
  check(state?.stageLoginEnabled===true,"DEDICATED_STAGING_LOGIN_DISABLED");
  check(state?.dedicatedStageUrlConfigured===true,"STAGE_SECRET_NOT_INSTALLED");
  check(state?.stageOwnerFeatureEnabled===true,"OWNER_STAGE_FEATURE_DISABLED");
  check(state?.independentQaPublicRootInstalled===true,"INDEPENDENT_QA_PUBLIC_ROOT_MISSING");
  check(state?.independentQaIssuerVerified===true,"INDEPENDENT_QA_ISSUER_NOT_VERIFIED");
  check(state?.oneUseAdmissionBrokerVerified===true,"ONE_USE_BROKER_NOT_VERIFIED");
  check(state?.jobCardinalityIndependentlyVerified===true,
        "PILOT_JOB_CARDINALITY_NOT_INDEPENDENTLY_VERIFIED");
  check(state?.subscriberReceiptVerified===true,"SUBSCRIBER_RECEIPT_NOT_VERIFIED");
  check(state?.independentFinalAckVerified===true,"INDEPENDENT_FINAL_ACK_NOT_VERIFIED");
  check(state?.historicalJob482Unchanged===true,"HISTORIC_JOB_482_NOT_VERIFIED");
  return {
    project:PROJECT,
    assessment:"READ_ONLY_EVIDENCE_CATALOG",
    configPreflight: blockers.length===0?"CONDITIONS_REPORTED_COMPLETE":"INCOMPLETE",
    blockers,
    // A status report cannot grant authority, even if all inputs are marked
    // true. Real admission must recheck signed proof under locked transaction.
    releaseDecision:"NO_GO",
    stageExecutionAuthorized:false,
    queueTransitionAuthorized:false,
    dispatchPermitted:false,
    signerActivationPermitted:false,
    finalAckIssued:false,
  };
}
