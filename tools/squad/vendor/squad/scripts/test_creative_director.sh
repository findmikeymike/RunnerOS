#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_PY="$ROOT/.venv/bin/python"
TEST_FILE="$ROOT/tests/test_creative_director_v1.py"
DECISION_TEST_FILE="$ROOT/tests/test_creative_director_decision_model.py"
TOOLS_TEST_FILE="$ROOT/tests/test_creative_director_tools.py"
REVIEW_TEST_FILE="$ROOT/tests/test_creative_director_review.py"
REPOSITORY_TEST_FILE="$ROOT/tests/test_creative_director_repository.py"
RUNNER_TEST_FILE="$ROOT/tests/test_creative_director_runner.py"
SHOW_RUN_TEST_FILE="$ROOT/tests/test_show_creative_director_run.py"
BENCHMARK_TEST_FILE="$ROOT/tests/test_creative_director_benchmark.py"
IMAGE_PROMPT_TEMPLATE_TEST_FILE="$ROOT/tests/test_image_prompt_templates.py"
PROD_CONTRACTS_TEST_FILE="$ROOT/tests/test_creative_production_contracts.py"
PROD_TOOLS_TEST_FILE="$ROOT/tests/test_creative_production_tools.py"
PROD_NARRATIVE_TEST_FILE="$ROOT/tests/test_creative_production_narrative.py"
PROD_PROMPT_TEST_FILE="$ROOT/tests/test_creative_production_prompt.py"
PROD_HANDOFF_TEST_FILE="$ROOT/tests/test_creative_production_handoff.py"
PROD_PLAN_REVIEW_TEST_FILE="$ROOT/tests/test_creative_production_plan_review.py"
PROD_MODEL_ROUTING_TEST_FILE="$ROOT/tests/test_creative_production_model_routing.py"
PROD_EVALS_TEST_FILE="$ROOT/tests/test_creative_production_evals.py"
PROD_ASSEMBLY_TEST_FILE="$ROOT/tests/test_creative_production_assembly.py"
PROD_VOICE_TEST_FILE="$ROOT/tests/test_creative_production_voice.py"
PROD_TTS_TEST_FILE="$ROOT/tests/test_creative_production_tts.py"
PROD_POST_PASS_TEST_FILE="$ROOT/tests/test_creative_production_post_pass.py"
PROD_REVIEW_TEST_FILE="$ROOT/tests/test_creative_production_review.py"
PROD_REPOSITORY_TEST_FILE="$ROOT/tests/test_creative_production_repository.py"
PROD_GRAPH_TEST_FILE="$ROOT/tests/test_creative_production_v1.py"
PROD_RUNNER_TEST_FILE="$ROOT/tests/test_creative_production_runner.py"
PROD_SMOKE_RUNNER_TEST_FILE="$ROOT/tests/test_creative_production_smoke_runner.py"
PROD_SHOW_RUN_TEST_FILE="$ROOT/tests/test_show_creative_production_run.py"
FAL_SDK_ENV_TEST_FILE="$ROOT/tests/test_fal_sdk_environment.py"
FAL_IMAGE_CLIENT_TEST_FILE="$ROOT/tests/test_fal_image_client.py"
VIDEO_GENERATION_ADAPTER_TEST_FILE="$ROOT/tests/test_video_generation_adapter.py"
RUNPOD_LTX_ADAPTER_TEST_FILE="$ROOT/tests/test_runpod_ltx_video_adapter.py"
COMFY_LTX_ADAPTER_TEST_FILE="$ROOT/tests/test_comfy_ltx_video_adapter.py"
RUNPOD_LTX_WORKER_TEST_FILE="$ROOT/tests/test_runpod_ltx_worker.py"
VIDEO_BACKEND_ROUTER_TEST_FILE="$ROOT/tests/test_video_backend_router.py"
REFERENCE_ASSETS_TEST_FILE="$ROOT/tests/test_reference_assets.py"
REFERENCE_ASSET_BUNDLES_TEST_FILE="$ROOT/tests/test_reference_asset_bundles.py"
OPENAI_IMAGE_CLIENT_TEST_FILE="$ROOT/tests/test_openai_image_client.py"
IMAGE_PROVIDER_ROUTER_TEST_FILE="$ROOT/tests/test_image_provider_router.py"

