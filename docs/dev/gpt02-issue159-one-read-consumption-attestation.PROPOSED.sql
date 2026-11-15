-- GPT02 Issue159, SOURCE-ONLY DRAFT. NEVER APPLY TO LIVE DEV OR PROD.
-- Additional AUDIT ONLY extension to the already-proposed private
-- gpt02_relock_audit schema / dormant minimal auditor. Not a new service.
--
-- Trust boundary: only a separately owner-reviewed privileged broker may
-- INSERT a verified packet's issuance / consumption. No live writer exists.
-- A low-privilege auditor can run ONE boolean SECURITY DEFINER RPC to
-- read back that a committed once-only consumption row exists BEFORE
-- the reader connection is opened. It cannot SELECT the ledger tables,
-- see any task rows or mint a credential. This is NOT approval authority.
--
-- Requires separate SECURITY DEFINER and schema/role custody review.
BEGIN;

DO $preflight$
BEGIN
 IF current_user <> 'postgres'
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres'
       AND rolcreaterole AND NOT rolsuper)
    OR NOT EXISTS (
        SELECT 1 FROM pg_namespace
        WHERE nspname='gpt02_relock_audit'
        AND nspowner='postgres'::regrole
    )
    OR to_regprocedure(
        'gpt02_relock_audit.scoped_reader_fully_locked(name)'
       ) IS NULL
    OR NOT EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname='dev_gpt02_relock_catalog_auditor'
        AND NOT rolcanlogin AND NOT rolinherit
        AND NOT rolbypassrls AND rolconnlimit=0
    )
    OR to_regclass('gpt02_relock_audit.reader_issuances') IS NOT NULL
    OR to_regclass('gpt02_relock_audit.reader_consumptions') IS NOT NULL
    OR to_regprocedure(
        'gpt02_relock_audit.reader_consumption_persisted(name,text,text,uuid,uuid,uuid,uuid,text)'
       ) IS NOT NULL
 THEN RAISE EXCEPTION 'ONE_READ_CONSUMPTION_MIGRATION_PREFLIGHT_DENIED';
 END IF;
END $preflight$;

-- Both ledgers are private/owned by the trusted database migrator.
-- No GRANT to the scoped reader or the minimal auditor. Unique across
-- packet, command, attempt, receipt and fence prevents new read budgets.
CREATE TABLE gpt02_relock_audit.reader_issuances (
 scope_sha text PRIMARY KEY
   CHECK (scope_sha ~ '^[0-9a-f]{64}$'),
 packet_sha text NOT NULL UNIQUE
   CHECK (packet_sha ~ '^[0-9a-f]{64}$'),
 role_name name NOT NULL UNIQUE,
 task_id integer NOT NULL CHECK (task_id > 139),
 company_id text NOT NULL CHECK (company_id = 'default'),
 command_id uuid NOT NULL UNIQUE,
 attempt_id uuid NOT NULL UNIQUE,
 receipt_id uuid NOT NULL UNIQUE,
 fence_id uuid NOT NULL UNIQUE,
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 CHECK (expires_at > issued_at)
);

