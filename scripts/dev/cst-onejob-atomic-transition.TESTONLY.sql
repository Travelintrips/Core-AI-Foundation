-- TEST-ONLY disposable PostgreSQL fixture, NEVER apply to CST-DEV/PROD.
-- Illustrates transactional invariants using SYNTHETIC rows and mock
-- independent readiness. Does not perform or authorize real QA verification.
-- Existing operational broker remains unconditional DENY.
CREATE TABLE ai_platform.cst_onejob_fixture_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id integer NOT NULL UNIQUE,
  action text NOT NULL CHECK(action='onejob_queued'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION cst_onejob_private.fixture_atomic_admit(
  p_job_id integer,p_fault text DEFAULT ''
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog
AS $fixture$
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
     OR a.request_id<>r.request_id
     OR a.request_id<>(j.payload_json->>'requestId')
     OR a.model_id<>'qwen2.5:3b'
     OR j.payload_json->>'modelId'<>'qwen2.5:3b'
     OR a.worker_name<>r.worker_name OR a.source_sha<>r.image_source_sha
     OR r.company_id<>'1'
  THEN RAISE EXCEPTION 'FIXTURE_PRECONDITIONS_DENIED'; END IF;

  INSERT INTO cst_onejob_private.admission_receipt_consumptions
    (receipt_id,approval_id,job_id,project_id,verifier_id,nonce,proof_digest)
  VALUES (r.id,a.id,j.id,'xssrfshdrtdfupgqwfdw',
          r.verifier_id,r.nonce,r.proof_digest);
  IF p_fault='after_consumption' THEN
    RAISE EXCEPTION 'FIXTURE_INJECTED_after_consumption'; END IF;
  UPDATE cst_onejob_private.verified_admission_receipts
    SET consumed_at=clock_timestamp()
    WHERE id=r.id AND consumed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE_RECEIPT_RACE'; END IF;
  IF p_fault='after_receipt' THEN
    RAISE EXCEPTION 'FIXTURE_INJECTED_after_receipt'; END IF;
  UPDATE ai_platform.ai_jobs SET status='queued'
    WHERE id=j.id AND status='waiting';
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE_JOB_RACE'; END IF;
  IF p_fault='after_job' THEN
    RAISE EXCEPTION 'FIXTURE_INJECTED_after_job'; END IF;
  UPDATE ai_platform.cst_onejob_owner_approvals
    SET status='CONSUMED', consumed_at=clock_timestamp()
    WHERE id=a.id AND status='APPROVED' AND consumed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIXTURE_APPROVAL_RACE'; END IF;
  IF p_fault='after_approval' THEN
    RAISE EXCEPTION 'FIXTURE_INJECTED_after_approval'; END IF;
  INSERT INTO ai_platform.cst_onejob_fixture_audit(job_id,action)
    VALUES (j.id,'onejob_queued');
  IF p_fault='after_audit' THEN
    RAISE EXCEPTION 'FIXTURE_INJECTED_after_audit'; END IF;
END;
$fixture$;

DO $test$
DECLARE
  fault text;
  count_consumed integer;
BEGIN
  -- Earlier replay tests have already consumed ONE synthetic receipt.
  SELECT count(*) INTO count_consumed
    FROM cst_onejob_private.admission_receipt_consumptions;
  IF count_consumed<>1 THEN RAISE EXCEPTION 'FIXTURE_BASELINE_WRONG'; END IF;
  FOREACH fault IN ARRAY ARRAY[
    'after_consumption','after_receipt','after_job',
    'after_approval','after_audit'
  ] LOOP
    BEGIN
      PERFORM cst_onejob_private.fixture_atomic_admit(485,fault);
      RAISE EXCEPTION 'FIXTURE_FAULT_DID_NOT_ROLL_BACK';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM<>('FIXTURE_INJECTED_'||fault) THEN RAISE; END IF;
    END;
    IF (SELECT count(*) FROM cst_onejob_private.admission_receipt_consumptions)<>1
      OR (SELECT status FROM ai_platform.ai_jobs WHERE id=485)<>'waiting'
      OR (SELECT status FROM ai_platform.cst_onejob_owner_approvals
          WHERE job_id=485)<>'APPROVED'
      OR (SELECT consumed_at FROM cst_onejob_private.verified_admission_receipts
          WHERE job_id=485) IS NOT NULL
      OR (SELECT count(*) FROM ai_platform.cst_onejob_fixture_audit)<>0
    THEN RAISE EXCEPTION 'FIXTURE_PARTIAL_WRITE_AFTER_%',fault; END IF;
  END LOOP;
  -- One controlled fixture success proves atomic updates, not operational QA.
  PERFORM cst_onejob_private.fixture_atomic_admit(485,'');
  IF (SELECT count(*) FROM cst_onejob_private.admission_receipt_consumptions)<>2
    OR (SELECT status FROM ai_platform.ai_jobs WHERE id=485)<>'queued'
    OR (SELECT status FROM ai_platform.cst_onejob_owner_approvals
        WHERE job_id=485)<>'CONSUMED'
    OR (SELECT consumed_at FROM cst_onejob_private.verified_admission_receipts
        WHERE job_id=485) IS NULL
    OR (SELECT count(*) FROM ai_platform.cst_onejob_fixture_audit
        WHERE job_id=485 AND action='onejob_queued')<>1
  THEN RAISE EXCEPTION 'FIXTURE_ATOMIC_SUCCESS_INCONSISTENT'; END IF;
  BEGIN
    PERFORM cst_onejob_private.fixture_atomic_admit(485,'');
    RAISE EXCEPTION 'FIXTURE_REPLAY_WAS_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'FIXTURE_PRECONDITIONS_DENIED' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM ai_platform.cst_onejob_fixture_audit)<>1
    OR (SELECT count(*) FROM cst_onejob_private.admission_receipt_consumptions)<>2
  THEN RAISE EXCEPTION 'FIXTURE_REPLAY_CHANGED_STATE'; END IF;
  RAISE NOTICE 'CST_ONEJOB_DISPOSABLE_ATOMIC_5_ROLLBACK_SUCCESS_REPLAY_PASS';
END
$test$;
-- Never grant this fixture function to anyone; it exists only in --network none
-- ephemeral PostgreSQL. It is not an operational broker implementation.
