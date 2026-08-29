import { describe, expect, it } from 'bun:test';
import type { LlmConnection } from '../../../../config/storage.ts';
import type { CoreBackendConfig } from '../../types.ts';
import { piDriver } from './pi.ts';

describe('Pi OpenRouter runtime', () => {
  it('registers saved OpenRouter selections as dynamic OpenAI-compatible models', () => {
    const connection = {
      slug: 'openrouter-test',
      name: 'OpenRouter',
      providerType: 'pi',
      authType: 'api_key',
      piAuthProvider: 'openrouter',
      defaultModel: 'pi/z-ai/glm-5.3-flash',
      models: [{
        id: 'pi/z-ai/glm-5.3-flash',
        name: 'Z.ai: GLM 5.3 Flash',
        shortName: 'GLM 5.3 Flash',
        description: '',
        provider: 'pi',
        contextWindow: 1_310_720,
        supportsImages: true,
      }],
      createdAt: Date.now(),
    } satisfies LlmConnection;

    const runtime = piDriver.buildRuntime({
      context: {
        connection,
        provider: 'pi',
        authType: 'api_key',
        resolvedModel: connection.defaultModel,
        capabilities: { needsHttpPoolServer: false },
      },
      coreConfig: {} as CoreBackendConfig,
      hostRuntime: { appRootPath: '/app', isPackaged: false },
      resolvedPaths: {},
      providerOptions: { piAuthProvider: 'openrouter' },
    });

    expect(runtime.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(runtime.customEndpoint).toEqual({ api: 'openai-completions' });
    expect(runtime.customModels).toEqual([{
      id: 'pi/z-ai/glm-5.3-flash',
      contextWindow: 1_310_720,
      supportsImages: true,
    }]);
  });
});
