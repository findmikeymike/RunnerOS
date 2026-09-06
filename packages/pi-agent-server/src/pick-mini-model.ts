import type { ModelRegistry as PiModelRegistry } from '@earendil-works/pi-coding-agent';
import { resolvePiModel, isDeniedMiniModelId } from './model-resolution.ts';
import { PI_MINI_PREFERRED_DEFAULTS, PI_PREFERRED_DEFAULTS } from '../../shared/src/config/llm-connections.ts';

/**
 * Pick an auth-provider-appropriate default mini model.
 *
 * `getDefaultSummarizationModel()` returns `claude-haiku-4-5`, which only resolves
 * under `anthropic` auth. For `openai` / `openai-codex` / `google` /
 * `github-copilot` / `amazon-bedrock` we need a model from that provider's
 * preferred list — otherwise the ephemeral session ends up with no explicit
 * model and Pi SDK's internal default (post-0.70.0 an openai model) is used,
 * surfacing as a misleading "No API key found for openai" error when the user
 * is authenticated under a different provider.
 *
 * Candidates come from `PI_MINI_PREFERRED_DEFAULTS[authProvider]`, which is
 * ordered cheapest-first, and fall back to `PI_PREFERRED_DEFAULTS[authProvider]`
 * for any provider without a mini list. That fallback matters: this helper used
 * to read the chat list only, so it returned whatever a *new connection* should
 * chat with — the flagship. On Codex that meant Sol writing chat titles at five
 * times Luna's price. The work reaching this path is short utility work, so the
 * cheapest model that resolves is the right answer, not the most capable one.
 *
 * The first candidate that is neither denied by `isDeniedMiniModelId` nor
 * unresolvable via `resolvePiModel` wins.
 *
 * Returns `undefined` when there is no resolvable candidate; callers should
 * fall back to `getDefaultSummarizationModel()` in that case.
 */
export function pickProviderAppropriateMiniModel(
  authProvider: string,
  modelRegistry: PiModelRegistry,
  preferCustomEndpoint: boolean,
): string | undefined {
  const preferred = PI_MINI_PREFERRED_DEFAULTS[authProvider] ?? PI_PREFERRED_DEFAULTS[authProvider];
  if (!preferred || preferred.length === 0) return undefined;
  for (const candidate of preferred) {
    if (isDeniedMiniModelId(candidate, authProvider)) continue;
    const resolved = resolvePiModel(modelRegistry, candidate, authProvider, preferCustomEndpoint);
    if (resolved) return candidate;
  }
  return undefined;
}
