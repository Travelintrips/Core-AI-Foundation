# Z Fold4 restricted device actions (DEV only)

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
