import { expect, test } from 'bun:test'
import { agentTaskModeSelectionError } from './agent-task-mode-selection'
import { STARTER_AGENTS } from '@craft-agent/shared/agent-definitions/starter-templates'

test('scheduled specialists require an explicit current focus; Manager stays optional', () => {
  const artist = STARTER_AGENTS.find(agent => agent.slug === 'art-director')!
  expect(agentTaskModeSelectionError(artist)).toContain('Choose a focus')
  expect(agentTaskModeSelectionError(artist, 'cover-art')).toBeUndefined()
  expect(agentTaskModeSelectionError(artist, 'ideas')).toContain('no longer available')
  const manager = STARTER_AGENTS.find(agent => agent.slug === 'concierge')!
  expect(agentTaskModeSelectionError(manager)).toBeUndefined()
  const narrow = STARTER_AGENTS.find(agent => agent.slug === 'comms-agent')!
  expect(agentTaskModeSelectionError(narrow)).toBeUndefined()
})
