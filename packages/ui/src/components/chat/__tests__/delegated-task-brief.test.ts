import { describe, expect, it } from 'bun:test'
import { isDelegatedAgentPrompt, parseDelegatedTaskBrief } from '../DelegatedTaskBrief'

const prompt = [
  'You are executing a delegated RunnerOS agent message.',
  '',
  'Delegating agent: session',
  'Target agent: critic',
  'Parent session ID: parent-1',
  '',
  'If you need to send an important progress update, use send_agent_message.',
  'Still return the requested final result in this delegated session.',
  '',
  'Task:',
  'Review the campaign and identify its strongest idea.',
  '',
  'Context:',
  'The release is scheduled for Friday.',
  '',
  'Expected output:',
  'A concise recommendation.',
  '',
  'Allowed source slugs: artist-profile',
  '',
  'Return only the requested result. Do not ask follow-up questions.',
].join('\n')

describe('delegated task brief', () => {
  it('extracts only user-relevant task information', () => {
    expect(parseDelegatedTaskBrief(prompt)).toEqual({
      task: 'Review the campaign and identify its strongest idea.',
      context: 'The release is scheduled for Friday.',
      expectedOutput: 'A concise recommendation.',
    })
  })

  it('does not classify ordinary user messages as delegated prompts', () => {
    expect(isDelegatedAgentPrompt('Review this campaign.')).toBe(false)
    expect(parseDelegatedTaskBrief('Review this campaign.')).toBeNull()
  })
})
