-- Keep ai_platform private-by-default and defense-in-depth protected.
-- Production/DEV were hardened first; this migration records the same invariant.

do $$
declare
  r record;
begin
  for r in
    select format('%I.%I', n.nspname, c.relname) as fqname
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='ai_platform'
      and c.relkind in ('r','p')
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
