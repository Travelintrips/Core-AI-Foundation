# OpenClaw Android Chat Bridge — DEV

Isolated Android companion for consent-based ChatGPT handoff. Does **not** modify the paired official OpenClaw Android node or production gateway.

## Device-tested (v0.1.0)
On Samsung Z Fold4, user confirmed: APK installs, ChatGPT opens, prompt is sent, and text can be returned to the app.

## New DEV stage: user-confirmed job result envelope
1. Enter the AI Task **job UUID** (not an AI Core CWS display ID).
2. Enter a prompt, use **Buka ChatGPT**, and send it (manual interaction may be required).
3. Share ChatGPT's answer back to Bridge or paste it into the result field.
4. Tap **Bagikan paket hasil job (manual)** and choose a trusted receiver.
5. The exported JSON has `protocol`, `jobId`, `eventId`, `resultSummary`, `source`, and `verifiedByAiCore:false`.

The event ID remains stable across screen rotation or repeated Share within the same activity instance, for idempotent receiving. A fresh activity instance gets a new event ID; backend must deduplicate by job plus result identity. Result is limited to 2,000 characters to align with the DEV bridge API.

**Important:** This export is *not* proof that AI Core received a result. It does not call any network endpoint, and does not generate an ACK.

## Callback design to implement after broker is available
- A trusted DEV broker authenticates the Android user and issues a short-lived, job-scoped submission token. Do not put `AI_TASK_BRIDGE_TOKEN`, `AI_TASK_BRIDGE_ACK_TOKEN`, worker lease tokens, or OpenClaw gateway secrets into an APK.
- Broker validates job ownership, state, replay, body size, and TTL, records the result, forwards through the authenticated job bridge, and verifies canonical callback receipt.
- Only the server may transition a job to COMPLETED after independent ACK. Fail closed on invalid or missing ACK.
- Use retries with idempotency and backoff for network transient failures.

## Build
JDK 17, Gradle 8.10.2, AGP 8.7.3, Android SDK 35.
`gradle :app:assembleDebug` under `android-bridge`; workflow `Android Bridge DEV APK` publishes a debug artifact.

## Constraints
No Accessibility Service, automated ChatGPT screen scraping, or silent background sending. Android's ChatGPT app is not an automation API.
