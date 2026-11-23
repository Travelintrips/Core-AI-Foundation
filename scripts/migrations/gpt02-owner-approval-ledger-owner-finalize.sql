-- Run after the runtime grantor has removed its temporary membership to the
-- postgres migration session. This removes the runtime's temporary ADMIN/SET
-- membership, leaving the NOLOGIN role with no login members.
REVOKE gpt02_relock_owner_approval_owner FROM aicore_dev_runtime GRANTED BY postgres;
REVOKE CREATE ON DATABASE postgres FROM gpt02_relock_owner_approval_owner GRANTED BY postgres;
DO $verify$
BEGIN
  IF pg_has_role('aicore_dev_runtime', 'gpt02_relock_owner_approval_owner', 'SET') OR
     pg_has_role('aicore_dev_runtime', 'gpt02_relock_owner_approval_owner', 'USAGE') OR
     has_database_privilege('gpt02_relock_owner_approval_owner', current_database(), 'CREATE') OR
     pg_has_role('postgres', 'gpt02_relock_owner_approval_owner', 'SET') OR
     pg_has_role('postgres', 'gpt02_relock_owner_approval_owner', 'USAGE') OR
     EXISTS (
       SELECT 1
         FROM pg_auth_members m
         JOIN pg_roles u ON u.oid = m.member
        WHERE m.roleid = to_regrole('gpt02_relock_owner_approval_owner')
          AND (u.rolname <> 'postgres' OR m.set_option OR m.inherit_option)
     ) THEN
    RAISE EXCEPTION 'GPT02_OWNER_LEDGER_TEMPORARY_PRIVILEGE_NOT_REVOKED';
  END IF;
END
$verify$;
