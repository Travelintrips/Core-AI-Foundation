-- GPT02 Issue159: exact DEV read-only RPC/RLS privilege preflight.
-- No DDL, DML, SECURITY DEFINER invocation, task, nonce or dispatch.
-- A successful result means CATALOG STANDBY SAFE, never signing authority.

WITH expected_functions(signature, expected_schema, expected_owner, executor_role) AS (
  VALUES
    ('gpt02_stage.prepare_core_task(text,integer,text,text,text,text)',
      'gpt02_stage','gpt02_core_prep_owner','gpt02_core_prep_login'),
    ('gpt02_private.record_linked_approval(jsonb,text,text,jsonb,text,text,text)',
      'gpt02_private','gpt02_store_owner','dev_gpt02_attestor_evidence'),
    ('gpt02_private.consume_linked_approval(jsonb,text,text,jsonb,text,text,text)',
      'gpt02_private','gpt02_store_owner','dev_gpt02_issuer_evidence'),
    ('gpt02_private.reserve_post_consumption_fence(uuid,uuid,uuid,text)',
      'gpt02_private','gpt02_store_owner','dev_gpt02_issuer_evidence'),
    ('gpt02_private.record_issuer_evidence(jsonb,text,text)',
      'gpt02_private','gpt02_store_owner','dev_gpt02_issuer_evidence'),
    ('gpt02_private.consume_issuer_lease(uuid,uuid,uuid)',
      'gpt02_private','gpt02_store_owner','dev_gpt02_issuer_evidence')
),
function_checks AS (
  SELECT ef.signature,
    (
      p.oid IS NOT NULL
      AND n.nspname = ef.expected_schema
      AND pg_catalog.pg_get_userbyid(p.proowner) = ef.expected_owner
      AND owner_role.rolcanlogin IS FALSE
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=pg_catalog']
      AND pg_catalog.has_schema_privilege(ef.executor_role,ef.expected_schema,'USAGE')
      AND pg_catalog.has_function_privilege(ef.executor_role,p.oid,'EXECUTE')
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(
          COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))
        ) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('dev_gpt02_claim_writer_nologin',p.oid,'EXECUTE')
      AND (
        pg_catalog.has_function_privilege('gpt02_core_prep_login',p.oid,'EXECUTE')
        = (ef.executor_role='gpt02_core_prep_login')
      )
      AND (
        pg_catalog.has_function_privilege('dev_gpt02_attestor_evidence',p.oid,'EXECUTE')
        = (ef.executor_role='dev_gpt02_attestor_evidence')
      )
      AND (
        pg_catalog.has_function_privilege('dev_gpt02_issuer_evidence',p.oid,'EXECUTE')
        = (ef.executor_role='dev_gpt02_issuer_evidence')
      )
    ) IS TRUE AS safe
  FROM expected_functions ef
  LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure(ef.signature)
  LEFT JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  LEFT JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=p.proowner
),
expected_tables(schema_name,table_name,owner_name) AS (
  VALUES
    ('gpt02_stage','core_preparations','gpt02_core_prep_owner'),
    ('gpt02_private','approvals','gpt02_store_owner'),
    ('gpt02_private','operator_links','gpt02_store_owner'),
    ('gpt02_private','receipts','gpt02_store_owner'),
    ('gpt02_private','core_identity_receipts','gpt02_store_owner'),
    ('gpt02_private','post_consumption_fences','gpt02_store_owner'),
    ('gpt02_private','issuer_evidences','gpt02_store_owner'),
    ('gpt02_private','issuer_lease_consumptions','gpt02_store_owner')
),
table_checks AS (
  SELECT t.table_name,
    (
      c.oid IS NOT NULL
      AND c.relkind IN ('r','p')
      AND c.relrowsecurity IS TRUE
      AND c.relforcerowsecurity IS TRUE
      AND pg_catalog.pg_get_userbyid(c.relowner)=t.owner_name
    ) IS TRUE AS safe
  FROM expected_tables t
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=t.schema_name
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=t.table_name
),
expected_constraints(name) AS (
  VALUES
    ('core_identity_receipts_binding_verified_check'),
    ('core_identity_receipts_core_ledger_written_check'),
    ('core_identity_receipts_may_dispatch_worker_check'),
    ('core_identity_receipts_may_issue_grant_check'),
    ('post_consumption_fences_core_ledger_written_check'),
    ('post_consumption_fences_dispatch_allowed_check'),
    ('post_consumption_fences_lease_epoch_check')
),
constraint_checks AS (
  SELECT e.name,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint x
      JOIN pg_catalog.pg_class c ON c.oid=x.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='gpt02_private'
        AND c.relname IN ('core_identity_receipts','post_consumption_fences')
        AND x.contype='c' AND x.conname=e.name
    ) AS safe
  FROM expected_constraints e
),
required_nologin(role_name) AS (
  VALUES ('gpt02_core_prep_owner'),('gpt02_store_owner'),
    ('gpt02_core_prep_login'),('dev_gpt02_attestor_evidence'),
    ('dev_gpt02_issuer_evidence'),('dev_gpt02_claim_writer_nologin')
),
role_checks AS (
  SELECT r.role_name,
    (p.oid IS NOT NULL AND p.rolcanlogin IS FALSE
      AND p.rolbypassrls IS FALSE) IS TRUE AS safe
  FROM required_nologin r
  LEFT JOIN pg_catalog.pg_roles p ON p.rolname=r.role_name
)
SELECT
  (SELECT count(*) FROM function_checks WHERE safe) AS secure_rpc_count,
  (SELECT count(*) FROM expected_functions) AS required_rpc_count,
  (SELECT count(*) FROM table_checks WHERE safe) AS forced_rls_table_count,
  (SELECT count(*) FROM expected_tables) AS required_table_count,
  (SELECT count(*) FROM constraint_checks WHERE safe) AS fail_closed_constraint_count,
  (SELECT count(*) FROM expected_constraints) AS required_constraint_count,
  (SELECT count(*) FROM role_checks WHERE safe) AS nologin_role_count,
  (SELECT count(*) FROM required_nologin) AS required_nologin_role_count,
  CASE WHEN
       (SELECT count(*) FROM function_checks WHERE safe)=6
   AND (SELECT count(*) FROM table_checks WHERE safe)=8
   AND (SELECT count(*) FROM constraint_checks WHERE safe)=7
   AND (SELECT count(*) FROM role_checks WHERE safe)=6
    THEN 'CATALOG_PRIVILEGE_STANDBY_PASS_NOT_E2E_AUTHORIZED'
    ELSE 'NO_GO_REVIEW_REQUIRED'
  END AS lifecycle_release_gate;
