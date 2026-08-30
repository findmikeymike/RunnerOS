import { describe, expect, it } from 'bun:test'
import type { SessionToolContext } from '../context.ts'
import {
  handleGetAssetRecord,
  handlePromoteToReleaseKit,
  handleRemoveFromReleaseKit,
} from './release-kit.ts'

function context(overrides: Partial<SessionToolContext> = {}): SessionToolContext {
  return overrides as SessionToolContext
}

describe('Release Kit session tools', () => {
  it('rejects arbitrary upload paths by exposing only registered source types', async () => {
    let called = false
    const result = await handlePromoteToReleaseKit(context({
      promoteToReleaseKit: async () => {
        called = true
        return { ok: true }
      },
    }), {
      sourceType: 'campaign-asset',
      sourceId: '',
      category: 'audio',
      subtype: 'master',
    })
    expect(result.isError).toBe(true)
    expect(called).toBe(false)
  })

  it('requires the HQ workspace id for Vault access', async () => {
    const result = await handleGetAssetRecord(context(), {
      sourceType: 'vault-asset',
      assetId: 'vault_1',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain('vaultWorkspaceId')
  })

  it('normalizes trusted promotion ids and returns structured data', async () => {
    let received: unknown
    const result = await handlePromoteToReleaseKit(context({
      promoteToReleaseKit: async (input) => {
        received = input
        return { ok: true, data: { itemId: 'kit_1' } }
      },
    }), {
      campaignWorkspaceId: ' campaign-1 ',
      sourceType: 'output',
      sourceId: ' output-1 ',
      assetId: ' asset-1 ',
      category: 'artwork',
      subtype: ' cover art ',
      makePrimary: true,
    })
    expect(result.isError).toBe(false)
    expect(received).toEqual({
      campaignWorkspaceId: 'campaign-1',
      sourceType: 'output',
      sourceId: 'output-1',
      assetId: 'asset-1',
      vaultWorkspaceId: undefined,
      category: 'artwork',
      subtype: 'cover art',
      makePrimary: true,
      title: undefined,
      note: undefined,
    })
  })

  it('requires an exact asset id for Output promotion', async () => {
    let called = false
    const result = await handlePromoteToReleaseKit(context({
      promoteToReleaseKit: async () => {
        called = true
        return { ok: true }
      },
    }), {
      sourceType: 'output',
      sourceId: 'output-1',
      category: 'artwork',
      subtype: 'cover-art',
    })
    expect(result.isError).toBe(true)
    expect(called).toBe(false)
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain('assetId')
  })

  it('does not call removal without an exact item id', async () => {
    let called = false
    const result = await handleRemoveFromReleaseKit(context({
      removeFromReleaseKit: async () => {
        called = true
        return { ok: true }
      },
    }), { itemId: ' ' })
    expect(result.isError).toBe(true)
    expect(called).toBe(false)
  })
})
