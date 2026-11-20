-- GPT02 Issue159 / CST-DEV: independent one-task supervisor catalogue gate.
-- REVIEW-ONLY. Execute against project xssrfshdrtdfupgqwfdw with a separately
-- authorized administrative READ ONLY connection. The database connection
-- itself must be verified as CST-DEV outside this SQL; the string below does
-- not authenticate a project.
--
-- The listed objects are from the EXISTING Draft PR1754 owner-held review SQL
-- and one-shot broker. This gate does not install any of those objects.
-- Even a fully populated catalogue does NOT verify credentials, four signer
-- roots, recent Owner intent, one-use atomicity, systemd watchdog or DELL.
-- Always return NO_GO; do not use this report as a credential/dispatch permit.
--
-- No role granting, DDL, UPDATE, DO block, SECURITY DEFINER invocation,
-- database writing, task replay, or connection/session termination.
BEGIN READ ONLY;
WITH
  objects AS (
    SELECT
      to_regclass('gpt02_relock_audit.reader_issuances') IS NOT NULL
        AS reader_issuance_ledger,
      to_regclass('gpt02_relock_audit.reader_consumptions') IS NOT NULL
        AS one_read_consumption_ledger,
      to_regprocedure('gpt02_relock_audit.consume_reader_once(name,text,text,uuid,uuid,uuid,uuid,text)') IS NOT NULL
        AS one_read_claim_rpc,
      to_regprocedure('gpt02_relock_audit.reader_consumption_persisted(name,text,text,uuid,uuid,uuid,uuid,text)') IS NOT NULL
        AS one_read_attestation_rpc,
      to_regprocedure('gpt02_relock_audit.canonical_reader_current_guard(name,text,text,uuid,uuid,uuid,uuid,text)') IS NOT NULL
        AS current_approval_guard_rpc,
      to_regprocedure('gpt02_relock_audit.scoped_reader_fully_locked(name)') IS NOT NULL
        AS full_relock_attestation_rpc,
      to_regprocedure('gpt02_private.revoke_expired_scoped_reader_grants(name)') IS NOT NULL
        AS scoped_reader_grant_revoke_rpc,
      to_regrole('dev_gpt02_reader_claim_consumer') IS NOT NULL
        AS claim_consumer_role,
      to_regrole('dev_gpt02_reader_admission_guard') IS NOT NULL
        AS current_guard_role,
      to_regrole('gpt02_store_owner') IS NOT NULL
        AS private_owner_role
  ),
  scope AS (
    SELECT
      count(*) FILTER (
        WHERE rolname LIKE 'dev_gpt02_task_%'
      )::int AS task_scoped_reader_role_count,
      count(*) FILTER (
        WHERE rolname IN (
          'dev_gpt02_reader_claim_consumer',
          'dev_gpt02_reader_admission_guard'
        )
        AND NOT rolcanlogin AND rolconnlimit = 0
      )::int AS locked_service_roles_out_of_2
    FROM pg_roles
  ),
  issuer_rls AS (
    SELECT
      count(*) FILTER (
        WHERE 'gpt02_issuer_evidence_reader' = ANY(roles)
          AND permissive = 'PERMISSIVE' AND cmd = 'SELECT'
      )::int AS general_reader_permissive_select_policies,
      count(*) FILTER (
        WHERE 'gpt02_issuer_evidence_reader' = ANY(roles)
          AND permissive = 'PERMISSIVE' AND cmd = 'SELECT'
          AND (
            strpos(coalesce(qual,''),'task_id > 136') > 0
            OR strpos(coalesce(qual,''),'hub_task_id > 136') > 0
          )
      )::int AS general_reader_threshold_scope_policies
    FROM pg_policies
    WHERE schemaname = 'gpt02_private'
      AND tablename IN (
        'approvals', 'operator_links', 'receipts',
        'core_identity_receipts', 'post_consumption_fences'
      )
  )
SELECT
  'CST-DEV (caller-verified only)' AS intended_scope,
  'NO_GO_NEVER_AUTHORIZES' AS release_decision,
  o.reader_issuance_ledger,
  o.one_read_consumption_ledger,
  o.one_read_claim_rpc,
  o.one_read_attestation_rpc,
  o.current_approval_guard_rpc,
  o.full_relock_attestation_rpc,
  o.scoped_reader_grant_revoke_rpc,
  o.claim_consumer_role,
  o.current_guard_role,
  o.private_owner_role,
  s.task_scoped_reader_role_count,
  s.locked_service_roles_out_of_2,
  r.general_reader_permissive_select_policies,
  r.general_reader_threshold_scope_policies,
  CASE
    WHEN o.private_owner_role
      AND (SELECT pg_has_role('postgres','gpt02_store_owner','SET'))
    THEN 'REVIEW_EXISTING_OWNER_SET_PRIVILEGE'
    ELSE 'NO_OWNER_SET_AUTHORITY_FOR_CONNECTED_POSTGRES'
  END AS owner_context_review,
  (
    SELECT count(*)::int
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='gpt02_relock_audit'
      AND p.proname IN ('relock_expired_phase_a','relock_expired_phase_b')
  ) AS existing_writer_relock_phase_function_count,
  'NOT_CHECKED: live signed Owner decision, systemd, CA/credential custody, native one-read broker, signer, DELL' AS unverified_external_gates
FROM objects o CROSS JOIN scope s CROSS JOIN issuer_rls r;
ROLLBACK;
