# GPT02-1782 CST-DEV — primary systemd restore timer accuracy fix (DRAFT)

**Status: SOURCE-ONLY, NOT INSTALLED, NOT ARMED, NO LIVE NEGATIVE E2E.**

Issue tracker: [#1850](https://github.com/Travelintrips/Core-AI-Foundation/issues/1850). The existing boot guard and Nginx fail-closed boundary remain deployed unchanged; the new source must not be installed until separately Owner-authorized.

## Proven critical flaw in the installed primary rollback configuration

The installed root restore guard's default `--arm` uses `systemd-run --on-active=90s --collect` **without** an explicit `AccuracySec`. On the authorized Ubuntu 24.04 VPS, `systemd 255` and the installed `systemd.timer` manual confirm **`AccuracySec=1min` by default**. It permits timer expiry within the 60-second window after the scheduled due time. Therefore a nominal 90s timer can begin its close-only action around 150s after arming, *before* the time required to validate Nginx, reload and check effective HTTPS503. **It cannot guarantee a ≤90-second gate opening.**

The current installed guard SHA256 is `e8e874d3d05de88f405d7584ede63a51539ad1e986aed2a2c620773ea2e92448`, and the original boot source SHA256 remains `26ea880f87b4eed5dea9cda0bd907b03711262abe470cde65b6c2e8e4b4b0e32`. The existing approved Nginx `sites-enabled` SHA is `496dac900c7228ddbebeb06151d17693de5bcf744fc8a0426d5eb3739dbcab3f`.

## Proposed precise, earlier primary timer (not a real-time guarantee)

This proposed diff changes ONLY the existing `scripts/vps/gpt02_owner_ledger_nginx_restore_guard.py` source. It preserves the SHA-pinned canonical full-vhost checker, fixed scope, exact **closed-only** restore function, protected backup semantics, Nginx 503/no-store postcheck, and immutable root boot source.

- `--arm` accepts **only `--delay-seconds 30`** (also its new default), rejecting any old `90` request. A shorter real test window is deliberately acceptable to stay below the **maximum** 90-second cap.
- `systemd-run` arguments include `--on-active=30s`, `--timer-property=AccuracySec=1s` and `--timer-property=RandomizedDelaySec=0` before invoking the unchanged root `--restore`.
- The arm function rejects a nonzero scheduler return and then uses `systemctl show` to verify **actual PID1 timer** `ActiveState=active`, `AccuracyUSec=1s`, `RandomizedDelayUSec=0` and exactly the intended `Unit=gpt02-1782-owner-ledger-restore.service`. Missing, unexpected, duplicate, stale or malformed properties **block before any Nginx gate edit**.
- The model gives **30s due + 1s accuracy + 20s Nginx syntax check + 20s reload + 7s HTTPS503 verification + 6s modeled overhead = 84s**, leaving 6 seconds of modeled margin. This *cannot* guarantee completion under a frozen kernel, lost network, disk problems, delayed systemd job or failed Nginx reload. **Model PASS is not actual E2E or hard real-time proof.**
- A timer may expire while the operator is still preparing the Nginx opening; in that case the operator must abort rather than reopen the gate.
- The independent **110s secondary fallback** proposed in draft #1854 cannot serve as a primary ≤90s bound. It is only a separate recovery layer and not reboot-persistent. The original root boot precheck is a separate failclosed protection upon Nginx startup.

## Operational security boundary

This PR **does not install or arm any root script, open Nginx, extend the PostgreSQL reader, create Owner approval, issue signed credentials, stop/resume the shared DEV watcher, touch Task190 or PROD, or complete an HTTP404 E2E**. The preinstalled older root guard remains the only authorized live version.

Because the candidate root guard would have different SHA256, it requires a separately approved **atomic root install and backup** and corresponding re-review/update of any downstream exact SHA pins in draft #1853 and draft #1854. Do not loosen the installed pins to accept both without source review.

The existing `/root/gpt02-1782-recovery/one-shot-window-v9-staged-safe-v2.py` is still blocked by `BASELINE_NOT_EXACT` and must never be replayed. Before an Owner-authenticated negative HTTP404 test, a new reviewed one-shot operator with strict shared DEV deployment freeze, independently verified rollback timer, fresh dedicated reader/DBA public proof, signed Owner browser session, explicit **fresh one-use Owner authorization**, and post-window HTTP503/role-expired/0 sessions evidence is still required.

## Source-only tests

The existing isolated root restore/boot fixture suite has been extended to verify the new 30-second setting, timer arguments, actual returned timer properties, rejection of the default one-minute accuracy, randomized delays, wrong active unit, malformed PID1 output, timeout/scheduling failure and no unwanted gate changes. No GitHub Action arms systemd or calls Nginx on the authorized VPS.

**GPT02 Owner Ledger E2E remains PARTIAL / NO-GO.**
