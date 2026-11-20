-- CST-DEV independent one-job QA and subscriber WRITE SCOPE CANDIDATE.
-- DO NOT APPLY TO CONNECTED DEV OR PROD. Requires reviewed change window,
-- approved independent secret custody, restricted LOGIN and QA host identity.
-- CREATEs NO LOGIN, password, credential, signer or dispatcher authority.
-- Apply only AFTER existing owner ledger + proposed receipt + subscriber ledgers.
-- Existing staging RLS and indexes are reused, not rebuilt.
CREATE ROLE cst_onejob_qa_receipt_writer NOLOGIN NOINHERIT
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE cst_onejob_subscriber_writer NOLOGIN NOINHERIT
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA ai_platform,cst_onejob_private
  TO cst_onejob_qa_receipt_writer,cst_onejob_subscriber_writer;

-- QA: READ only Owner-approved WAITING Company-1 job and current Owner status.
CREATE POLICY cst_onejob_qa_owner_read ON ai_platform.internal_users
  FOR SELECT TO cst_onejob_qa_receipt_writer
  USING (role='owner' AND status='active' AND account_type='internal');
GRANT SELECT (id,role,status,account_type)
  ON ai_platform.internal_users TO cst_onejob_qa_receipt_writer;
CREATE POLICY cst_onejob_qa_approval_read
  ON ai_platform.cst_onejob_owner_approvals
  FOR SELECT TO cst_onejob_qa_receipt_writer
  USING (company_id='1' AND status='APPROVED' AND consumed_at IS NULL
    AND purpose='CST_DEV_ONEJOB_MODEL');
GRANT SELECT (id,job_id,purpose,status,company_id,model_id,request_id,
  worker_name,source_sha,approved_at,expires_at,consumed_at,
  approved_by_user_id)
  ON ai_platform.cst_onejob_owner_approvals TO cst_onejob_qa_receipt_writer;
CREATE POLICY cst_onejob_qa_job_read ON ai_platform.ai_jobs
  FOR SELECT TO cst_onejob_qa_receipt_writer
  USING (status='waiting' AND job_type='ollama_model_invocation'
    AND required_capability='ollama_inference' AND max_retry=0
    AND payload_json->>'modelId'='qwen2.5:3b'
    AND payload_json->>'requestId' ~
      '^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$');
GRANT SELECT (id,status,job_type,required_capability,max_retry,payload_json)
  ON ai_platform.ai_jobs TO cst_onejob_qa_receipt_writer;

CREATE POLICY cst_onejob_qa_receipt_insert
  ON cst_onejob_private.verified_admission_receipts
  FOR INSERT TO cst_onejob_qa_receipt_writer
  WITH CHECK (company_id='1' AND consumed_at IS NULL
    AND isolated_network_verified AND scoped_dev_role_verified
    AND event_audit_path_verified AND subscriber_path_verified
    AND independent_qa_available);
CREATE POLICY cst_onejob_qa_receipt_id_read
  ON cst_onejob_private.verified_admission_receipts
  FOR SELECT TO cst_onejob_qa_receipt_writer
  USING (company_id='1' AND consumed_at IS NULL);
GRANT INSERT (approval_id,job_id,company_id,request_id,worker_name,
  image_source_sha,image_id,isolated_network_verified,
  scoped_dev_role_verified,event_audit_path_verified,
  subscriber_path_verified,independent_qa_available,
  nonce,proof_digest,verifier_id,verified_at,expires_at)
  ON cst_onejob_private.verified_admission_receipts
  TO cst_onejob_qa_receipt_writer;
GRANT SELECT (id) ON cst_onejob_private.verified_admission_receipts
  TO cst_onejob_qa_receipt_writer;

-- Subscriber: READ actual terminal job, consumed approval, event and audit.
-- No UPDATE/DELETE grant for any source or for receipt.
CREATE POLICY cst_onejob_sub_approval_read
  ON ai_platform.cst_onejob_owner_approvals
  FOR SELECT TO cst_onejob_subscriber_writer
  USING (company_id='1' AND status='CONSUMED' AND consumed_at IS NOT NULL
    AND purpose='CST_DEV_ONEJOB_MODEL');
