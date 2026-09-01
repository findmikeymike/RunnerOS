/**
 * Tests for browser_tool resilience:
 *  - stale `@eN` refs auto-recover by re-snapshotting and retrying once
 *  - a page the accessibility tree cannot describe returns a screenshot so the
 *    model can fall back to visual targeting instead of an unusable ref list
 *
 * Both paths previously returned a text dead end that the model had to reason
 * its way out of unaided.
 */

import { describe, it, expect } from 'bun:test'
import { executeBrowserToolCommand } from '../browser-tool-runtime'
import type { BrowserPaneFns } from '../browser-tools'

type Overrides = Partial<BrowserPaneFns>

function createFns(overrides: Overrides = {}): BrowserPaneFns {
  const base = {
    snapshot: async () => ({
      url: 'https://example.com',
      title: 'Example',
      nodes: [
        { ref: '@e1', role: 'button', name: 'Post' },
        { ref: '@e2', role: 'textbox', name: 'Caption' },
        { ref: '@e3', role: 'link', name: 'Home' },
      ],
    }),
    click: async (_ref: string) => {},
    fill: async (_ref: string, _value: string) => {},
    screenshot: async () => ({ imageBuffer: Buffer.from('img'), imageFormat: 'jpeg' as const }),
    detectChallenge: async () => ({ detected: false, provider: 'none', signals: [] }),
    releaseControl: async () => {},
  }
  return { ...base, ...overrides } as unknown as BrowserPaneFns
}

const run = (command: string | string[], fns: BrowserPaneFns) =>
  executeBrowserToolCommand({ command, fns, sessionId: 'test-session' })

describe('stale element ref recovery', () => {
  it('re-snapshots and retries once when a ref goes stale, then succeeds', async () => {
    let clickAttempts = 0
    let snapshots = 0
    const fns = createFns({
      snapshot: async () => {
        snapshots += 1
        return {
          url: 'https://example.com',
          title: 'Example',
          nodes: [{ ref: '@e1', role: 'button', name: 'Post' }],
        }
      },
      click: async (_ref: string) => {
        clickAttempts += 1
        if (clickAttempts === 1) throw new Error('Element @e1 not found. Run browser_snapshot first to get current element refs.')
      },
    } as Overrides)

    const result = await run('click @e1', fns)

    expect(clickAttempts).toBe(2)
    expect(snapshots).toBe(1)
    expect(result.output).toContain('re-snapshotted and retried')
  })

  it('retries at most once and returns a screenshot when the ref stays stale', async () => {
    let clickAttempts = 0
    const fns = createFns({
      click: async (_ref: string) => {
        clickAttempts += 1
        throw new Error('Element @e9 not found. Run browser_snapshot first to get current element refs.')
      },
    } as Overrides)

    const result = await run('click @e9', fns)

    // Bounded: original attempt + exactly one retry. No infinite loop.
    expect(clickAttempts).toBe(2)
    expect(result.image).toBeDefined()
    expect(result.image?.mimeType).toBe('image/jpeg')
    expect(result.output).toContain('click-at')
  })

  it('recovers stale refs for fill as well as click', async () => {
    let fillAttempts = 0
    const fns = createFns({
      fill: async (_ref: string, _value: string) => {
        fillAttempts += 1
        if (fillAttempts === 1) throw new Error('Element @e2 not found. Run browser_snapshot first to get current element refs.')
      },
    } as Overrides)

    const result = await run('fill @e2 hello', fns)

    expect(fillAttempts).toBe(2)
    expect(result.output).toContain('re-snapshotted and retried')
  })

  it('does not retry errors that are not stale-ref errors', async () => {
    let clickAttempts = 0
    const fns = createFns({
      click: async () => {
        clickAttempts += 1
        throw new Error('Navigation timeout after 30000ms')
      },
    } as Overrides)

    await expect(run('click @e1', fns)).rejects.toThrow('Navigation timeout')
    expect(clickAttempts).toBe(1)
  })

  it('surfaces the original error when the recovery snapshot itself fails', async () => {
    const fns = createFns({
      snapshot: async () => { throw new Error('page crashed') },
      click: async () => { throw new Error('Element @e1 not found. Run browser_snapshot first to get current element refs.') },
    } as Overrides)

    // The original stale-ref error is more actionable than the snapshot failure.
    await expect(run('click @e1', fns)).rejects.toThrow('Element @e1 not found')
  })
})

describe('visual fallback on an undescribable page', () => {
  it('attaches a screenshot when the accessibility tree is near-empty and it is not a challenge', async () => {
    const fns = createFns({
      snapshot: async () => ({ url: 'https://canvas.example', title: 'Canvas App', nodes: [] }),
      detectChallenge: async () => ({ detected: false, provider: 'none', signals: [] }),
    } as Overrides)

    const result = await run('snapshot', fns)

    expect(result.image).toBeDefined()
    expect(result.output).toContain('No accessibility elements were detected')
    expect(result.output).toContain('click-at')
  })

  it('does not attach a screenshot when the tree describes the page normally', async () => {
    const result = await run('snapshot', createFns())
    expect(result.image).toBeUndefined()
  })

  it('still returns the snapshot text when screenshot capture fails', async () => {
    const fns = createFns({
      snapshot: async () => ({ url: 'https://canvas.example', title: 'Canvas App', nodes: [] }),
      screenshot: async () => { throw new Error('capture failed') },
    } as Overrides)

    const result = await run('snapshot', fns)

    // Best-effort: a screenshot failure must not mask the underlying result.
    expect(result.image).toBeUndefined()
    expect(result.output).toContain('No accessibility elements were detected')
  })
})
