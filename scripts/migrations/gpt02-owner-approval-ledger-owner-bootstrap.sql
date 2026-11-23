-- Creates a dedicated NOLOGIN owner and temporarily permits the DEV runtime
-- to grant a one-shot SET ROLE membership to the Supabase postgres migration
-- session. INHERIT is explicitly disabled. The runtime grantor removes the
-- postgres membership after the ledger migration; a separate finalization
-- migration then removes the temporary bootstrap membership from the runtime.
DO $bootstrap$
DECLARE existing_role pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO existing_role
    FROM pg_roles
   WHERE rolname = 'gpt02_relock_owner_approval_owner';
  IF FOUND THEN
    IF existing_role.rolcanlogin OR existing_role.rolsuper OR
       existing_role.rolcreatedb OR existing_role.rolcreaterole OR
       existing_role.rolreplication OR existing_role.rolbypassrls OR
       existing_role.rolinherit OR EXISTS (
         SELECT 1 FROM pg_auth_members WHERE roleid = existing_role.oid
       ) THEN
      RAISE EXCEPTION 'GPT02_OWNER_LEDGER_ROLE_ATTRIBUTES_DRIFT';
    END IF;
  ELSE
    EXECUTE 'CREATE ROLE gpt02_relock_owner_approval_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS';
  END IF;
END
$bootstrap$;

-- Creating a dedicated schema requires CREATE on the database. Keep this
-- permission temporary and remove it in the finalization migration.
GRANT CREATE ON DATABASE postgres TO gpt02_relock_owner_approval_owner
  GRANTED BY postgres;

GRANT gpt02_relock_owner_approval_owner TO aicore_dev_runtime
  WITH INHERIT FALSE, SET TRUE, ADMIN TRUE GRANTED BY postgres;
