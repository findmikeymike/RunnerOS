import type { ModelDefinition } from './models.ts';

export const OPENROUTER_API_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_MODELS_URL = `${OPENROUTER_API_BASE_URL}/models?output_modalities=text`;

type OpenRouterRawModel = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
  };
  supported_parameters?: unknown;
  architecture?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
};

export interface OpenRouterModelInfo {
  id: string;
  name: string;
  description: string;
  contextWindow: number;
  costInput: number;
  costOutput: number;
  reasoning: boolean;
  supportsImages: boolean;
}

export interface FetchOpenRouterModelsOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function finiteNonNegative(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** Convert OpenRouter's per-token prices to the per-million values shown in Artist OS. */
function perMillion(value: unknown): number {
  return finiteNonNegative(value) * 1_000_000;
}

export function parseOpenRouterModels(payload: unknown): OpenRouterModelInfo[] {
  const data = payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: OpenRouterRawModel[] }).data
    : [];

  const models: OpenRouterModelInfo[] = [];
  const seen = new Set<string>();

  for (const raw of data) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id.trim()) continue;
    const id = raw.id.trim();
    if (seen.has(id)) continue;

    const outputModalities = stringList(raw.architecture?.output_modalities);
    if (outputModalities.length > 0 && !outputModalities.includes('text')) continue;

    const supportedParameters = stringList(raw.supported_parameters);
    const inputModalities = stringList(raw.architecture?.input_modalities);
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;

    seen.add(id);
    models.push({
      id,
      name,
      description: typeof raw.description === 'string' ? raw.description : '',
      contextWindow: Math.max(1, Math.trunc(finiteNonNegative(raw.context_length, 131_072))),
      costInput: perMillion(raw.pricing?.prompt),
      costOutput: perMillion(raw.pricing?.completion),
      reasoning: supportedParameters.some(parameter => (
        parameter === 'reasoning'
        || parameter === 'reasoning_effort'
        || parameter === 'include_reasoning'
      )),
      supportsImages: inputModalities.includes('image'),
    });
  }

  return models.sort((a, b) => (
    b.costOutput - a.costOutput
    || b.costInput - a.costInput
    || a.name.localeCompare(b.name)
  ));
}

export async function fetchOpenRouterModels(
  options: FetchOpenRouterModelsOptions = {},
): Promise<OpenRouterModelInfo[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);

  try {
    const response = await fetchImpl(OPENROUTER_MODELS_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenRouter models API returned ${response.status}`);
    }
    const models = parseOpenRouterModels(await response.json());
    if (models.length === 0) throw new Error('OpenRouter models API returned no usable text models');
    return models;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error('OpenRouter models API timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function openRouterModelToDefinition(model: OpenRouterModelInfo): ModelDefinition {
  return {
    id: `pi/${model.id}`,
    name: model.name,
    shortName: model.name,
    description: model.description || 'OpenRouter model via Runner Backend',
    provider: 'pi',
    contextWindow: model.contextWindow,
    supportsThinking: model.reasoning,
    supportsImages: model.supportsImages,
  };
}

export async function fetchOpenRouterModelDefinitions(
  options: FetchOpenRouterModelsOptions = {},
): Promise<ModelDefinition[]> {
  return (await fetchOpenRouterModels(options)).map(openRouterModelToDefinition);
}
