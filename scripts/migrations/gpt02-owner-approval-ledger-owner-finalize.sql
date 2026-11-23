-- Run after the runtime grantor has removed its temporary membership to the
-- postgres migration session. This removes the runtime's temporary ADMIN/SET
-- membership, leaving the NOLOGIN role with no login members.
REVOKE gpt02_relock_owner_approval_owner FROM aicore_dev_runtime;
DO $verify$
BEGIN
  IF pg_has_role('aicore_dev_runtime', 'gpt02_relock_owner_approval_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'GPT02_OWNER_LEDGER_RUNTIME_MEMBERSHIP_NOT_REVOKED';
  END IF;
END
$verify$;
