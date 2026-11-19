-- Original live DEV function snapshot, disposable fixture ONLY.
SET ROLE gpt02_store_owner;
CREATE OR REPLACE FUNCTION gpt02_private.record_linked_approval(p_approval jsonb, p_signature text, p_digest text, p_link jsonb, p_hub_signature text, p_core_signature text, p_link_digest text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_task integer; v_command uuid; v_attempt uuid; v_link uuid;
  v_hub_execution uuid; v_core_task uuid;
  v_issued bigint; v_expires bigint; v_link_issued bigint; v_link_expires bigint;
  v_existing_approval gpt02_private.approvals%rowtype;
  v_existing_link gpt02_private.operator_links%rowtype;
BEGIN
  IF session_user<>'dev_gpt02_attestor_evidence' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ATTESTOR_SESSION_REQUIRED';
  END IF;
  IF jsonb_typeof(p_approval)<>'object' OR jsonb_typeof(p_link)<>'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_LINKED_APPROVAL_JSON';
  END IF;
  IF NOT (p_approval ?& ARRAY[
       'v','environment','audience','taskId','commandId','attemptId','nonce',
       'operatorNamespace','superAdminId','companyId','issuedAt','expiresAt'
     ])
     OR jsonb_object_length(p_approval)<>12
     OR p_approval->>'v' IS DISTINCT FROM '2'
     OR p_approval->>'environment' IS DISTINCT FROM 'DEV'
     OR p_approval->>'audience' IS DISTINCT FROM 'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL'
     OR p_approval->>'companyId' IS DISTINCT FROM 'default'
     OR p_approval->>'operatorNamespace' IS DISTINCT FROM 'ai-task-hub.public.users'
     OR coalesce(p_approval->>'superAdminId','') !~ '^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$'
     OR coalesce(p_approval->>'nonce','') !~ '^[A-Za-z0-9_-]{32,128}$'
     OR coalesce(p_signature,'') !~ '^[A-Za-z0-9_-]{86}$'
     OR coalesce(p_digest,'') !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_APPROVAL_CONTRACT'; END IF;

  BEGIN
    v_task:=(p_approval->>'taskId')::integer;
    v_command:=(p_approval->>'commandId')::uuid;
    v_attempt:=(p_approval->>'attemptId')::uuid;
    v_issued:=(p_approval->>'issuedAt')::bigint;
    v_expires:=(p_approval->>'expiresAt')::bigint;
    v_link:=(p_link->>'linkId')::uuid;
    v_hub_execution:=(p_link->>'hubExecutionId')::uuid;
    v_core_task:=(p_link->>'coreTaskId')::uuid;
    v_link_issued:=(p_link->>'issuedAt')::bigint;
    v_link_expires:=(p_link->>'expiresAt')::bigint;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_LINKED_APPROVAL_TYPES';
  END;

  IF v_task<=139 OR v_command=v_attempt
     OR v_issued<0 OR v_expires<=v_issued OR v_expires-v_issued>300000
     OR v_expires<=floor(extract(epoch from clock_timestamp())*1000)::bigint
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_OR_EXPIRED_APPROVAL'; END IF;

  IF NOT (p_link ?& ARRAY[
       'v','environment','audience','linkId','companyId','hubTaskId','hubExecutionId',
       'coreTaskId','coreCommandId','attemptId','attemptNumber','assigneeId',
       'accountableOwnerId','hubOperatorNamespace','hubOperatorId','hubRole','hubActive',
       'coreOperatorNamespace','coreOperatorUserId','coreRole','coreActive',
       'corePasswordChanged','workerId','approvalDigest','nonce','issuedAt','expiresAt'
     ])
     OR jsonb_object_length(p_link)<>27
     OR p_link->>'v' IS DISTINCT FROM '1'
     OR p_link->>'environment' IS DISTINCT FROM 'DEV'
     OR p_link->>'audience' IS DISTINCT FROM 'GPT02_DUAL_ACCOUNT_COMMAND_LINK'
     OR p_link->>'companyId' IS DISTINCT FROM 'default'
     OR (p_link->>'hubTaskId')::integer<>v_task
     OR (p_link->>'coreCommandId')::uuid<>v_command
     OR (p_link->>'attemptId')::uuid<>v_attempt
     OR p_link->>'hubOperatorNamespace' IS DISTINCT FROM 'ai-task-hub.public.users'
     OR p_link->>'hubOperatorId' IS DISTINCT FROM p_approval->>'superAdminId'
     OR p_link->>'hubRole' IS DISTINCT FROM 'super_admin'
     OR coalesce((p_link->>'hubActive')::boolean,false) IS NOT TRUE
     OR p_link->>'coreOperatorNamespace' IS DISTINCT FROM 'ai-core.ai_platform.internal_users'
     OR coalesce(p_link->>'coreRole','') NOT IN ('owner','admin')
     OR coalesce((p_link->>'coreActive')::boolean,false) IS NOT TRUE
     OR coalesce((p_link->>'corePasswordChanged')::boolean,false) IS NOT TRUE
     OR p_link->>'workerId' IS DISTINCT FROM 'openclaw-dell-chatgpt-wake-dev'
     OR p_link->>'approvalDigest' IS DISTINCT FROM p_digest
     OR p_link->>'nonce' IS DISTINCT FROM p_approval->>'nonce'
     OR (p_link->>'attemptNumber')::integer<>1
     OR v_link_issued<v_issued OR v_link_expires>v_expires
     OR v_link_expires<=v_link_issued OR v_link_expires-v_link_issued>120000
     OR coalesce(p_hub_signature,'') !~ '^[A-Za-z0-9_-]{86}$'
     OR coalesce(p_core_signature,'') !~ '^[A-Za-z0-9_-]{86}$'
     OR coalesce(p_link_digest,'') !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_OPERATOR_LINK_CONTRACT'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_command::text,0));

  IF NOT EXISTS(
    SELECT 1 FROM gpt02_stage.core_preparations p
    WHERE p.company_id='default' AND p.hub_task_id=v_task
      AND p.command_candidate_id=v_command AND p.attempt_id=v_attempt
      AND p.hub_execution_id=v_hub_execution AND p.core_task_id=v_core_task
      AND p.member_id=(p_link->>'assigneeId')::integer
      AND p.operator_subject=p_approval->>'superAdminId'
      AND p.expires_at>clock_timestamp()
  ) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PREPARATION_BINDING_REQUIRED'; END IF;

  SELECT * INTO v_existing_approval FROM gpt02_private.approvals WHERE command_id=v_command;
  SELECT * INTO v_existing_link FROM gpt02_private.operator_links WHERE command_id=v_command;
  IF v_existing_approval.command_id IS NOT NULL OR v_existing_link.command_id IS NOT NULL THEN
    IF v_existing_approval.command_id IS NULL OR v_existing_link.command_id IS NULL
       OR v_existing_approval.attempt_id<>v_attempt
       OR v_existing_approval.nonce<>p_approval->>'nonce'
       OR v_existing_approval.task_id<>v_task
       OR v_existing_approval.company_id<>'default'
       OR v_existing_approval.approver_id<>p_approval->>'superAdminId'
       OR v_existing_approval.claims<>p_approval
       OR v_existing_approval.signature<>p_signature
       OR v_existing_approval.digest<>p_digest
       OR v_existing_link.link_id<>v_link
       OR v_existing_link.claims<>p_link
       OR v_existing_link.link_digest<>p_link_digest
       OR v_existing_link.hub_signature<>p_hub_signature
       OR v_existing_link.core_signature<>p_core_signature
    THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='LINKED_APPROVAL_CONFLICT'; END IF;
    RETURN true;
  END IF;

  INSERT INTO gpt02_private.approvals(
    command_id,attempt_id,nonce,task_id,company_id,approver_id,claims,signature,digest,expires_at,operator_namespace
  ) VALUES(
    v_command,v_attempt,p_approval->>'nonce',v_task,'default',p_approval->>'superAdminId',
    p_approval,p_signature,p_digest,to_timestamp(v_expires/1000.0),'ai-task-hub.public.users'
  );

  INSERT INTO gpt02_private.operator_links(
    link_id,command_id,hub_execution_id,core_task_id,hub_task_id,attempt_id,attempt_number,
    company_id,assignee_id,accountable_owner_id,hub_operator_id,core_operator_user_id,
    approval_digest,link_digest,hub_signature,core_signature,claims,expires_at
  ) VALUES(
    v_link,v_command,v_hub_execution,v_core_task,v_task,v_attempt,1,'default',
    (p_link->>'assigneeId')::integer,p_link->>'accountableOwnerId',p_link->>'hubOperatorId',
    (p_link->>'coreOperatorUserId')::integer,p_digest,p_link_digest,p_hub_signature,p_core_signature,
    p_link,to_timestamp(v_link_expires/1000.0)
  );
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION gpt02_private.record_linked_approval(jsonb,text,text,jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gpt02_private.record_linked_approval(jsonb,text,text,jsonb,text,text,text) TO dev_gpt02_attestor_evidence;
RESET ROLE;