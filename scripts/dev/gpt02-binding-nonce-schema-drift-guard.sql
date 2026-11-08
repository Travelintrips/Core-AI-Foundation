-- Read-only PostgreSQL catalog guard for the disposable GPT02 binding/nonce proposal.
-- Does not authorize migration into live DEV, execution, or grant issuance.
-- An absent/mutated object must fail closed (SQLSTATE 55000).
DO $guard$
DECLARE
  rel oid := to_regclass('ai_platform.dev_gpt02_binding_attestation_nonces');
  binding_rel oid := to_regclass('ai_platform.dev_gpt02_task_attempt_binding_claims');
  missing text;
  trigger_count integer;
  unsafe_grants integer;
  unsafe_functions integer;
  expected text[] := ARRAY[
    'dev_gpt02_binding_attestation_nonces_pkey',
    'dev_gpt02_binding_attestation_nonces_attestation_sha256_key',
    'dev_gpt02_nonce_attempt_once',
    'dev_gpt02_nonce_command_once',
    'dev_gpt02_nonce_receiver_once'
  ];
BEGIN
  IF rel IS NULL OR binding_rel IS NULL THEN
    RAISE EXCEPTION 'GPT02_NONCE_RELATION_MISSING' USING ERRCODE='55000';
  END IF;
  SELECT string_agg(x, ',') INTO missing
  FROM unnest(expected) AS x
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid=rel AND c.conname=x AND c.contype IN ('p','u')
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'GPT02_NONCE_UNIQUENESS_DRIFT: %', missing USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid=rel AND c.conname='dev_gpt02_nonce_binding_provenance_fk'
      AND c.contype='f' AND c.confrelid=binding_rel
      AND c.convalidated AND c.condeferrable AND c.condeferred
      AND array_length(c.conkey,1)=6 AND array_length(c.confkey,1)=6
  ) THEN
    RAISE EXCEPTION 'GPT02_NONCE_PROVENANCE_FK_DRIFT' USING ERRCODE='55000';
  END IF;
  -- Verify each named CHECK independently: a replacement check must not
  -- compensate for a missing freshness/authorization constraint by count.
  SELECT string_agg(required.conname, ',') INTO missing
  FROM (VALUES
    ('dev_gpt02_nonce_window', ''),
    ('dev_gpt02_nonce_recency', ''),
    ('dev_gpt02_nonce_expiry', ''),
    ('dev_gpt02_binding_attestation_nonces_may_issue_grant_check', 'may_issue_grant = false'),
    ('dev_gpt02_binding_attestation_nonces_may_dispatch_worker_check', 'may_dispatch_worker = false')
  ) AS required(conname, required_expression)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid=rel AND c.conname=required.conname
      AND c.contype='c' AND c.convalidated
      AND (required.required_expression=''
        OR pg_get_constraintdef(c.oid) LIKE '%'||required.required_expression||'%')
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'GPT02_NONCE_DENIAL_OR_FRESHNESS_DRIFT: %', missing
      USING ERRCODE='55000';
  END IF;
  SELECT count(*) INTO trigger_count FROM pg_catalog.pg_trigger t
  WHERE t.tgrelid=rel AND t.tgname='dev_gpt02_nonce_immutable_trg'
    AND NOT t.tgisinternal AND t.tgenabled='O'
    AND (t.tgtype & 1)=1 AND (t.tgtype & 16)=16 AND (t.tgtype & 8)=8
    AND t.tgfoid='ai_platform.dev_gpt02_nonce_immutable()'::regprocedure;
  IF trigger_count<>1 THEN
    RAISE EXCEPTION 'GPT02_NONCE_TRIGGER_DRIFT' USING ERRCODE='55000';
  END IF;
  IF pg_get_functiondef('ai_platform.dev_gpt02_nonce_immutable()'::regprocedure)
       NOT LIKE '%RAISE EXCEPTION ''GPT02_NONCE_IMMUTABLE''%'
     OR pg_get_functiondef('ai_platform.dev_gpt02_nonce_immutable()'::regprocedure)
       ~* 'RETURN[[:space:]]+NEW' THEN
    RAISE EXCEPTION 'GPT02_NONCE_FUNCTION_DRIFT' USING ERRCODE='55000';
  END IF;
  SELECT count(*) INTO unsafe_grants
  FROM pg_catalog.pg_class cl
  CROSS JOIN LATERAL aclexplode(COALESCE(cl.relacl,acldefault('r',cl.relowner))) a
  WHERE cl.oid=rel AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
    AND a.grantee IS DISTINCT FROM cl.relowner;
  IF unsafe_grants>0 THEN
    RAISE EXCEPTION 'GPT02_NONCE_WRITE_GRANT_DRIFT' USING ERRCODE='55000';
  END IF;
  SELECT count(*) INTO unsafe_functions
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='ai_platform.dev_gpt02_nonce_immutable()'::regprocedure
    AND a.privilege_type='EXECUTE' AND a.grantee IS DISTINCT FROM p.proowner;
  IF unsafe_functions>0 THEN
    RAISE EXCEPTION 'GPT02_NONCE_FUNCTION_GRANT_DRIFT' USING ERRCODE='55000';
  END IF;
  RAISE NOTICE 'GPT02_NONCE_SCHEMA_DRIFT_GUARD_PASS';
END;
$guard$;
