# AI Task Android MCP — DEV only

This service exposes three MCP tools via **stateless MCP Streamable HTTP** at `/mcp/android-dev` (localhost backend port 18799). It has no PROD access or credentials.

## Security / prerequisites

- Use a **separate, independent MCP bearer secret** generated on the VPS; never embed a database token, Android pairing credential, or admin session in a plugin manifest.
- Store secret at `/etc/ai-task-android-mcp-dev/token` (owner root, mode 0600, min. 48 bytes; recommended 64 URL-safe random characters).
- Run as root only because the existing DEV job creation path uses a root-accessible Docker socket and registry. Restrict with systemd sandboxing, listen on **127.0.0.1 only**, and proxy **only** `/mcp/android-dev` through HTTPS.
- Nginx must forward the `Authorization` header and accept POST; avoid exposing other localhost paths. Limit request bodies to 8 KiB.
- An HTTP 401 without bearer is expected; it is not an anonymous MCP endpoint.
- Keep the plugin *private* until protected token/OAuth enrollment is explicitly completed.
- The Android DEV MCP API must not reuse AI Core PROD or Android device token authentication.

## Available tools

- `create_android_dev_job` — creates exactly one job for the newest active paired Z Fold4, via the **DEV-only** bridge API.
- `get_android_dev_job` — read-only DEV status, callback flag, result verification, ACK count, one UUID.
- `get_android_dev_job_events` — read-only bounded lifecycle event kinds, one UUID.

There is no access to arbitrary shell commands, job editing, pairing approval, PROD, or sensitive credential export.

## Installation (authorized operator only)

1. Copy `android-mcp-dev.mjs` to `/opt/openclaw-android-bridge-dev/android-mcp-dev.mjs`; run `node --check`.
2. Create the token file privately with restrictive permissions and configure `ai-task-android-mcp-dev.service` (separate unit included in this directory). Don't print token values.
3. Enable/start the service, verify localhost port 18799 responds with 401 when unauthenticated.
4. Add exact Nginx route:
   ```nginx
   location = /mcp/android-dev {
       limit_except POST { deny all; }
       client_max_body_size 8k;
       proxy_pass http://127.0.0.1:18799/mcp/android-dev;
       proxy_set_header Authorization $http_authorization;
       proxy_set_header Host $host;
       proxy_connect_timeout 5s;
       proxy_read_timeout 20s;
       proxy_buffering off;
   }
   ```
5. Test `nginx -t` before reload, then check 401 unauthenticated on public HTTPS.
6. With operator-provisioned auth, test JSON-RPC initialize, tools/list, read-only get tool and authorized job creation; validate DB ACK exactly once and physical Android behavior.
7. Configure the **separate secure MCP connector** in ChatGPT. The current `android-bridge-dev` Skill plugin **does not automatically attach** the MCP server. Bearer configuration and potentially OAuth support may need their own supported setup in ChatGPT.

## Release gate

Do not claim MCP PASS on a successful APK build or database E2E alone. Record authenticated tools/list, actual created job, callback, ACK and job status. Keep PROD untouched.
