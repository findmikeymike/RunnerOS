import type { ProsodyLookupRequest } from '../shared/types'

export const MAX_RHYMES = 18

/** The local dictionary matches the final word, not a whole selected phrase. */
export function buildProsodyQuery(input: ProsodyLookupRequest) {
  const selection = String(input?.selection ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const line = String(input?.line ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
  const words = selection.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []
  const target = (words.at(-1) ?? '').toLowerCase()
  return {
    selection, line, target,
    // Match the stressed ending; total syllables are not a rhyme requirement.
    args: ['rhymes', target, '--type', 'all', '--max', String(MAX_RHYMES), '--json'],
  }
}
