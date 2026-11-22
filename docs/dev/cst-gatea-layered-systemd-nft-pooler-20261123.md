# CST-DEV Gate A — layered systemd + nftables real Supavisor TLS QA

**Source-only test. No watchdog login, credential, persistent unit or DEV job activation.**

## Purpose

Closing-only watchdog networking requires two independent constraints:
systemd `IPAddressDeny=any` plus a reviewed, numeric `IPAddressAllow`,
**and** an isolated network namespace with nftables OUTPUT `policy drop`
and exactly the approved pooler target on TCP port 6543.

`IPAddressAllow` restricts the destination IP only; it does **not** restrict
the destination port. The nftables layer must enforce the port boundary.
Neither layer alone proves the final operational design.

## Actual VPS QA

Script: `scripts/dev/cst-onejob-gatea-layered-systemd-netns.disposable.sh`

1. Verify the exact public Supabase root CA fingerprint.
2. Resolve the Supavisor hostname to one numeric IPv4 on the host.
3. Start an unprivileged disposable Docker holder on the default bridge.
   Its network namespace is confirmed distinct from the host namespace.
4. Install nftables **inside the disposable namespace only**: drop all
   OUTPUT except the numeric pooler IP and TCP port 6543.
5. Run a transient systemd unit under `DynamicUser=yes`, `NoNewPrivileges=yes`,
   `NetworkNamespacePath` referencing the holder namespace,
   `IPAddressDeny=any`, `IPAddressAllow=<one numeric IP>/32`,
   and `LoadCredential=watchdog-ca` for **public CA only**.
6. From that SAME non-root service and namespace, verify real PostgreSQL
   SSLRequest handshake and certificate/hostname with `openssl s_client`.
7. Probe TCP port 443 at the **same permitted IP**, confirm rejection,
   and inspect nftables counters for positive permitted and denied traffic.
8. Stop and collect the transient unit; always delete the holder and temp
   files. Never create a persistent user, role, service or namespace.

## Verified output on VPS srv1792369

- `CST_GATEA_LAYERED_REAL_SUPAVISOR_TLS_PASS`
- `CST_GATEA_LAYERED_SAME_IP_WRONG_PORT_DENIED`
- `CST_GATEA_LAYERED_KERNEL_ALLOW_DENY_COUNTERS_PASS`
- `CST_GATEA_LAYERED_SYSTEMD_NFT_REAL_POOLER_QA_PASS`
- `CREDENTIAL_USED=PUBLIC_CA_ONLY`
- `STAGING_LOGIN_NOT_OPENED=TRUE`
- `NO_PERSISTENT_SERVICE_CREATED=TRUE`

Evidence: `/opt/cst-onejob-dev/qa/gatea-layered-systemd-nft-real-pooler-20261123.log`.

## Explicit limitations

DNS addresses of the managed Supavisor load balancer can rotate. This
disposable test resolves one IP at execution time; it is not a production
pinning/renewal process. The Docker test is transient and may briefly use
normal Docker bridge networking; it does not manually alter the host nft
rules. The test does **not** authenticate to PostgreSQL, prove draining of
the Supavisor frontend connection pool, or test restart of the whole VPS.

Credentials for `cst_gatea_watchdog_relock` are absent and login stays OFF.
No Gate A staging/signer/dispatch permission is implied. **Operational NO-GO.**