CREATE TABLE gpt02_relock_audit.reader_consumptions (
 scope_sha text PRIMARY KEY REFERENCES
   gpt02_relock_audit.reader_issuances(scope_sha),
 -- A fresh unpredictable challenge is supplied by the *trusted broker* for
 -- every attempted read, never chosen from a prior supervisor receipt.
 -- Existing PK prevents a second challenge for the same signed scope.
 read_challenge text NOT NULL UNIQUE
   CHECK (read_challenge ~ '^[0-9a-f]{64}$'),
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Neither privileged owner nor future broker can silently UPDATE/DELETE a
-- claim to refresh the read budget. The owner can still modify DDL, so
-- strong operational custody and immutable audit export remain necessary.
CREATE FUNCTION gpt02_relock_audit.reject_reader_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $reject$
BEGIN
 RAISE EXCEPTION 'ONE_READ_LEDGER_IMMUTABLE';
END
$reject$;
REVOKE ALL ON FUNCTION
 gpt02_relock_audit.reject_reader_ledger_mutation() FROM PUBLIC;

DO $guard$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['reader_issuances','reader_consumptions'] LOOP
   EXECUTE format(
     'ALTER TABLE gpt02_relock_audit.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format(
     'ALTER TABLE gpt02_relock_audit.%I FORCE ROW LEVEL SECURITY',t);
   EXECUTE format(
     'CREATE POLICY owner_only ON gpt02_relock_audit.%I '
     'FOR ALL TO postgres USING (true) WITH CHECK (true)',t);
   EXECUTE format(
     'CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON '
     'gpt02_relock_audit.%I FOR EACH ROW EXECUTE FUNCTION '
     'gpt02_relock_audit.reject_reader_ledger_mutation()',t);
   EXECUTE format(
     'CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON '
     'gpt02_relock_audit.%I FOR EACH STATEMENT EXECUTE FUNCTION '
     'gpt02_relock_audit.reject_reader_ledger_mutation()',t);
   EXECUTE format('REVOKE ALL ON gpt02_relock_audit.%I FROM PUBLIC',t);
 END LOOP;
END $guard$;

-- This is NOT the broker's consume RPC. It checks the actual committed
-- ledger in a separate READ ONLY transaction via a separately pinned
-- minimal auditor login. No event data and no credential material returned.
CREATE FUNCTION gpt02_relock_audit.reader_consumption_persisted(
 p_role name, p_scope_sha text, p_packet_sha text,
 p_command_id uuid, p_attempt_id uuid,
 p_receipt_id uuid, p_fence_id uuid, p_read_challenge text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $readback$
DECLARE v_match boolean;
BEGIN
 -- Callers must authenticate as the dedicated auditor itself, not as a
 -- role accidentally granted EXECUTE or set via a membership chain.
 IF session_user <> 'dev_gpt02_relock_catalog_auditor'
 THEN RAISE EXCEPTION 'ONE_READ_AUDITOR_CALLER_INVALID'
   USING ERRCODE = '42501';
 END IF;
 IF p_role::text !~ '^dev_gpt02_task_[1-9][0-9]*_[a-f0-9]{12}    OR p_scope_sha !~ '^[0-9a-f]{64}$'
    OR p_packet_sha !~ '^[0-9a-f]{64}$'
    OR p_read_challenge !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'ONE_READ_CLAIM_SCOPE_INVALID'
   USING ERRCODE = '22023';
 END IF;

 SELECT EXISTS(
   SELECT 1 FROM gpt02_relock_audit.reader_issuances i
   JOIN gpt02_relock_audit.reader_consumptions c
     ON c.scope_sha=i.scope_sha
   WHERE i.scope_sha=p_scope_sha
     AND i.packet_sha=p_packet_sha
     AND i.role_name=p_role
     AND i.command_id=p_command_id
     AND i.attempt_id=p_attempt_id
     AND i.receipt_id=p_receipt_id
     AND i.fence_id=p_fence_id
     AND i.task_id>139 AND i.company_id='default'
     AND c.read_challenge = p_read_challenge
     AND c.consumed_at >= i.issued_at
     AND c.consumed_at < i.expires_at
     AND i.expires_at > clock_timestamp()
 ) INTO v_match;

 RETURN COALESCE(v_match,FALSE);
END
$readback$;

REVOKE ALL ON FUNCTION
 gpt02_relock_audit.reader_consumption_persisted(
  name,text,text,uuid,uuid,uuid,uuid,text
 ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 gpt02_relock_audit.reader_consumption_persisted(
  name,text,text,uuid,uuid,uuid,uuid,text
 ) TO dev_gpt02_relock_catalog_auditor;

-- Ensure ordinary auditor/reader cannot read the tables or write/alter
-- their contents; only the trusted migrator/owner inserts ledger evidence.
DO $postflight$
BEGIN
 IF has_table_privilege(
      'dev_gpt02_relock_catalog_auditor',
      'gpt02_relock_audit.reader_issuances','SELECT'
    )
    OR has_table_privilege(
      'dev_gpt02_relock_catalog_auditor',
      'gpt02_relock_audit.reader_consumptions','SELECT'
    )
    OR has_table_privilege(
      'dev_gpt02_relock_catalog_auditor',
      'gpt02_relock_audit.reader_consumptions','INSERT'
    )
    OR (SELECT rolcanlogin FROM pg_roles
        WHERE rolname='dev_gpt02_relock_catalog_auditor')
 THEN RAISE EXCEPTION 'ONE_READ_AUDITOR_LEDGER_PRIVILEGE_LEAK';
 END IF;
END $postflight$;
COMMIT;

-- No credential issuance, CREATE LOGIN, dispatch, signer or PROD mutation.

    OR p_scope_sha !~ '^[0-9a-f]{64}$'
    OR p_packet_sha !~ '^[0-9a-f]{64}$'
    OR p_read_challenge !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'ONE_READ_CLAIM_SCOPE_INVALID'
   USING ERRCODE = '22023';
 END IF;

 SELECT EXISTS(
   SELECT 1 FROM gpt02_relock_audit.reader_issuances i
   JOIN gpt02_relock_audit.reader_consumptions c
     ON c.scope_sha=i.scope_sha
   WHERE i.scope_sha=p_scope_sha
     AND i.packet_sha=p_packet_sha
     AND i.role_name=p_role
     AND i.command_id=p_command_id
     AND i.attempt_id=p_attempt_id
     AND i.receipt_id=p_receipt_id
     AND i.fence_id=p_fence_id
     AND i.task_id>139 AND i.company_id='default'
     AND c.read_challenge = p_read_challenge
     AND c.consumed_at >= i.issued_at
     AND c.consumed_at < i.expires_at
     AND i.expires_at > clock_timestamp()
 ) INTO v_match;

 RETURN COALESCE(v_match,FALSE);
END
$readback$;

REVOKE ALL ON FUNCTION
 gpt02_relock_audit.reader_consumption_persisted(
  name,text,text,uuid,uuid,uuid,uuid,text
 ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 gpt02_relock_audit.reader_consumption_persisted(
  name,text,text,uuid,uuid,uuid,uuid,text
 ) TO dev_gpt02_relock_catalog_auditor;

-- Ensure ordinary auditor/reader cannot read the tables or write/alter
-- their contents; only the trusted migrator/owner inserts ledger evidence.
DO $postflight$
BEGIN
 IF has_table_privilege(
      'dev_gpt02_relock_catalog_auditor',
      'gpt02_relock_audit.reader_issuances','SELECT'
    )
    OR has_table_privilege(
      'dev_gpt02_relock_catalog_auditor',
      'gpt02_relock_audit.reader_consumptions','SELECT'
    )
    OR has_table_privilege(
      'dev_gpt02_relock_catalog_auditor',
      'gpt02_relock_audit.reader_consumptions','INSERT'
    )
    OR (SELECT rolcanlogin FROM pg_roles
        WHERE rolname='dev_gpt02_relock_catalog_auditor')
 THEN RAISE EXCEPTION 'ONE_READ_AUDITOR_LEDGER_PRIVILEGE_LEAK';
 END IF;
END $postflight$;
COMMIT;

-- No credential issuance, CREATE LOGIN, dispatch, signer or PROD mutation.
