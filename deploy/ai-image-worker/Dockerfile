FROM python:3.12-slim

ARG COMFYUI_VERSION=v0.38.0
ARG PYTORCH_INDEX_URL=https://download.pytorch.org/whl/cu128

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --depth 1 --branch "${COMFYUI_VERSION}" https://github.com/Comfy-Org/ComfyUI.git /opt/ComfyUI

WORKDIR /opt/ComfyUI
RUN python -m pip install --upgrade pip setuptools wheel \
    && python -m pip install torch torchvision torchaudio --index-url "${PYTORCH_INDEX_URL}" \
    && python -m pip install -r requirements.txt \
    && python -m pip install huggingface_hub

EXPOSE 8188

CMD ["python", "main.py", "--listen", "0.0.0.0", "--port", "8188", "--disable-auto-launch"]
