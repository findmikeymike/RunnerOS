import { describe, expect, it } from 'bun:test'
import { teamAutomationExternalOperatorBlockReason } from '../core/pre-tool-use'

const policy = { enabled: true, automatedAncestry: true }

describe('Team automation external operator policy', () => {
  it.each([
    ['browser_tool', { command: 'snapshot; click @e1' }],
    ['Bash', { command: 'node scripts/cdp.mjs click ABC button.submit' }],
    ['Bash', { command: 'ACTION=click; node scripts/cdp.mjs "$ACTION" ABC button.submit' }],
    ['Bash', { command: 'node scripts/render-safe-artifact.mjs' }],
    ['mcp__chrome_devtools__click', { ref: 'submit' }],
    ['mcp__computer-use__type_text', { text: 'reply' }],
    ['Skill', { skill: 'chrome-cdp' }],
  ])('blocks automated mutation through %s', (toolName, toolInput) => {
    expect(teamAutomationExternalOperatorBlockReason({ toolName, toolInput, policy }))
      .toContain('Team Mode blocks automated external browser/operator mutations')
  })

  it('allows automated inspection and manual mutations', () => {
    expect(teamAutomationExternalOperatorBlockReason({
      toolName: 'browser_tool',
      toolInput: { command: 'snapshot' },
      policy,
    })).toBeNull()
    expect(teamAutomationExternalOperatorBlockReason({
      toolName: 'mcp__chrome_devtools__click',
      toolInput: { ref: 'submit' },
      policy: { enabled: true, automatedAncestry: false },
    })).toBeNull()
  })
})
