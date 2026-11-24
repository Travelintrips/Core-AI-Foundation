-- TEST-ONLY / --network none disposable PostgreSQL, NEVER run on CST-DEV/PROD.
-- This SECURITY INVOKER fixture is called ONLY after a separate Node process
-- verifies a synthetic Ed25519 receipt and the independent evidence bytes.
-- Proof digest and nonce remain tied to the row under FOR UPDATE locks.
-- This does not implement real trust custody, broker permissions or dispatch.
CREATE TABLE ai_platform.cst_onejob_signed_fixture_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id integer NOT NULL UNIQUE,
  nonce text NOT NULL UNIQUE,
  proof_digest text NOT NULL UNIQUE
);

CREATE FUNCTION cst_onejob_private.fixture_signed_handoff_admit(
 p_job_id integer,p_verified_nonce text,p_verified_digest text,
 p_injected_failure text DEFAULT ''
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $signed_fixture$
DECLARE
 a ai_platform.cst_onejob_owner_approvals%ROWTYPE;
 j ai_platform.ai_jobs%ROWTYPE;
 r cst_onejob_private.verified_admission_receipts%ROWTYPE;
BEGIN
 IF p_job_id=482 THEN RAISE EXCEPTION 'FIXTURE_HISTORICAL_JOB_BLOCKED'; END IF;
 SELECT * INTO a FROM ai_platform.cst_onejob_owner_approvals
   WHERE job_id=p_job_id FOR UPDATE;
 SELECT * INTO j FROM ai_platform.ai_jobs
   WHERE id=p_job_id FOR UPDATE;
 SELECT * INTO r FROM cst_onejob_private.verified_admission_receipts
   WHERE job_id=p_job_id FOR UPDATE;
 IF a.id IS NULL OR j.id IS NULL OR r.id IS NULL
   OR a.status<>'APPROVED' OR a.consumed_at IS NOT NULL
   OR a.expires_at<=clock_timestamp()
   OR j.status<>'waiting' OR j.job_type<>'ollama_model_invocation'
   OR j.required_capability<>'ollama_inference' OR j.max_retry<>0
   OR r.consumed_at IS NOT NULL OR r.expires_at<=clock_timestamp()
   OR r.approval_id<>a.id OR r.job_id<>j.id
   OR a.job_id<>j.id
   OR a.request_id<>r.request_id
   OR a.request_id<>(j.payload_json->>'requestId')
   OR a.model_id<>'qwen2.5:3b'
   OR j.payload_json->>'modelId'<>'qwen2.5:3b'
   OR a.worker_name<>r.worker_name
   OR a.source_sha<>r.image_source_sha
   OR r.company_id<>'1'
   OR r.nonce<>p_verified_nonce OR r.proof_digest<>p_verified_digest
 THEN RAISE EXCEPTION 'FIXTURE_SIGNED_BINDING_NOT_ADMISSIBLE'; END IF;

 INSERT INTO cst_onejob_private.admission_receipt_consumptions
   (receipt_id,approval_id,job_id,project_id,verifier_id,nonce,proof_digest)
 VALUES (r.id,a.id,j.id,'xssrfshdrtdfupgqwfdw',
         r.verifier_id,r.nonce,r.proof_digest);
 UPDATE cst_onejob_private.verified_admission_receipts
   SET consumed_at=clock_timestamp()
   WHERE id=r.id AND consumed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE_RECEIPT_ALREADY_CONSUMED'; END IF;
 UPDATE ai_platform.ai_jobs SET status='queued'
   WHERE id=j.id AND status='waiting';
 IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE_JOB_NOT_WAITING'; END IF;
 IF p_injected_failure='after_job'
 THEN RAISE EXCEPTION 'FIXTURE_INJECTED_AFTER_JOB'; END IF;
 UPDATE ai_platform.cst_onejob_owner_approvals
   SET status='CONSUMED',consumed_at=clock_timestamp()
   WHERE id=a.id AND status='APPROVED' AND consumed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE_APPROVAL_ALREADY_USED'; END IF;
 INSERT INTO ai_platform.cst_onejob_signed_fixture_audit
   (job_id,nonce,proof_digest) VALUES(j.id,r.nonce,r.proof_digest);
END;
$signed_fixture$;
-- No GRANT/role bindings; function is present ONLY in a disposable DB and
-- must not be treated as a reusable operational SECURITY INVOKER broker.
