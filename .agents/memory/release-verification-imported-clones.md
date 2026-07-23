---
name: Release verification for imported clones
description: How to handle release audits when an imported repository and its live custom domain do not share independently verifiable deployment state
---

For a release audit on an imported project, do not treat an old release report or a live custom domain as proof that the current workspace has a deployable release. Independently compare the repository history, working tree, Replit deployment metadata, and live public and privileged checks.

**Why:** An imported shallow clone can expose only a grafted tip commit while the custom domain still serves a healthy application from a different deployment context. Prior reports can also describe older database snapshots that conflict with current live responses.

**How to apply:** Require a clean tree, a complete identifiable release revision, an active successful deployment, and a complete privileged smoke test before approving go-live. If any of these are unavailable, document the evidence and block the release rather than inferring success.