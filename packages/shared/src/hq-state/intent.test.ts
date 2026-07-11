import { describe, expect, test } from 'bun:test'
import { hqIntentFingerprint } from './intent'

describe('HQ intent fingerprints', () => {
  test('normalizes equivalent release-asset intent across different wording', () => {
    const first = hqIntentFingerprint({
      scope: { type: 'hq' },
      worker: 'art-director',
      title: 'Close asset gaps before the single release',
      intent: 'Create the missing cover art.',
    })
    const second = hqIntentFingerprint({
      scope: { type: 'hq' },
      worker: 'art-director',
      title: 'Finish release artwork',
    })

    expect(first).toBe(second)
    expect(first).toBe('v1:hq:art-director:cover-art')
  })

  test('does not collapse different release deliverables into one intent', () => {
    const cover = hqIntentFingerprint({ scope: { type: 'hq' }, worker: 'art-director', title: 'Finish cover art' })
    const photo = hqIntentFingerprint({ scope: { type: 'hq' }, worker: 'art-director', title: 'Select press photo' })
    const master = hqIntentFingerprint({ scope: { type: 'hq' }, worker: 'art-director', title: 'Deliver final master' })

    expect(new Set([cover, photo, master]).size).toBe(3)
  })

  test('keeps campaign intent isolated from HQ and other campaigns', () => {
    const hq = hqIntentFingerprint({ scope: { type: 'hq' }, title: 'Weekly research report' })
    const campaignA = hqIntentFingerprint({ scope: { type: 'campaign', campaignId: 'a' }, title: 'Weekly research report' })
    const campaignB = hqIntentFingerprint({ scope: { type: 'campaign', campaignId: 'b' }, title: 'Weekly research report' })

    expect(new Set([hq, campaignA, campaignB]).size).toBe(3)
  })

  test('keeps canonical V2 intent stable when ownership changes', () => {
    const base = { scope: { type: 'hq' as const }, title: 'Create cover art', semanticIntentId: 'cover-art' }
    expect(hqIntentFingerprint({ ...base, worker: 'art-director' })).toBe(hqIntentFingerprint({ ...base, worker: 'backup-designer' }))
  })
})
