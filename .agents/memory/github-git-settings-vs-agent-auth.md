---
name: Git settings vs Agent GitHub authentication
description: Replit Git settings can show GitHub Active while Agent-side GitHub connector and git push remain unauthenticated
---

The Git settings connection status is not sufficient evidence that Agent-side GitHub write access is available. Verify both the remote write path and the Agent integration status before attempting push or PR operations.

**Why:** A repository can be readable through the configured remote and show GitHub Active in the UI, while `git push`, `gh auth status`, and Agent integration calls still report unauthenticated.

**How to apply:** Do not request or expose tokens; use the supported GitHub integration flow, and stop with an external authentication blocker if it is not attached to the Agent environment.