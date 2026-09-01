import { describe, expect, it } from 'bun:test'
import { discoverOmniRouteModels } from './omniroute-model-discovery'

describe('discoverOmniRouteModels', () => {
  it('loads, normalizes, and deduplicates the OpenAI model catalog', async () => {
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://gateway.example.com/v1/models')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer inference-key')
      expect(init?.redirect).toBe('error')
      return new Response(JSON.stringify({
        data: [
          { id: 'auto/fast', name: 'Fast route', context_length: 128000, capabilities: { tool_calling: true }, pricing: { input: '0.1', output: 0.2 } },
          { id: 'auto/best', display_name: 'Best route', max_context_window_tokens: 1000000, capabilities: { reasoning: true } },
          { id: 'auto/fast', name: 'Duplicate' },
          { object: 'model' },
        ],
      }), { status: 200 })
    })

    await expect(discoverOmniRouteModels({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'inference-key',
      fetchImpl,
    })).resolves.toEqual([
      { id: 'auto/fast', name: 'Fast route', costInput: 0.1, costOutput: 0.2, contextWindow: 128000, reasoning: false },
      { id: 'auto/best', name: 'Best route', costInput: 0, costOutput: 0, contextWindow: 1000000, reasoning: true },
    ])
  })

  it('rejects remote HTTP, remote keyless use, redirects, and malformed catalogs', async () => {
    await expect(discoverOmniRouteModels({ baseUrl: 'http://gateway.example.com', apiKey: 'key' })).rejects.toThrow('must use HTTPS')
    await expect(discoverOmniRouteModels({ baseUrl: 'https://gateway.example.com', apiKey: '' })).rejects.toThrow('inference key is required')

    const redirectFetch = async () => new Response('', { status: 302 })
    await expect(discoverOmniRouteModels({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'key',
      fetchImpl: redirectFetch,
    })).rejects.toThrow('failed (302)')

    const malformedFetch = async () => new Response('{nope', { status: 200 })
    await expect(discoverOmniRouteModels({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'key',
      fetchImpl: malformedFetch,
    })).rejects.toThrow('invalid model catalog')
  })

  it('permits keyless loopback discovery', async () => {
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toBeUndefined()
      return new Response(JSON.stringify({ data: [{ id: 'auto' }] }), { status: 200 })
    })

    await expect(discoverOmniRouteModels({
      baseUrl: 'http://localhost:20128',
      apiKey: '',
      fetchImpl,
    })).resolves.toHaveLength(1)
  })

  it('rejects oversized catalogs before or while buffering the response', async () => {
    const declaredOversizeFetch = async () => new Response('{"data":[]}', {
      status: 200,
      headers: { 'content-length': '5000001' },
    })
    await expect(discoverOmniRouteModels({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'key',
      fetchImpl: declaredOversizeFetch,
    })).rejects.toThrow('too large')

    const streamedOversizeFetch = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3_000_000))
        controller.enqueue(new Uint8Array(2_000_001))
        controller.close()
      },
    }), { status: 200 })
    await expect(discoverOmniRouteModels({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'key',
      fetchImpl: streamedOversizeFetch,
    })).rejects.toThrow('too large')
  })

  it('caps untrusted model display names', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      data: [{ id: 'auto', name: `Model ${'x'.repeat(400)}` }],
    }), { status: 200 })

    const models = await discoverOmniRouteModels({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'key',
      fetchImpl,
    })
    expect(models[0].name.length).toBe(256)
  })
})
