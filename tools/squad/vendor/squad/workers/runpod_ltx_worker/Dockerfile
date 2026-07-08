FROM nvidia/cuda:12.2.2-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV SQUAD_LTX_REPO_DIR=/opt/LTX-Video

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        python3 \
        python3-pip \
        python3-venv \
        ffmpeg \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY workers/runpod_ltx_worker/requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir -r /app/requirements.txt

RUN git clone --depth 1 https://github.com/Lightricks/LTX-Video.git /opt/LTX-Video \
    && pip3 install --no-cache-dir '/opt/LTX-Video[inference]'

COPY workers /app/workers

CMD ["python3", "-u", "-m", "workers.runpod_ltx_worker.handler"]
