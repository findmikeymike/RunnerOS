import { describe, expect, it } from 'bun:test'
import type { SessionToolContext } from '../context.ts'
import { handleGetSocialVariantSet, handleRecordSocialVariantResult } from './social-variants.ts'

function context(overrides: Partial<SessionToolContext> = {}): SessionToolContext {
  return {
    sessionId: 'session-editor',
    workspacePath: '/workspace',
    sourcesPath: '/workspace/sources',
    skillsPath: '/workspace/skills',
    plansFolderPath: '/workspace/plans',
    callbacks: { onPlanSubmitted() {}, onAuthRequest() {} },
    fs: {} as SessionToolContext['fs'],
    loadSourceConfig: () => null,
    ...overrides,
  }
}

describe('social variant session tools', () => {
  it('reads the bound durable set', async () => {
    const result = await handleGetSocialVariantSet(context({
      getSocialVariantSet: async ({ outputId }) => ({ ok: true, data: { id: outputId, revision: 2 } }),
    }), { outputId: '  variants-1 ' })

    expect(result.isError).toBe(false)
    expect(result.structuredContent).toEqual({ ok: true, data: { id: 'variants-1', revision: 2 } })
  })

  it('requires exactly one result outcome before calling the host', async () => {
    let calls = 0
    const ctx = context({
      recordSocialVariantResult: async () => {
        calls += 1
        return { ok: true }
      },
    })
    const base = {
      outputId: 'variants-1', expectedRevision: 1, sourceId: 'source-1', destinationIndex: 0,
      title: 'Cut', hook: 'Opening move', editorialMode: 'fast-cut', editorialIntent: 'New rhythm',
    }

    expect((await handleRecordSocialVariantResult(ctx, base)).isError).toBe(true)
    expect((await handleRecordSocialVariantResult(ctx, { ...base, filePath: '/workspace/a.mp4', failureReason: 'bad' })).isError).toBe(true)
    expect(calls).toBe(0)
  })

  it('normalizes a valid incremental result', async () => {
    let captured: unknown
    const result = await handleRecordSocialVariantResult(context({
      recordSocialVariantResult: async (input) => {
        captured = input
        return { ok: true, data: { revision: 2 } }
      },
    }), {
      outputId: ' variants-1 ', expectedRevision: 1, sourceId: ' source-1 ', destinationIndex: 0,
      title: ' Cut ', hook: ' Hook ', editorialMode: ' Mode ', editorialIntent: ' Intent ',
      filePath: ' /workspace/a.mp4 ',
    })

    expect(result.isError).toBe(false)
    expect(captured).toMatchObject({ outputId: 'variants-1', sourceId: 'source-1', filePath: '/workspace/a.mp4' })
  })
})
