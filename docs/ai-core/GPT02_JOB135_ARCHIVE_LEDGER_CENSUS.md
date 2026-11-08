# Job135 CST-DEV archive evidence census

The Job135 timeline formerly omitted two GPT02 command archives and one
legacy response archive. aicore_dev_runtime deliberately cannot SELECT
from those tables. A fixed-parent, read-only SECURITY DEFINER count reader
now provides this evidence without exposing instructions or granting SELECT.

Baseline on Nov 9 WIB: October archive 86 command rows, November archive
12 command rows and 11 legacy responses. The archived timestamps precede
the Nov 7 Job135 parent. The absence of archive matches DOES NOT exclude
untagged attempts in external systems. Execution flags remain false.

Deployment order: (1) run the isolated PostgreSQL 16 tests;
(2) verify CST-DEV project xssrfshdrtdfupgqwfdw, owner postgres, and no
runtime SELECT; (3) apply the migration as owner with session-local
ai_core.dev_migration_authorized=true; (4) verify runtime has EXECUTE only,
browser roles have none, direct runtime read-only query PASS; (5) merge
after CI, official DEV deploy and public SHA verification, PROD unchanged.

This does not authorize a GPT02 issuer, lease, dispatch or completion.
