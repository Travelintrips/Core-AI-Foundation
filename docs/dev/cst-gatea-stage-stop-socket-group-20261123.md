# CST-DEV Gate A STOP socket permission release gate

This is SOURCE ONLY on PR #1772. The original AF_UNIX STOP-only relay already verifies `SO_PEERCRED`, the watchdog MainPID and cgroup, and accepts no arbitrary service target. Its source tests remain valid. This hardening makes the socket **not world writable**.

The socket candidate has `SocketUser=root`, `SocketGroup=cst-onejob-gatea-stop`, `SocketMode=0660`. The watchdog candidate uses `DynamicUser=yes` plus the single static supplementary group. The group configuration is a `.CANDIDATE` source file and has **not** been provisioned on the shared VPS. Only after independent DEV authorization may an operator install it as an `/etc/sysusers.d/*.conf` file and verify group existence, socket ownership, and that the systemd DynamicUser can connect.

This changes neither the already-running watchdog source nor its installed unit, permits, PostgreSQL roles, nor PROD. Stop bridge service/socket candidates are **not installed or enabled**. No runtime STOP is exercised here; the already-tested dummy STOP and live kernel SO_PEERCRED evidence remain QA only. Existing transport EOF and relock tests must continue to PASS.

**Still blocked:** signed stage OPEN permit, provider/transport-correlated held-open frontend EOF after actual watchdog relock, and reviewed activation of the single fixed stop bridge. CI PASS is never operational release authority.
