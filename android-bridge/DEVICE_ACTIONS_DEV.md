# Z Fold4 restricted device actions (DEV only)

## Correct route for opening GitHub on the Z Fold4

**Do not use the generic OpenClaw/PC browser command:** that opens GitHub on the
selected OpenClaw computer, including DELL. It is not a phone action.

Use **only** an authorized Android DEV entry point:

- Admin UI: `https://dev-ai-task.cstlogistic.co.id/android-admin/` (requires authenticated admin). Select **Buka GitHub di HP Z Fold4**.
- Authenticated Android DEV MCP: tool `open_github_on_zfold4_dev` with empty arguments, if that separate MCP connector has been enrolled.

Both create a DEV job with `source=OPENCLAW`,
`source_session_id=android-dev:<most-recently-paired-active-Z-Fold4>`,
title `Z Fold4 DEV OPEN_URL GitHub`, and a matching one-hour scoped
`OPEN_URL https://github.com/` action. The DEV dispatcher **refuses to
grant** that title when the action is absent, expired, or targets any other
device. There is no PC fallback. Existing generic DEV test jobs remain
separate.

On the Z Fold4, open the Bridge app, press **AMBIL JOB DEV OTOMATIS**,
and approve **Jalankan** on the Android confirmation dialog. Do not press
the separate automatic ChatGPT test button. The app opens GitHub via
an Android foreground intent; its local status explicitly does not claim
successful browser rendering, callback, or ACK.

A generic OpenClaw chat command still may dispatch to a PC if sent through
the **generic desktop route**. The Android DEV entry point is required until
the calling app explicitly selects the phone-targeted tool. Do not infer
Z Fold4 execution from GitHub appearing on DELL.


Run this only from an authorized VPS admin shell after creating an explicitly assigned Android DEV job.

```sh
node android-bridge/dev-receiver/action-admin.mjs <job-uuid> <active-zfold4-device-id> OPEN_URL https://github.com/Travelintrips/Core-AI-Foundation
node android-bridge/dev-receiver/action-admin.mjs <job-uuid> <active-zfold4-device-id> OPEN_APP com.github.android
node android-bridge/dev-receiver/action-admin.mjs <job-uuid> <active-zfold4-device-id> DEVICE_STATUS
```

The device identity must match the job's existing grant and be active in the DEV pairing registry.
The broker returns a scoped action on `/v1/android/jobs/next` only for a valid matching device, job, and expiry.
The Android app validates the action again, shows a mandatory dialog on the handset and offers each job action only once.
Supported commands are `OPEN_URL` (HTTPS hosts github.com, www.github.com, dev-ai-task.cstlogistic.co.id only), `OPEN_APP` (GitHub/ChatGPT/Chrome), and `DEVICE_STATUS` (local Bridge/network availability, no sensitive identifiers). No arbitrary shell, ADB, taps, clipboard reads, background launch, or PROD access.

**Important:** Opening an Android intent is not independently verified app navigation. These actions do not auto-create job results or ACK. A job stays pending until a separate trusted proof workflow is completed. Direct control from ChatGPT also requires a separately connected authenticated MCP action tool; existing verification-only skill is insufficient.

Verification: `node --test android-bridge/dev-receiver/device-actions.test.mjs android-bridge/dev-receiver/token-broker.test.mjs` and Android DEV APK workflow. Actual Z Fold4 verification requires phone-installed APK, accepted dialog, screenshot/physical observer, authoritative callback and exactly one ACK.
