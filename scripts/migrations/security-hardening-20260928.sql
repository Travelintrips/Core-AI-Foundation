-- Security hardening applied to PROD and DEV on 2026-09-28.
-- Goal: keep internal schemas private, preserve server/service-role paths,
-- and make future objects secure-by-default.

do $$
declare r record;
begin
  for r in
    select format('%I.%I', n.nspname, c.relname) as fqname
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='ai_platform' and c.relkind in ('r','p')
  loop
    execute 'alter table ' || r.fqname || ' enable row level security';
  end loop;
end $$;

revoke all on schema ai_platform from public, anon, authenticated, service_role;
revoke all privileges on all tables in schema ai_platform from public, anon, authenticated, service_role;
revoke all privileges on all sequences in schema ai_platform from public, anon, authenticated, service_role;
revoke all privileges on all functions in schema ai_platform from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema ai_platform
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema ai_platform
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema ai_platform
  revoke execute on functions from public, anon, authenticated, service_role;

do $$
declare r record;
begin
  for r in
    select format('%I.%I', n.nspname, c.relname) as fqname
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','sport_center','travelintrips')
      and c.relkind in ('r','p')
      and not c.relrowsecurity
      and not (n.nspname='public' and c.relname='logistic_orders')
  loop
    execute 'alter table ' || r.fqname || ' enable row level security';
    execute 'revoke all privileges on table ' || r.fqname || ' from public, anon, authenticated';
  end loop;
end $$;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete, truncate, references, trigger
  on tables from public, anon, authenticated;
alter default privileges for role postgres in schema sport_center
  revoke select, insert, update, delete, truncate, references, trigger
  on tables from public, anon, authenticated;
alter default privileges for role postgres in schema travelintrips
  revoke select, insert, update, delete, truncate, references, trigger
  on tables from public, anon, authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where p.prosecdef and n.nspname in ('public','sport_center')
  loop
    execute 'revoke execute on function ' || r.fn || ' from public, anon, authenticated';
  end loop;
end $$;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema sport_center
  revoke execute on functions from public, anon, authenticated;

do $$
declare v record;
begin
  for v in
    select * from (values
      ('public','v_ledger_journal_view'),
      ('public','v_ledger_balance_view'),
      ('public','audit_dana_talangan_coa'),
      ('public','v_unified_orders'),
      ('sport_center','sport_customers'),
      ('sport_center','sport_invoice_items'),
      ('sport_center','sport_invoices'),
      ('sport_center','expected_bank_settlements'),
      ('public','fleet_reconciliation_batches'),
      ('public','accounting_trial_balance_v'),
      ('public','v_unified_quotes'),
      ('public','customer_aggregates'),
      ('public','accounting_general_ledger_v'),
      ('public','accounting_balance_sheet_v'),
      ('public','fleet_outstanding_balances'),
      ('public','accounting_profit_loss_v'),
      ('public','accounting_payments_v')
    ) as x(schema_name,view_name)
  loop
    if to_regclass(format('%I.%I',v.schema_name,v.view_name)) is not null then
      execute format('alter view %I.%I set (security_invoker = true)',v.schema_name,v.view_name);
    end if;
  end loop;
end $$;

do $$
declare r record;
declare sp text;
begin
  for r in
    select p.oid::regprocedure::text as fn, n.nspname as schema_name
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','sport_center','ai_platform')
      and p.proname in (
        'sync_vendor_invoice_reversal_tracking','fleet_import_driver_snapshot','update_updated_at_column',
        'fn_validate_tenant_company_id','fn_validate_entry_company_id','fn_fleet_ledger_immutable',
        'prevent_update_locked_invoice','fn_validate_payment_company_id','fn_sync_entry_line_to_ledger',
        'ae_immutability_fn','erp_audit_log_immutability','ae_period_lock_insert_guard_fn',
        'create_app_user','generate_coding_task_code','fn_block_posted_entry_delete',
        'sync_sport_center_facilities','check_period_locked','fn_block_posted_entry_update',
        'validate_facility_company_mapping_company','fn_block_posted_lines_mutation',
        'on_confirmed_payment_create_accounting_draft','fn_ledger_period_lock',
        'fn_sync_invoice_company_owner','fn_sync_payment_invoice_owner',
        'cascade_delete_public_booking','cascade_update_public_booking','ae_insert_guard_fn',
        'sync_payment_accounting_journal','enqueue_payment_accounting_outbox'
      )
  loop
    if r.schema_name='public' then
      sp := 'pg_catalog, public, sport_center, ai_platform, pg_temp';
    elsif r.schema_name='sport_center' then
      sp := 'pg_catalog, sport_center, public, ai_platform, pg_temp';
    else
      sp := 'pg_catalog, ai_platform, public, sport_center, pg_temp';
    end if;
    execute 'alter function ' || r.fn || ' set search_path = ' || sp;
  end loop;
end $$;
