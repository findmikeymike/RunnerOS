# RunPod LTX Worker

Deployable RunPod Serverless worker for Squad's candidate `runpod/ltx-video-2.3` route.

## What It Does

- Accepts RunPod queue payloads under `event.input`.
- Requires `mode=image_to_video`, `prompt`, and `input_image_url`.
- Downloads the first-frame image from a public/presigned URL.
- Runs LTX inference through `LTX-Video/inference.py`.
- Uploads or exposes an MP4 URL through the configured uploader.
- Returns the exact output contract expected by `HttpRunPodLTXTransport`.

## Build

```bash
docker build --platform linux/amd64 -f workers/runpod_ltx_worker/Dockerfile -t YOUR_DOCKER_USER/squad-ltx-worker:latest .
docker push YOUR_DOCKER_USER/squad-ltx-worker:latest
```

## RunPod Endpoint

Create a queue-based Serverless endpoint from the Docker image. Start with:

- Cloud type: Community Cloud for bulk/batch benchmarks; Secure Cloud only for user-facing reactive regen where variance hurts UX
- GPU: A100 80GB as the preferred serious benchmark target; RTX 4090/A5000 can be cheaper smoke-test options, but expect less headroom
- Workers min: `0` until cold-start numbers are known
- Workers max: `1` for safe cost control during the spike
- FlashBoot: enabled
- Execution timeout: at least 15 minutes

Use A100 80GB before judging 20s or higher-resolution LTX capability. A 40GB card may pass small clips and still fail the workloads that matter.

## Payload

```json
{
  "input": {
    "mode": "image_to_video",
    "prompt": "A model turns toward camera, claps twice, then laughs under warm neon light.",
    "duration_s": 5,
    "aspect_ratio": "16:9",
    "negative_prompt": "jitter, warped hands, unreadable text",
    "seed": 12,
    "input_image_url": "https://...",
    "audio_prompt": "optional prompt context only; this worker does not mux audio yet"
  }
}
```

## Current Limitation

For real deployment, configure S3-compatible output:

- `SQUAD_LTX_S3_BUCKET`
- `SQUAD_LTX_S3_PUBLIC_BASE_URL`
- `SQUAD_LTX_S3_ENDPOINT_URL` if not AWS
- `SQUAD_LTX_S3_ACCESS_KEY_ID`
- `SQUAD_LTX_S3_SECRET_ACCESS_KEY`

Or configure RunPod's bucket upload variables:

- `BUCKET_ENDPOINT_URL`
- `BUCKET_ACCESS_KEY_ID`
- `BUCKET_SECRET_ACCESS_KEY`
- `BUCKET_NAME`

Without S3 or RunPod bucket env, the fallback `LocalFileUploader` requires `SQUAD_LTX_PUBLIC_OUTPUT_BASE_URL`. Do not make this the default backend until upload and benchmark gates pass.

`audio_prompt` is currently only folded into the motion prompt. Real audio generation or post-render audio muxing belongs in a later worker/post-pass.
