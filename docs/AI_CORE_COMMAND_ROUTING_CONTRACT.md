# AI Core Command Routing and Completion Contract

## Mandatory routing
- Status/read-only requests (cek, status, monitor, inspect) may use status endpoints.
- Mutation requests (perbaiki, implementasikan, buat, pasang, ubah, deploy, jalankan, execute, install) MUST NOT be satisfied by status-only operations such as HOSTINGER_VPS_STATUS or EXTERNAL_AGENT_STATUS.
- Source-code changes MUST be handled through GitHub branch/PR/CI, not a read-only infrastructure status lookup.
- SSH and terminal requests MUST target an authorized bounded terminal executor (e.g. openclaw-vps-main), with allowlisted commands, least privilege, execution timeout, audit logs, and secret redaction.
- Infrastructure mutations MUST use an explicit mutation-capable operation with confirmation where required.
- When intent cannot be mapped to an available mutation executor, return ROUTE_UNAVAILABLE with the missing capability and do not pretend the action succeeded.
- Preserve the requested target and goal; never silently replace an implementation task with a status query.

## Completion criteria
- Do not report a task as completed before changes are applied and tests pass.
- For code: PR, green CI, merge, deployment, and production verification are required before reporting successful delivery.
- For SSH: demonstrate AI Core -> OpenClaw -> terminal -> AI Core with captured exit code and sanitized stdout/stderr.
- If blocked, record the exact blocker and status; never invent success.
- Avoid repetitive progress notifications; provide a terminal outcome when available. This is a project workflow rule, not a mechanism to change all ChatGPT sessions.

## Regression scenarios
1. "cek status VPS Hostinger" -> HOSTINGER_VPS_STATUS (read-only).
2. "implementasikan SSH OpenClaw Hostinger" -> mutation-capable implementation path, NEVER HOSTINGER_VPS_STATUS.
3. "perbaiki command router lewat GitHub" -> GitHub coding path, NEVER EXTERNAL_AGENT_STATUS.
4. "jalankan whoami via SSH OpenClaw" -> authorized terminal executor, NOT status lookup.
5. "deploy setelah CI hijau" -> deployment executor with gates, NOT status lookup.
6. Unsupported mutation -> ROUTE_UNAVAILABLE with explanation.
