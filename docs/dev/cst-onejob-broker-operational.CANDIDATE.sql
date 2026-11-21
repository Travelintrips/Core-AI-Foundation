-- CANDIDATE ONLY. NOT APPLIED TO CST-DEV OR PROD.
-- The trusted, independently custodied QA broker MUST verify the detached
-- Ed25519 signature and independently obtained evidence BYTES in the same
-- transaction handoff BEFORE invoking this function. SQL never infers
-- authenticity from boolean fields, a client digest or receipt row presence.
-- No roles, credentials, RLS grants, logins or migration are installed here.
CREATE SCHEMA IF NOT EXISTS cst_onejob_private;
REVOKE ALL ON SCHEMA cst_onejob_private FROM PUBLIC;
CREATE TABLE cst_onejob_private.admission_event_outbox (
  job_id integer PRIMARY KEY REFERENCES ai_platform.ai_jobs(id),
  approval_id uuid NOT NULL UNIQUE
    REFERENCES ai_platform.cst_onejob_owner_approvals(id),
  nonce text NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{64}$'),
  proof_digest text NOT NULL UNIQUE CHECK(proof_digest ~ '^[a-f0-9]{64}$'),
  project_id text NOT NULL CHECK(project_id='xssrfshdrtdfupgqwfdw'),
  event_type text NOT NULL CHECK(event_type='cst_onejob.admitted'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE cst_onejob_private.admission_event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.admission_event_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.admission_event_outbox FROM PUBLIC;

CREATE OR REPLACE FUNCTION cst_onejob_private.admit_verified_onejob(
  p_job_id integer,p_verified_nonce text,p_verified_digest text
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $broker$
DECLARE
  a ai_platform.cst_onejob_owner_approvals%ROWTYPE;
  j ai_platform.ai_jobs%ROWTYPE;
  r cst_onejob_private.verified_admission_receipts%ROWTYPE;
  t timestamptz;
BEGIN
  IF p_job_id IS NULL OR p_job_id<=0 OR p_job_id=482
     OR p_verified_nonce !~ '^[a-f0-9]{64}$'
     OR p_verified_digest !~ '^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'ONEJOB_INVALID_ADMISSION_ARGUMENT'; END IF;
  -- DB is the authority. Deterministic lock order serializes racing callers.
  SELECT * INTO a FROM ai_platform.cst_onejob_owner_approvals
    WHERE job_id=p_job_id FOR UPDATE;
  SELECT * INTO j FROM ai_platform.ai_jobs WHERE id=p_job_id FOR UPDATE;
  SELECT * INTO r FROM cst_onejob_private.verified_admission_receipts
    WHERE job_id=p_job_id FOR UPDATE;
  t:=clock_timestamp();
  IF a.id IS NULL OR j.id IS NULL OR r.id IS NULL
     OR a.purpose<>'CST_DEV_ONEJOB_MODEL'
     OR a.status<>'APPROVED' OR a.consumed_at IS NOT NULL
     OR a.company_id<>'1' OR a.model_id<>'qwen2.5:3b'
     OR a.approved_at>t OR a.expires_at<=t
     OR j.id<>a.job_id OR j.status<>'waiting'
     OR j.job_type<>'ollama_model_invocation'
     OR j.required_capability<>'ollama_inference'
     OR j.max_retry<>0
     OR j.payload_json->>'modelId'<>'qwen2.5:3b'
     OR j.payload_json->>'requestId'<>a.request_id
     OR r.approval_id<>a.id OR r.job_id<>j.id
     OR r.company_id<>'1' OR r.request_id<>a.request_id
     OR r.worker_name<>a.worker_name
     OR r.image_source_sha<>a.source_sha
     OR r.verified_at>t OR r.expires_at<=t OR r.consumed_at IS NOT NULL
     OR r.nonce<>p_verified_nonce OR r.proof_digest<>p_verified_digest
     OR NOT EXISTS (
       SELECT 1 FROM ai_platform.internal_users u
       WHERE u.id=a.approved_by_user_id AND u.account_type='internal'
         AND u.role='owner' AND u.status='active'
     )
  THEN RAISE EXCEPTION 'ONEJOB_SIGNED_ADMISSION_NOT_BOUND'; END IF;
  -- Receipt booleans never grant queue authority without independent QA.
  INSERT INTO cst_onejob_private.admission_receipt_consumptions
    (receipt_id,approval_id,job_id,project_id,verifier_id,nonce,proof_digest)
  VALUES(r.id,a.id,j.id,'xssrfshdrtdfupgqwfdw',
    r.verifier_id,r.nonce,r.proof_digest);
  UPDATE cst_onejob_private.verified_admission_receipts
    SET consumed_at=t WHERE id=r.id AND consumed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ONEJOB_RECEIPT_REPLAY'; END IF;
  UPDATE ai_platform.ai_jobs SET status='queued'
    WHERE id=j.id AND status='waiting';
  IF NOT FOUND THEN RAISE EXCEPTION 'ONEJOB_NOT_WAITING'; END IF;
  UPDATE ai_platform.cst_onejob_owner_approvals
    SET status='CONSUMED',consumed_at=t
    WHERE id=a.id AND status='APPROVED' AND consumed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ONEJOB_APPROVAL_REPLAY'; END IF;
  -- DB writes, audit, and durable outbox are one atomic transaction.
  INSERT INTO ai_platform.ai_audit_logs
    (module,action,resource_type,resource_id,status,details)
  VALUES('cst-onejob','signed_admission_queued','ai_job',j.id::text,
    'success',jsonb_build_object(
      'approvalId',a.id,'nonce',r.nonce,'proofDigest',r.proof_digest,
      'requestId',a.request_id,'dispatchPermitted',false));
  INSERT INTO cst_onejob_private.admission_event_outbox
    (job_id,approval_id,nonce,proof_digest,project_id,event_type)
  VALUES(j.id,a.id,r.nonce,r.proof_digest,
    'xssrfshdrtdfupgqwfdw','cst_onejob.admitted');
  RETURN j.id;
END;
$broker$;
REVOKE ALL ON FUNCTION
  cst_onejob_private.admit_verified_onejob(integer,text,text) FROM PUBLIC;
-- NO GRANTS: dedicated broker login/role, RLS and trust root must be separately
-- reviewed and authorized. A healthy runtime is not proof of E2E delivery.
