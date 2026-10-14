#!/usr/bin/env bash
# Forced-command SSH key gate: no PTY, no SCP, no shell, no arbitrary commands.
set -euo pipefail
original="$(printenv SSH_ORIGINAL_COMMAND 2>/dev/null || true)"
if [[ "$original" == "probe" ]]; then
  echo "VPS_DEV_SSH_GATE=PASS"
  exit 0
fi
if [[ "$original" =~ ^deploy:[a-f0-9]{40}$ ]]; then
  target="$(printf '%s' "$original" | cut -c 8-)"
  exec /usr/bin/python3 /usr/local/sbin/cst-vps-dev-release.py "$target"
fi
echo "VPS_DEV_SSH_GATE=DENIED" >&2
exit 126
