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
    expect(first).toBe('v1:hq:art-director:release-assets')
  })

  test('keeps campaign intent isolated from HQ and other campaigns', () => {
    const hq = hqIntentFingerprint({ scope: { type: 'hq' }, title: 'Weekly research report' })
    const campaignA = hqIntentFingerprint({ scope: { type: 'campaign', campaignId: 'a' }, title: 'Weekly research report' })
    const campaignB = hqIntentFingerprint({ scope: { type: 'campaign', campaignId: 'b' }, title: 'Weekly research report' })

    expect(new Set([hq, campaignA, campaignB]).size).toBe(3)
  })
})
