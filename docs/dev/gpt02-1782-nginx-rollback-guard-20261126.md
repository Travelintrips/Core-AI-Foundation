# GPT02-1782 CST-DEV — rollback timer guard

This is a restoration-only helper, not a deployment or role-authorization utility. It does not open the endpoint, provision credentials, alter PostgreSQL, or mint an Owner session.

## Contract
- Fixed target: existing DEV Nginx virtual host, never PROD.
- Creates a root-only 0600 backup of the exact baseline gate and refuses overwrite.
- The --arm mode schedules an independent transient systemd timer for 30–180 seconds and verifies that its timer is active. Do not remove the 503 gate until the timer is confirmed active.
- The --restore mode accepts only replacement of the one exact return-503 gate line with the approved comment. It restores original bytes atomically, validates nginx -t, reloads Nginx, and checks readback.
- Unexpected concurrent file edits fail closed at the tool level (no overwrite). An operator must investigate; this guard does not guarantee restoration after arbitrary concurrent edits.
- A transient systemd timer is NOT reboot-persistent. Live installation must address host reboot before relying on the timer as a guarantee.
- This source has not been installed or armed on the live VPS.

## Future operation — only under new explicit one-use Owner authorization
1. Verify current worker/DBA signatures, reader lease, exact DEV target, and genuine fresh Google Owner browser session.
2. Install pinned script as root-owned, non-group-writable on DEV; verify SHA and exact path.
3. Run as root with --arm --delay-seconds 90; confirm WATCHDOG_ARMED and the independent .timer unit is active.
4. Only then temporarily replace the exact Nginx 503 line with the exact COMMENT constant from the script, validate nginx -t, and reload.
5. Run negative public HTTP checks, and ask the legitimate Owner to press the existing Baca keputusan challenge asli button in the browser; do not extract or forward tokens.
6. Invoke --restore immediately in all cases, and allow the armed timer to serve as a separate restoration attempt; verify final public 503. No E2E PASS without actual HTTP 200 JSON CONSUMED/APPROVED and authorization negatives.

Source: scripts/vps/gpt02_owner_ledger_nginx_restore_guard.py and scripts/vps/test_gpt02_owner_ledger_nginx_restore_guard.py.
No Phase B/RLS, PROD, Task190, signing, dispatch, or shared credential change.