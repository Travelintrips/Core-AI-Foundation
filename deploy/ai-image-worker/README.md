# AI Core on-demand image worker

This stack runs ComfyUI on a dedicated NVIDIA GPU VM and is intentionally separate
from the existing coding-worker stack.

## Purpose

- ComfyUI API/UI on loopback port 8188
- NVIDIA GPU acceleration
- persistent model/input/output/custom-node directories
- compatible model layout for SDXL and FLUX workflows
- optional VM power-off after a configurable idle window
- GitHub Actions control for start/deploy, status, and stop of a pre-created GCE VM

ComfyUI is pinned to `v0.38.0`. The container installs CUDA-enabled PyTorch wheels
and relies on the host NVIDIA driver plus NVIDIA Container Toolkit.

## Recommended GCP shape

For SDXL, a T4 16 GB can work, but an L4 24 GB is a better default for throughput
and more demanding FLUX workflows. Keep the VM stopped when unused.

The GCE VM must already have:

1. an NVIDIA GPU attached;
2. a compatible NVIDIA driver;
3. Docker Engine + Docker Compose v2;
4. NVIDIA Container Toolkit configured for Docker.

## Install on the GPU VM

From the repository root:

```bash
sudo AI_IMAGE_WORKER_ENV_FILE=/etc/ai-core/ai-image-worker.env \
  bash scripts/install-ai-image-worker.sh
```

The UI/API binds only to `127.0.0.1:8188`. Do not expose it directly to the
Internet. AI Core or an authenticated reverse proxy should be the public entry point.

## Model files

Weights are deliberately **not baked into the container image**. They persist under
`/opt/ai-image-worker/models` by default, so stopping the VM does not require
re-downloading models.

Typical ComfyUI directories:

- SDXL checkpoints: `models/checkpoints/`
- FLUX diffusion model: `models/diffusion_models/` (or the path expected by the selected workflow)
- text encoders: `models/text_encoders/`
- VAE/AE: `models/vae/`
- LoRAs: `models/loras/`

Use only model files whose license/terms you have accepted. For Hugging Face gated
assets, keep `HF_TOKEN` in the protected host env file; never commit it.

## Health check

```bash
curl -fsS http://127.0.0.1:8188/system_stats
curl -fsS http://127.0.0.1:8188/queue
```

## Idle shutdown

The installer creates a systemd timer. Every minute it checks the ComfyUI queue and
the last generated output timestamp. When there is no running/pending work for
`AI_IMAGE_IDLE_MINUTES` (default 10), the VM powers off. Disable with:

```bash
AI_IMAGE_IDLE_SHUTDOWN_ENABLED=false
```

in `/etc/ai-core/ai-image-worker.env`, then rerun the installer.

## GitHub Actions

`.github/workflows/ai-image-worker-gcp.yml` controls a pre-created GCE GPU VM.
Configure the protected environment `ai-image-worker-gcp` with:

Secrets:
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`

Variables:
- `GCP_PROJECT_ID`
- `GCP_GPU_ZONE`
- `GCP_IMAGE_WORKER_INSTANCE`

The workflow uses Workload Identity Federation; no long-lived GCP JSON key is
required.