GRANT SELECT (id,job_id,company_id,status,model_id,request_id)
  ON ai_platform.cst_onejob_owner_approvals
  TO cst_onejob_subscriber_writer;
CREATE POLICY cst_onejob_sub_job_read ON ai_platform.ai_jobs
  FOR SELECT TO cst_onejob_subscriber_writer
  USING (status='completed' AND job_type='ollama_model_invocation'
    AND payload_json->>'modelId'='qwen2.5:3b'
    AND payload_json->>'requestId' ~
      '^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$');
GRANT SELECT (id,status,job_type,payload_json,result_json)
  ON ai_platform.ai_jobs TO cst_onejob_subscriber_writer;
CREATE POLICY cst_onejob_sub_event_read ON ai_platform.ai_events
  FOR SELECT TO cst_onejob_subscriber_writer
  USING (event_type='job.completed' AND source_module='job-engine'
    AND EXISTS (SELECT 1 FROM ai_platform.cst_onejob_owner_approvals a
      WHERE a.job_id::text=source_id AND a.status='CONSUMED'
        AND a.company_id='1'));
GRANT SELECT (event_id,event_type,source_module,source_id,
  correlation_id,status,payload_json)
  ON ai_platform.ai_events TO cst_onejob_subscriber_writer;

CREATE POLICY cst_onejob_sub_event_audit_read ON ai_platform.ai_audit_logs
  FOR SELECT TO cst_onejob_subscriber_writer
  USING (module='event-bus' AND action='event_published'
    AND status='success'
    AND EXISTS (SELECT 1 FROM ai_platform.ai_events e
      WHERE e.event_id=resource_id
        AND e.event_type='job.completed'
        AND e.source_module='job-engine'));
GRANT SELECT (module,action,resource_id,status,details)
  ON ai_platform.ai_audit_logs TO cst_onejob_subscriber_writer;

CREATE POLICY cst_onejob_subscriber_receipt_insert
  ON cst_onejob_private.subscriber_delivery_receipts
  FOR INSERT TO cst_onejob_subscriber_writer
  WITH CHECK (status='ACKNOWLEDGED' AND
    subscriber_id='cst-onejob-subscriber-pilot');
CREATE POLICY cst_onejob_subscriber_receipt_id_read
  ON cst_onejob_private.subscriber_delivery_receipts
  FOR SELECT TO cst_onejob_subscriber_writer
  USING (status='ACKNOWLEDGED' AND
    subscriber_id='cst-onejob-subscriber-pilot');
GRANT INSERT (approval_id,job_id,event_id,delivery_id,subscriber_id,
  correlation_id,delivery_digest,status,ack_nonce,ack_signature_base64,
  ack_issuer_fingerprint,received_at)
  ON cst_onejob_private.subscriber_delivery_receipts
  TO cst_onejob_subscriber_writer;
GRANT SELECT (id) ON cst_onejob_private.subscriber_delivery_receipts
  TO cst_onejob_subscriber_writer;

-- Audit INSERT remains append-only, restricted to exact action and signer role.
CREATE POLICY cst_onejob_qa_receipt_audit_insert ON ai_platform.ai_audit_logs
  FOR INSERT TO cst_onejob_qa_receipt_writer
  WITH CHECK (module='cst-onejob'
    AND action='independent_pre_admission_qa' AND status='success');
CREATE POLICY cst_onejob_subscriber_audit_insert ON ai_platform.ai_audit_logs
  FOR INSERT TO cst_onejob_subscriber_writer
  WITH CHECK (module='cst-onejob'
    AND action='independent_subscriber_ack' AND status='success');
GRANT INSERT (module,action,resource_type,resource_id,status,details)
  ON ai_platform.ai_audit_logs
  TO cst_onejob_qa_receipt_writer,cst_onejob_subscriber_writer;
GRANT USAGE ON SEQUENCE ai_platform.ai_audit_logs_id_seq
  TO cst_onejob_qa_receipt_writer,cst_onejob_subscriber_writer;

-- NO LOGIN creation or role membership to anyone. A trusted independent
-- credential custodian must review and provide dedicated service identities
-- via the ALLOWED secure provisioning mechanism. Do not bypass any prior block.
-- No update/delete on ai_jobs, events, approvals, receipts, or audit records.
-- Separate broker and final-ACK roles remain outside this proposal.
