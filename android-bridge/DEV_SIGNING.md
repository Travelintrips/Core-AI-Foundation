# Android Bridge DEV stable update signing

## Fixed release identity

The official DEV APK artifact produced by GitHub Actions **Android Bridge DEV APK** is signed with one private PKCS12 certificate. This replaces the disposable runner-local `debug.keystore` and allows subsequent Android updates with matching package ID and a higher `versionCode`.

- Package: `id.cst.openclawbridge.autosend`
- Signed release introduced at: `0.10.1-dev-stable-signing` (`versionCode 18`)
- Signing alias: `cst-android-dev`
- Public certificate SHA-256: `F3:E9:7C:0A:9D:B8:3C:15:1B:7C:18:0A:16:C6:CA:AF:17:89:2D:BD:0A:46:20:51:A0:DC:BE:4D:0C:7D:4E:AA`
- Encrypted GitHub Actions repository secrets: `ANDROID_DEV_SIGNING_KEYSTORE_B64` and `ANDROID_DEV_SIGNING_PASSWORD`
- Local recovery copy: Travelintrips PC current user's protected LocalAppData/CST/AndroidDevSigning; password is DPAPI encrypted. Never commit, print, copy into logs, or share these files.

CI **fails closed** if either secret is absent, the PKCS12 alias cannot be opened, the signed APK fingerprint changes, or the package/version doesn't match. Only the signed APK is uploaded as an Actions artifact. No private keystores or passwords are uploaded as artifacts.

## Installing on Samsung Z Fold4

If an older APK was signed using another GitHub-hosted runner's default debug certificate, Android will refuse an in-place update even if the package ID matches and the version is greater. **Android provides no safe way to bypass certificate matching.** The original signing private key was not found in the checked authorized workstations, so some currently installed versions need a **one-time uninstall**. Uninstalling deletes app-local pairing and preferences (the manifest disables backup).

1. Record any nonsecret pairing context and confirm the DEV admin can approve a new device pairing. Do not copy the long-lived device credential into chat or notes.
2. Obtain `app-debug.apk` **only** from the newest successful Android Bridge DEV APK GitHub Actions run after this signing fix. Verify the build signer fingerprint above. Do not use locally signed Gradle debug APKs.
3. Try installing as an update first. If Android reports an incompatible signature, uninstall **only** `OpenClaw Auto Kirim (DEV)` (package above), then install the official signed APK.
4. Open the app, initiate a new DEV pairing, get admin approval, and enable Accessibility again **only** if an explicitly authorized feature needs it.
5. Validate version, future update without uninstall, job claim, callback receipt, verified result and exactly one ACK. Launching GitHub alone is not a verified E2E PASS without separate device-side evidence.

## Release/rollback safety

- Increase Android `versionCode` for every replacement APK. Never regenerate or rotate the private DEV signing key as part of ordinary updates.
- Future updates MUST keep the same GitHub Actions secrets, alias, certificate fingerprint and package name.
- A new signing key is a controlled migration requiring a deliberate, documented reinstall, not a seamless update.
- PROD or official OpenClaw Android node is outside this DEV companion's scope.
