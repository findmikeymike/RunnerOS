import { afterEach, describe, expect, it } from 'bun:test'
import { TestAgent, createMockBackendConfig } from './test-utils.ts'
import { cleanupModeState, initializeModeState, setPermissionMode } from '../mode-manager.ts'

const SESSION_ID = 'test-session-id'
const OPTIONS = { plansFolderPath: '/tmp/plans', dataFolderPath: '/tmp/data' }
const SOURCE_BLOCK = '<sources>\nActive: none\n</sources>'

function makeBuilder() {
  return new TestAgent(createMockBackendConfig()).getPromptBuilder()
}

describe('PromptBuilder stable and volatile context split', () => {
  afterEach(() => cleanupModeState(SESSION_ID))

  it('preserves the existing combined order', () => {
    cleanupModeState(SESSION_ID)
    const builder = makeBuilder()
    expect(builder.buildContextParts(OPTIONS, SOURCE_BLOCK)).toEqual([
      ...builder.buildVolatileContextParts(OPTIONS, SOURCE_BLOCK),
      ...builder.buildStableContextParts(),
    ])
  })

  it('keeps changing state out of the stable prefix', () => {
    const builder = makeBuilder()
    const volatile = builder.buildVolatileContextParts(OPTIONS, SOURCE_BLOCK).join('\n')
    const stable = builder.buildStableContextParts().join('\n')
    expect(volatile).toContain('permissionMode:')
    expect(volatile).toContain(SOURCE_BLOCK)
    expect(volatile).not.toContain('<workspace_capabilities>')
    expect(stable).toContain('<workspace_capabilities>')
    expect(stable).not.toContain('permissionMode:')
  })

  it('consumes the one-shot mode signal only from the volatile builder', () => {
    initializeModeState(SESSION_ID, 'safe')
    setPermissionMode(SESSION_ID, 'allow-all', {
      changedBy: 'user',
      changedAt: '2026-08-14T10:00:00.000Z',
    })
    const builder = makeBuilder()
    expect(builder.buildStableContextParts().join('\n')).not.toContain('modeChangeUserSignal:')
    expect(builder.buildVolatileContextParts(OPTIONS, SOURCE_BLOCK).join('\n')).toContain('modeChangeUserSignal:')
    expect(builder.buildVolatileContextParts(OPTIONS, SOURCE_BLOCK).join('\n')).not.toContain('modeChangeUserSignal:')
  })
})
