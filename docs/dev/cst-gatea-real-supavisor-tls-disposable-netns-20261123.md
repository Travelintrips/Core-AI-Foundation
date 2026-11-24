# CST-DEV Gate A — real Supavisor TLS inside disposable default-deny netns

**Evidence only; operational watchdog remains NO-GO.**

The script `scripts/dev/cst-onejob-gatea-pooler-tls-egress.disposable.sh`
uses a transient, unprivileged Docker container's own network namespace.
No existing service, production container, host nftables rules, or persistent
namespace is modified; cleanup is unconditional. No database credential,
LOGIN grant, SQL query, bearer token, password or Supabase connection pool
authentication is used.

## Scope

- Target: aws-1-ap-southeast-2.pooler.supabase.com port 6543 (CST-DEV pooler).
- The host resolves current A records first. The isolated namespace itself
  does NOT permit DNS egress: nftables allows only the resolved IPv4 targets
  on TCP 6543, with a default-drop OUTPUT chain.
- The PostgreSQL protocol uses SSLRequest (`openssl s_client -starttls postgres`).
- Peer certificate must verify `-verify_hostname` against the exact pooler
  hostname, using the previously pinned public Supabase root CA.
- The script probes port 443 on the same reachable IP and confirms it was
  blocked. It also checks nft packet counters for both accepted and denied
  packets; merely rendering a policy is not counted as PASS.
- The source file must be manually run as a VPS isolated QA gate; GitHub CI
  cannot claim this external connectivity test from offline source checks.

## Verified on VPS srv1792369

`CST_GATEA_REAL_SUPAVISOR_TLS_DISPOSABLE_NETNS_PASS`
with the following evidence:

- `QA_DISPOSABLE_DEFAULT_DENY_NAMESPACE=TRUE`
- `QA_REAL_SUPAVISOR_TLS_FROM_NAMESPACE=PASS`
- `QA_KERNEL_POOLER_ALLOW_PACKETS_POSITIVE=TRUE`
- `QA_KERNEL_OTHER_PORT_DENY_PACKETS_POSITIVE=TRUE`
- `LIVE_DATABASE_CREDENTIAL_NOT_USED=TRUE`
- `HOST_FIREWALL_UNMODIFIED=TRUE`
- `OPERATIONS_LOGIN_NOT_ENABLED=TRUE`

Log: `/opt/cst-onejob-dev/qa/gatea-real-pooler-tls-disposable-netns-20261123.log`.

## Limits

This does **not** establish an approved persistent network namespace, DNS
pin renewal, Supavisor authenticated access, database role-session draining,
host restart recovery, signed approval, or operational watchdog readiness.
The real unit must not be activated until separately reviewed credentials,
source-pinned authority and actual fail-closed lifecycle evidence exist.
At present the watcher and stage PostgreSQL roles remain NOLOGIN.

**Gate A release decision: NO-GO. PROD untouched.**