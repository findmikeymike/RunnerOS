import { expect, test } from 'bun:test'
import { isQuietBuilderReview } from './quiet-builder-review'

test('only a final Builder no-op is quiet; useful results and other workers still notify', () => {
  const base = { spawnedFromAgent: { agentSlug: 'builder' }, messages: [{ role: 'assistant', content: 'NO_USEFUL_CAPABILITY' }] }
  expect(isQuietBuilderReview(base)).toBe(true)
  expect(isQuietBuilderReview({ ...base, spawnedFromAgent: { agentSlug: 'signal-analyst-agent' } })).toBe(false)
  expect(isQuietBuilderReview({ ...base, messages: [{ role: 'assistant', content: 'I propose a playlist curator.' }] })).toBe(false)
  expect(isQuietBuilderReview({ ...base, messages: [{ role: 'assistant', content: 'NO_USEFUL_CAPABILITY', isIntermediate: true }] })).toBe(false)
  expect(isQuietBuilderReview({ ...base, messages: [{ role: 'user', content: 'NO_USEFUL_CAPABILITY' }] })).toBe(false)
})
