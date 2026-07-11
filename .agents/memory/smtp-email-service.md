---
name: SMTP email service setup
description: How real email sending was wired up (quotation emails) and the Hostinger SMTP quirks hit while testing.
---

Real transactional email (quotation links) is sent via `artifacts/api-server/src/services/emailService.ts` (nodemailer + SMTP_HOST/PORT/USER/PASS/FROM secrets). Previously all "notification" services (`clientReviewNotificationService.ts`) only logged to console/audit — no real email was ever sent anywhere in this project before this was added.

`POST /ai/catalog/requests/:id/issue-quotation` sends the quotation email automatically now and returns `emailSent`/`emailError` in the response; calling it again re-issues the token and resends — this is the "resend" action, exposed as a button in the admin service-requests detail panel (no separate resend endpoint needed).

**Why:** User asked to resend a quotation email and there was no way to do it — email sending didn't exist. Reusing the existing re-issue endpoint for resend avoided adding a parallel code path with its own token-rotation bugs.

**How to apply:** When adding new transactional emails elsewhere (review links, approvals, etc.), reuse `sendEmail()` from emailService.ts rather than adding a new nodemailer transport — it's a singleton and audit-logs every send/failure.

Hostinger SMTP quirk hit during setup: `smtp.hostinger.com` rejects auth with a generic `535 5.7.8` error that gives no hint whether the problem is host/port/user/pass — tested both port 465 (implicit TLS) and 587 (STARTTLS) with identical failure before finding the real cause was simply a wrong username domain (`.co.od` typo vs `.co.id`). When debugging 535 errors here, verify the exact username string before assuming port/TLS config is wrong.
