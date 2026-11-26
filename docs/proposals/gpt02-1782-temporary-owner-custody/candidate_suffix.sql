-- END_PINNED_PHASE_B_BODY

-- CHECKPOINT_BEFORE_ROLE_RESTORE
-- NONE is explicit: RESET ROLE can restore a connection-time role setting.
SET LOCAL ROLE NONE;
DO $restore_actor_guard$
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
     OR NOT EXISTS (
       SELECT 1 FROM pg_temp.gpt02_1782_transaction_identity
       WHERE backend_pid = pg_catalog.pg_backend_pid()
         AND transaction_id = pg_catalog.pg_current_xact_id()
     ) THEN
    RAISE EXCEPTION 'GPT02_1782_TRANSACTION_IDENTITY_CHANGED';
  END IF;
END;
$restore_actor_guard$;
REVOKE gpt02_relock_owner_approval_owner FROM postgres
  GRANTED BY postgres RESTRICT;

DO $complete_restore_guard$
DECLARE
  reader_oid oid := (SELECT oid FROM pg_catalog.pg_roles
                    WHERE rolname = 'gpt02_owner_ledger_reader_1782_dev');
BEGIN
  IF EXISTS (
    (SELECT oid, roleid, member, grantor, admin_option, inherit_option, set_option
       FROM pg_catalog.pg_auth_members
     EXCEPT SELECT * FROM pg_temp.gpt02_1782_membership_before)
    UNION ALL
    (SELECT * FROM pg_temp.gpt02_1782_membership_before
     EXCEPT SELECT oid, roleid, member, grantor, admin_option, inherit_option, set_option
       FROM pg_catalog.pg_auth_members)
  ) OR pg_catalog.pg_has_role('postgres', 'gpt02_relock_owner_approval_owner', 'SET')
    OR pg_catalog.pg_has_role('postgres', 'gpt02_relock_owner_approval_owner', 'USAGE')
  THEN
    RAISE EXCEPTION 'GPT02_1782_MEMBERSHIP_NOT_EXACTLY_RESTORED';
  END IF;
  IF EXISTS (
    (SELECT oid, rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
            rolcanlogin, rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil
       FROM pg_catalog.pg_roles
     EXCEPT SELECT * FROM pg_temp.gpt02_1782_role_attributes_before)
    UNION ALL
    (SELECT * FROM pg_temp.gpt02_1782_role_attributes_before
     EXCEPT SELECT oid, rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
                   rolcanlogin, rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil
       FROM pg_catalog.pg_roles)
  ) THEN
    RAISE EXCEPTION 'GPT02_1782_ROLE_ATTRIBUTES_CHANGED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.gpt02_1782_owner_tables_before AS b
    LEFT JOIN pg_catalog.pg_class AS c ON c.oid = b.oid
    WHERE c.oid IS NULL OR c.relowner <> b.relowner
      OR c.relrowsecurity <> b.relrowsecurity
      OR c.relforcerowsecurity <> b.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'GPT02_1782_OWNER_OR_RLS_CHANGED';
  END IF;
  IF EXISTS (
    SELECT * FROM pg_temp.gpt02_1782_policies_before
    EXCEPT SELECT p.oid, p.polname, p.polrelid, p.polcmd, p.polpermissive, p.polroles,
                  p.polqual::text, p.polwithcheck::text
      FROM pg_catalog.pg_policy AS p
      WHERE p.polrelid IN (SELECT oid FROM pg_temp.gpt02_1782_owner_tables_before)
  ) OR (
    SELECT count(*) FROM pg_catalog.pg_policy AS p
    WHERE p.polrelid IN (SELECT oid FROM pg_temp.gpt02_1782_owner_tables_before)
      AND NOT EXISTS (SELECT 1 FROM pg_temp.gpt02_1782_policies_before AS b WHERE b.oid = p.oid)
  ) <> 2 OR (
    SELECT count(*) FROM pg_catalog.pg_policy AS p
    JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
    WHERE p.polrelid IN (SELECT oid FROM pg_temp.gpt02_1782_owner_tables_before)
      AND p.polroles = ARRAY[reader_oid] AND p.polcmd = 'r'
      AND p.polpermissive AND p.polwithcheck IS NULL AND p.polqual IS NOT NULL
      AND (c.relname, p.polname) IN (
        ('gpt02_relock_owner_approval_challenges', 'gpt02_1782_reader_original_challenge_select'),
        ('gpt02_relock_owner_approval_decisions', 'gpt02_1782_reader_original_decision_select')
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'GPT02_1782_EXACT_READER_POLICY_DELTA_REQUIRED';
  END IF;
END;
$complete_restore_guard$;
-- CHECKPOINT_BEFORE_COMMIT
COMMIT;
