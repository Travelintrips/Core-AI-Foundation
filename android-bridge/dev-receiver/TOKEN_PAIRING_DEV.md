# Android DEV scoped token broker

This is a DEV-only pilot. The Android APK never receives an AI Task bridge service token.
The HTTPS frontend must reverse proxy `POST /v1/android/token` to loopback
`127.0.0.1:18797` with no GET support, and must not expose device registry/grant files.

## VPS deployment

Use the same `BRIDGE_DEVICE_HMAC_SECRET` and `BRIDGE_DEVICE_SPOOL_DIR` as the
DEV result intake service. Run the broker with a restricted service account
that can read the device registry and job grant files; limit file mode to 0600.
Keep this service isolated from PROD.

An authorized VPS administrator enrolls the device **once**, on the VPS:
`node device-admin.mjs enroll zfold4-dev`.
The resulting one-time credential is transferred directly to the device
using a secure operator channel. Do not post it in GitHub or an AI chat.
Enter and save the credential once in the Android DEV app.

Job assignment must be performed **only by an authenticated dispatcher** after
checking the job belongs to this device. For a manual DEV test, the authorized
admin runs `node device-admin.mjs grant zfold4-dev <job-uuid>`.
The grant expires after 1 hour, and token issuance expires after 5 minutes.
The app exchanges its device credential and job UUID for an ephemeral,
HMAC-signed result-intake token; an unrelated or unassigned job returns 403.

Revocation: `node device-admin.mjs revoke zfold4-dev`.
Do not publish the enrollment/admin CLI over HTTP.

## Verification

`node --test android-bridge/dev-receiver/token-broker.test.mjs`.
Tests verify unknown device rejection (401), unassigned job rejection (403),
assigned job token issuance (200), cross-job denial (403), and revocation (401).

## Limitations

This PR does not automatically assign incoming jobs to Android; the dispatcher
must still create time-bounded grants. In the Android DEV prototype, the device
credential is stored in app-private preferences (not the Android Keystore).
For general production use, migrate to hardware-backed KeyStore authentication
and add strong audit logs, rate limits, and a supervised device registration flow.
Do not enable this DEV feature in PROD.