if [[ ! -x "$VENV_PY" ]]; then
  echo "missing project venv python: $VENV_PY" >&2
  exit 1
fi

"$VENV_PY" -m unittest "$TEST_FILE"
"$VENV_PY" -m unittest "$DECISION_TEST_FILE"
"$VENV_PY" -m unittest "$TOOLS_TEST_FILE"
"$VENV_PY" -m unittest "$REVIEW_TEST_FILE"
"$VENV_PY" -m unittest "$REPOSITORY_TEST_FILE"
"$VENV_PY" -m unittest "$RUNNER_TEST_FILE"
"$VENV_PY" -m unittest "$SHOW_RUN_TEST_FILE"
"$VENV_PY" -m unittest "$BENCHMARK_TEST_FILE"
"$VENV_PY" -m unittest "$IMAGE_PROMPT_TEMPLATE_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_CONTRACTS_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_TOOLS_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_NARRATIVE_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_PROMPT_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_HANDOFF_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_PLAN_REVIEW_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_MODEL_ROUTING_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_EVALS_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_ASSEMBLY_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_VOICE_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_TTS_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_POST_PASS_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_REVIEW_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_REPOSITORY_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_GRAPH_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_RUNNER_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_SMOKE_RUNNER_TEST_FILE"
"$VENV_PY" -m unittest "$PROD_SHOW_RUN_TEST_FILE"
"$VENV_PY" -m unittest "$FAL_SDK_ENV_TEST_FILE"
"$VENV_PY" -m unittest "$FAL_IMAGE_CLIENT_TEST_FILE"
"$VENV_PY" -m unittest "$VIDEO_GENERATION_ADAPTER_TEST_FILE"
"$VENV_PY" -m unittest "$RUNPOD_LTX_ADAPTER_TEST_FILE"
"$VENV_PY" -m unittest "$COMFY_LTX_ADAPTER_TEST_FILE"
"$VENV_PY" -m unittest "$RUNPOD_LTX_WORKER_TEST_FILE"
"$VENV_PY" -m unittest "$VIDEO_BACKEND_ROUTER_TEST_FILE"
"$VENV_PY" -m unittest "$REFERENCE_ASSETS_TEST_FILE"
"$VENV_PY" -m unittest "$REFERENCE_ASSET_BUNDLES_TEST_FILE"
"$VENV_PY" -m unittest "$OPENAI_IMAGE_CLIENT_TEST_FILE"
"$VENV_PY" -m unittest "$IMAGE_PROVIDER_ROUTER_TEST_FILE"
"$VENV_PY" -m py_compile \
  "$ROOT/creative/director/contracts.py" \
  "$ROOT/creative/director/decision_model.py" \
  "$ROOT/creative/director/tools.py" \
  "$ROOT/creative/director/prompt.py" \
  "$ROOT/creative/director/graph.py" \
  "$ROOT/scripts/run_creative_director.py" \
  "$TEST_FILE" \
  "$DECISION_TEST_FILE" \
  "$TOOLS_TEST_FILE" \
  "$ROOT/creative/director/review.py" \
  "$REVIEW_TEST_FILE" \
  "$ROOT/creative/director/repository.py" \
  "$REPOSITORY_TEST_FILE" \
  "$RUNNER_TEST_FILE" \
  "$ROOT/scripts/show_creative_director_run.py" \
  "$SHOW_RUN_TEST_FILE" \
  "$ROOT/scripts/run_creative_director_benchmark.py" \
  "$BENCHMARK_TEST_FILE" \
  "$ROOT/creative/image_factory/prompting.py" \
  "$IMAGE_PROMPT_TEMPLATE_TEST_FILE" \
  "$ROOT/creative/production/contracts.py" \
  "$ROOT/creative/production/tools.py" \
  "$ROOT/creative/production/narrative.py" \
  "$ROOT/creative/production/prompt.py" \
  "$ROOT/creative/production/handoff.py" \
  "$ROOT/creative/production/plan_review.py" \
  "$ROOT/creative/production/model_routing.py" \
  "$ROOT/creative/production/evals.py" \
  "$ROOT/creative/production/assembly.py" \
  "$ROOT/creative/production/voice.py" \
  "$ROOT/creative/production/tts.py" \
  "$ROOT/creative/production/post_pass.py" \
  "$ROOT/creative/production/review.py" \
  "$ROOT/creative/production/repository.py" \
  "$ROOT/creative/production/graph.py" \
  "$ROOT/scripts/run_creative_production.py" \
  "$ROOT/scripts/benchmark_runpod_ltx.py" \
  "$ROOT/scripts/benchmark_comfy_ltx.py" \
  "$ROOT/scripts/run_creative_production_smoke.py" \
  "$ROOT/scripts/show_creative_production_run.py" \
  "$ROOT/creative/image_factory/fal_client.py" \
  "$ROOT/creative/image_factory/openai_client.py" \
  "$ROOT/creative/image_factory/provider_router.py" \
  "$ROOT/creative/image_factory/assets.py" \
  "$ROOT/creative/video_factory/video_adapter.py" \
  "$ROOT/creative/video_factory/backend_router.py" \
  "$ROOT/creative/video_factory/runpod_ltx_adapter.py" \
  "$ROOT/creative/video_factory/comfy_ltx_adapter.py" \
  "$ROOT/workers/runpod_ltx_worker/worker.py" \
  "$ROOT/workers/runpod_ltx_worker/handler.py" \
  "$ROOT/creative/reference_assets/contracts.py" \
  "$ROOT/creative/reference_assets/resolver.py" \
  "$ROOT/creative/reference_assets/analyzer.py" \
  "$ROOT/creative/reference_assets/bundles.py" \
  "$PROD_CONTRACTS_TEST_FILE" \
  "$PROD_TOOLS_TEST_FILE" \
  "$PROD_NARRATIVE_TEST_FILE" \
  "$PROD_PROMPT_TEST_FILE" \
  "$PROD_HANDOFF_TEST_FILE" \
  "$PROD_PLAN_REVIEW_TEST_FILE" \
  "$PROD_MODEL_ROUTING_TEST_FILE" \
  "$PROD_EVALS_TEST_FILE" \
  "$PROD_ASSEMBLY_TEST_FILE" \
  "$PROD_VOICE_TEST_FILE" \
  "$PROD_TTS_TEST_FILE" \
  "$PROD_POST_PASS_TEST_FILE" \
  "$PROD_REVIEW_TEST_FILE" \
  "$PROD_REPOSITORY_TEST_FILE" \
  "$PROD_GRAPH_TEST_FILE" \
  "$PROD_RUNNER_TEST_FILE" \
  "$PROD_SMOKE_RUNNER_TEST_FILE" \
  "$PROD_SHOW_RUN_TEST_FILE" \
  "$FAL_SDK_ENV_TEST_FILE" \
  "$FAL_IMAGE_CLIENT_TEST_FILE" \
  "$VIDEO_GENERATION_ADAPTER_TEST_FILE" \
  "$RUNPOD_LTX_ADAPTER_TEST_FILE" \
  "$COMFY_LTX_ADAPTER_TEST_FILE" \
  "$RUNPOD_LTX_WORKER_TEST_FILE" \
  "$VIDEO_BACKEND_ROUTER_TEST_FILE" \
  "$REFERENCE_ASSETS_TEST_FILE" \
  "$REFERENCE_ASSET_BUNDLES_TEST_FILE" \
  "$OPENAI_IMAGE_CLIENT_TEST_FILE" \
  "$IMAGE_PROVIDER_ROUTER_TEST_FILE"

echo "creative director checks passed via $VENV_PY"
