# OpenClaw Android Chat Bridge — DEV prototype

Separate, consent-based Android prototype. Does not modify the paired official OpenClaw Android client or Gateway production deployment.

## Available features
- Open ChatGPT Android and share a prompt where supported; otherwise copy the prompt for manual paste.
- Receive a user-shared text result or paste it manually.
- Copy the result for user-initiated transfer.

## Not yet implemented
- Automated sending or reading of ChatGPT messages.
- OpenClaw Gateway node protocol integration.
- Authenticated callback to AI Core and callback ACK. Backend-issued short-lived tokens are required before that feature is enabled; never embed shared secrets in an APK.
- Physical-device tests.

## Build
JDK 17, Gradle 8.10.2, Android Gradle Plugin 8.7.3, Android SDK 35.
Run `gradle :app:assembleDebug` from the project root. The GitHub workflow builds an unsigned-for-release debug APK for DEV testing only.

## Constraints
Do not treat a ChatGPT app subscription as an automation API. This project intentionally has no Accessibility Service or background UI scraping. Further user-initiated deterministic automation would require security and platform-policy review.
