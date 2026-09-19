import { expect, test } from 'bun:test'
import { isQuietBuilderReview } from './quiet-builder-review'

test('only a final Builder no-op is quiet; useful results and other workers still notify', () => {
  const base = { spawnedFromAgent: { agentSlug: 'builder' }, messages: [{ role: 'assistant', content: 'NO_USEFUL_CAPABILITY' }] }
  expect(isQuietBuilderReview(base)).toBe(true)
  expect(isQuietBuilderReview({ ...base, spawnedFromAgent: { agentSlug: 'signal-analyst-agent' } })).toBe(false)
  expect(isQuietBuilderReview({ ...base, messages: [{ role: 'assistant', content: 'I propose a playlist curator.' }] })).toBe(false)
  expect(isQuietBuilderReview({ ...base, messages: [{ role: 'assistant', content: 'NO_USEFUL_CAPABILITY', isIntermediate: true }] })).toBe(false)
  expect(isQuietBuilderReview({ ...base, messages: [{ role: 'user', content: 'NO_USEFUL_CAPABILITY' }] })).toBe(false)
  expect(isQuietBuilderReview({ ...base, messages: [{ role: 'assistant', content: 'NO_USEFUL_CAPABILITY\n\nExisting workers already cover the supplied intel. No Output created.' }] })).toBe(true)
  expect(isQuietBuilderReview({ ...base, messages: [{ role: 'assistant', content: 'NO_USEFUL_CAPABILITY\r\nExisting skills cover this.' }] })).toBe(true)
  expect(isQuietBuilderReview({ ...base, messages: [{ role: 'assistant', content: 'Last time: NO_USEFUL_CAPABILITY. Today I propose a useful skill.' }] })).toBe(false)
  expect(isQuietBuilderReview({ ...base, messages: [{ role: 'assistant', content: 'NO_USEFUL_CAPABILITY is the status for an empty review, but this review has a proposal.' }] })).toBe(false)
})
