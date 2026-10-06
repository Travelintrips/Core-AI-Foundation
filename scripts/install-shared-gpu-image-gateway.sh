#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NGINX_SITE=/etc/nginx/sites-available/ollama
ENV_FILE=/etc/ai-core/image-gateway.env

install -d -m 0755 /opt/ai-image-gateway /var/lib/ai-gpu-runtime
install -d -m 0750 /etc/ai-core
install -m 0755 "$ROOT_DIR/scripts/ai-image-gateway.py" /opt/ai-image-gateway/gateway.py
install -m 0755 "$ROOT_DIR/scripts/ai-gpu-idle-guard.sh" /usr/local/sbin/ai-gpu-idle-guard

if [[ ! -f "$NGINX_SITE" ]]; then
  echo "Missing Nginx site: $NGINX_SITE" >&2
  exit 1
fi

# Reuse the already-provisioned Ollama API key without printing it.
# AI Core receives the matching OLLAMA_WORKER_API_KEY from GCP Secret Manager.
GATEWAY_TOKEN="$(sed -n 's/.*http_x_api_key != "\([^"]*\)".*/\1/p' "$NGINX_SITE" | head -n1)"
if [[ -z "$GATEWAY_TOKEN" ]]; then
  echo "Could not derive existing Ollama gateway API key." >&2
  exit 1
fi

umask 0027
cat >"$ENV_FILE" <<EOF
AI_IMAGE_GATEWAY_TOKEN=$GATEWAY_TOKEN
COMFYUI_BASE_URL=http://127.0.0.1:8188
AI_IMAGE_GATEWAY_HOST=127.0.0.1
AI_IMAGE_GATEWAY_PORT=9191
AI_IMAGE_CHECKPOINT=sd_xl_base_1.0.safetensors
AI_GPU_IMAGE_REQUEST_FILE=/var/lib/ai-gpu-runtime/image-requested
AI_GPU_LAST_BUSY_FILE=/var/lib/ai-gpu-runtime/last-busy
EOF
chmod 0640 "$ENV_FILE"

cat >/etc/systemd/system/ai-image-gateway.service <<EOF
[Unit]
Description=AI Core private ComfyUI image gateway
After=network-online.target comfyui.service ollama.service
Wants=network-online.target comfyui.service ollama.service

[Service]
Type=simple
User=root
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/python3 /opt/ai-image-gateway/gateway.py
Restart=on-failure
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/ai-gpu-idle-guard.service <<'EOF'
[Unit]
Description=Shared Ollama and ComfyUI GPU idle guard
After=network-online.target

[Service]
Type=oneshot
Environment=AI_GPU_IDLE_SECONDS=300
Environment=COMFYUI_BASE_URL=http://127.0.0.1:8188
ExecStart=/usr/local/sbin/ai-gpu-idle-guard
EOF

cat >/etc/systemd/system/ai-gpu-idle-guard.timer <<'EOF'
[Unit]
Description=Check shared GPU VM idle state every minute

[Timer]
OnBootSec=5min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
EOF

mkdir -p /etc/systemd/system/ai-remote-ollama-worker.service.d
cat >/etc/systemd/system/ai-remote-ollama-worker.service.d/30-shared-gpu.conf <<'EOF'
[Service]
# Shared idle guard is the only authority allowed to power this GPU VM off.
Environment=GCP_GPU_AUTO_STOP_ENABLED=false
Environment=OLLAMA_REMOTE_KEEP_ALIVE=0
Environment=AI_GPU_IMAGE_REQUEST_FILE=/var/lib/ai-gpu-runtime/image-requested
Environment=AI_GPU_LAST_BUSY_FILE=/var/lib/ai-gpu-runtime/last-busy
Environment=COMFYUI_BASE_URL=http://127.0.0.1:8188
EOF

python3 - "$NGINX_SITE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
begin = "    # BEGIN AI CORE IMAGE ROUTER\n"
end = "    # END AI CORE IMAGE ROUTER\n"
block = """    # BEGIN AI CORE IMAGE ROUTER
    location /image-router/ {
        proxy_pass http://127.0.0.1:9191/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Connection "";
        proxy_read_timeout 660s;
        proxy_send_timeout 660s;
        client_max_body_size 256k;
    }
    # END AI CORE IMAGE ROUTER
"""
if begin in text:
    start = text.index(begin)
    stop = text.index(end, start) + len(end)
    text = text[:start] + block + text[stop:]
else:
    needle = "    location / {\n"
    if needle not in text:
        raise SystemExit("Nginx insertion point not found")
    text = text.replace(needle, block + "\n" + needle, 1)
path.write_text(text)
PY

systemctl disable --now ai-image-worker-idle-shutdown.timer 2>/dev/null || true
systemctl daemon-reload
systemctl enable --now ai-image-gateway.service
systemctl enable --now ai-gpu-idle-guard.timer
systemctl restart ai-remote-ollama-worker.service 2>/dev/null || true

nginx -t
systemctl reload nginx

for _ in $(seq 1 30); do
  status="$(curl -sS -o /tmp/ai-image-health.json -w '%{http_code}' \
    -H "x-api-key: $GATEWAY_TOKEN" \
    http://127.0.0.1:9191/health || true)"
  [[ "$status" == "200" ]] && break
  sleep 2
done
test "$status" = "200"

unauth="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:9191/health || true)"
test "$unauth" = "401"

echo "READY shared GPU image gateway on HTTPS /image-router/"
