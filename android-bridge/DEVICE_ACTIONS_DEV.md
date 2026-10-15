# Z Fold4 DEV: preauthorized phone browser commands

## Supported destinations

The Android DEV bridge supports the following exact HTTPS commands, dispatched
only to a paired Z Fold4 (never to DELL, another PC, or PROD):

| Key | Site / location | Exact Android URL |
| --- | --- | --- |
| `github` | GitHub | `https://github.com/` |
| `hostinger` | Hostinger hPanel | `https://hpanel.hostinger.com/` |
| `hostinger-vps` | Hostinger VPS section | `https://hpanel.hostinger.com/vps` |
| `gcp` | Google Cloud Console | `https://console.cloud.google.com/` |
| `gcp-compute` | Compute Engine VM instances | `https://console.cloud.google.com/compute/instances` |

No arbitrary site, HTTP, embedded credentials, LAN address, nonstandard ports,
shell/ADB commands, cloud API changes, form submissions, or arbitrary UI taps.

## Preauthorization and automatic receipt (APK 0.12.0)

An administrator- or separately authenticated MCP-created DEV job is the prior
authorization for a single exact allowlisted URL. Once the user opens the Bridge
app, it polls for an assigned job every 20 seconds **only while in the
foreground**. A matching job automatically launches Chrome directly with
`Intent.ACTION_VIEW` and `setPackage("com.android.chrome")`; no browser picker
and **no second confirmation dialog**. Site launch is not a login, cloud
mutation, deploy or infrastructure action. The person may disable foreground
auto pickup in the app.

The APK then submits a job-scoped, paired-device-authenticated receipt with
`source=device-intent-dispatched` and
`deviceOutcome=ANDROID_INTENT_DISPATCHED`. The server verifies the device,
active grant, exact immutable action and short-lived token. The existing
DEV consumer independently validates the callback and sends exactly one ACK.
The receipt says only that Android successfully issued a Chrome launch intent;
it **does not prove** page rendering, successful login or actual menu
interaction. The final authoritative status comes from the DEV database.
A failed receipt is retried with the **same event ID** when Bridge resumes.

An older explicit `USER_CONFIRMED_VISIBLE` path is retained for previously
in-progress jobs. Do not send a second manual event for an automatically
reported job.

## Authorized job entry points

- Basic-auth-protected DEV admin UI at
  `https://dev-ai-task.cstlogistic.co.id/android-admin/`.
- Separately connected authenticated Android DEV MCP with tools
  `open_github_on_zfold4_dev`, `open_hostinger_on_zfold4_dev`,
  `open_hostinger_vps_on_zfold4_dev`, `open_gcp_on_zfold4_dev`,
  `open_gcp_compute_on_zfold4_dev`, and DEV-only status/event readers.

The connected ChatGPT skill is verification only and by itself does not
authorize direct job creation. Do not bypass authentication or extract service
tokens to simulate an MCP connection. Real ChatGPT-initiated dispatch requires
a separately authorized connected MCP action tool.

## Navigation and safety

The Hostinger VPS and GCP Compute pages are opened through exact approved
URLs, which often avoids the need for in-page clicks. A text-only guide
explains manual menus where login is required. This DEV bridge **does not yet
safely automate arbitrary Chrome UI clicks**: it never accesses credentials,
accepts permission prompts, changes billing/IAM, deploys, deletes resources,
or starts/stops VMs. A distinct auditable, allowlisted operation must be
implemented and tested before such automation can be enabled.

## Validation and environment isolation

Run:
`node --test android-bridge/dev-receiver/device-actions.test.mjs android-bridge/dev-receiver/device-action-receipt.test.mjs android-bridge/dev-receiver/token-broker.test.mjs android-bridge/dev-receiver/job-dispatcher.test.mjs android-bridge/dev-receiver/android-direct-browser.test.mjs`.

CI must verify versionCode 21, the stable DEV signer fingerprint, and Android
APK compilation. The server-side changes deploy **only to DEV** and must
preserve active pairing IDs. A physical handset test is necessary to claim the
URL actually opened. A result is complete only when the DEV database reports
`COMPLETED`, verified callback and exactly one `CALLBACK_ACK`. A synthetic
receipt or an Android intent by itself is not a physical page-rendering PASS.
