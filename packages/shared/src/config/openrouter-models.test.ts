import { describe, expect, it } from 'bun:test';
import {
  fetchOpenRouterModels,
  openRouterModelToDefinition,
  parseOpenRouterModels,
} from './openrouter-models.ts';

const LIVE_SHAPED_PAYLOAD = {
  data: [
    {
      id: 'z-ai/glm-5.3-flash',
      name: 'Z.ai: GLM 5.3 Flash',
      description: 'Fast GLM model',
      context_length: 1_310_720,
      pricing: { prompt: '0.000000075', completion: '0.00000025' },
      supported_parameters: ['tools', 'reasoning_effort'],
      architecture: {
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
      },
    },
    {
      id: 'image-only/model',
      name: 'Image only',
      architecture: { output_modalities: ['image'] },
    },
  ],
};

describe('OpenRouter live model discovery', () => {
  it('normalizes current models and filters non-text outputs', () => {
    expect(parseOpenRouterModels(LIVE_SHAPED_PAYLOAD)).toEqual([{
      id: 'z-ai/glm-5.3-flash',
      name: 'Z.ai: GLM 5.3 Flash',
      description: 'Fast GLM model',
      contextWindow: 1_310_720,
      costInput: 0.075,
      costOutput: 0.25,
      reasoning: true,
      supportsImages: true,
    }]);
  });

  it('creates a runtime-capable persisted Pi model definition', () => {
    const [model] = parseOpenRouterModels(LIVE_SHAPED_PAYLOAD);
    expect(openRouterModelToDefinition(model!)).toEqual({
      id: 'pi/z-ai/glm-5.3-flash',
      name: 'Z.ai: GLM 5.3 Flash',
      shortName: 'Z.ai: GLM 5.3 Flash',
      description: 'Fast GLM model',
      provider: 'pi',
      contextWindow: 1_310_720,
      supportsThinking: true,
      supportsImages: true,
    });
  });

  it('fetches without requiring or sending an API key', async () => {
    let receivedHeaders: RequestInit['headers'];
    const models = await fetchOpenRouterModels({
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        receivedHeaders = init?.headers;
        return new Response(JSON.stringify(LIVE_SHAPED_PAYLOAD), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch,
    });

    expect(models[0]?.id).toBe('z-ai/glm-5.3-flash');
    expect(new Headers(receivedHeaders).has('Authorization')).toBe(false);
  });

  it('rejects malformed empty responses so callers can use their offline fallback', async () => {
    await expect(fetchOpenRouterModels({
      fetchImpl: (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch,
    })).rejects.toThrow('no usable text models');
  });
});
