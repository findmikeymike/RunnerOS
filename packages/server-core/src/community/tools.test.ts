import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listCommunityContacts,
  readEmailJob,
  suppressCommunityContact,
  upsertCommunityContact,
} from '@craft-agent/shared/community'
import { CommunityToolService, settleEmailJobOutput } from './CommunityToolService'
import { listOutputManifests } from '@craft-agent/shared/outputs'

const MACHINE = 'machine-1'
const NOW = new Date('2026-09-15T12:00:00.000Z')

function workspace(fans: Array<{
  email: string
  name?: string
  city?: string
  segment?: 'vip' | 'local' | 'buyers' | 'street-team' | 'general'
  consent?: 'opted-in' | 'unknown'
  tags?: string[]
}> = []): string {
  const root = mkdtempSync(join(tmpdir(), 'community-tools-'))
  for (const fan of fans) {
    upsertCommunityContact(root, MACHINE, {
      email: fan.email,
      name: fan.name,
      city: fan.city,
      segment: fan.segment ?? 'general',
      tags: fan.tags,
      consentStatus: fan.consent ?? 'opted-in',
    })
  }
  return root
}

const tools = new CommunityToolService()

describe('reading the list without leaking it', () => {
  test('addresses are withheld by default', () => {
    const root = workspace([{ email: 'fan@example.com', name: 'Fan One', city: 'Denver' }])
    try {
      const result = tools.listContacts(root, {}, NOW)

      expect(result.ok).toBe(true)
      expect(result.addressesIncluded).toBe(false)
      // Choosing an audience never needs the address.
      expect(JSON.stringify(result)).not.toContain('fan@example.com')
      const contacts = result.contacts as Array<{ name?: string; city?: string }>
      expect(contacts[0]).toMatchObject({ name: 'Fan One', city: 'Denver' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a personal-email lookup returns addresses but is capped hard', () => {
    const fans = Array.from({ length: 40 }, (_, index) => ({ email: `fan${index}@example.com` }))
    const root = workspace(fans)
    try {
      const result = tools.listContacts(root, { forPersonalEmail: true, limit: 200 }, NOW)

      expect(result.addressesIncluded).toBe(true)
      // A one-to-one path must not become a way to dump the whole list.
      expect(result.returned).toBe(10)
      expect((result.contacts as Array<{ email?: string }>)[0]!.email).toContain('@example.com')
      expect(String(result.note)).toContain('Do not paste them into a broadcast')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('filtering by city is how a show reaches the right people', () => {
    const root = workspace([
      { email: 'a@example.com', city: 'Denver' },
      { email: 'b@example.com', city: 'Austin' },
      { email: 'c@example.com', city: 'denver' },
    ])
    try {
      const result = tools.listContacts(root, { city: 'Denver' }, NOW)
      expect(result.total).toBe(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('filters combine and a tag narrows the list', () => {
    const root = workspace([
      { email: 'a@example.com', segment: 'vip', tags: ['street-team'] },
      { email: 'b@example.com', segment: 'vip' },
      { email: 'c@example.com', segment: 'general', tags: ['street-team'] },
    ])
    try {
      expect(tools.listContacts(root, { segment: 'vip' }, NOW).total).toBe(2)
      expect(tools.listContacts(root, { tag: 'street-team' }, NOW).total).toBe(2)
      expect(tools.listContacts(root, { segment: 'vip', tag: 'street-team' }, NOW).total).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('list health', () => {
  test('an empty list says nothing has ever been sent', () => {
    const root = workspace()
    try {
      const stats = tools.stats(root, NOW)
      expect(stats.total).toBe(0)
      expect(stats.cadenceNote).toBe('Nothing has ever been sent to this list.')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('only opted-in fans count as reachable', () => {
    const root = workspace([
      { email: 'in@example.com', consent: 'opted-in' },
      { email: 'maybe@example.com', consent: 'unknown' },
    ])
    try {
      const stats = tools.stats(root, NOW)
      expect(stats.total).toBe(2)
      expect(stats.reachable).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('suppressed fans are counted separately', () => {
    const root = workspace([{ email: 'gone@example.com' }])
    try {
      suppressCommunityContact(root, MACHINE, 'gone@example.com', 'unsubscribed')
      expect(tools.stats(root, NOW).suppressed).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('drafting', () => {
  test('a draft reports who it reaches and does not send', () => {
    const root = workspace([
      { email: 'a@example.com', segment: 'general' },
      { email: 'b@example.com', segment: 'general' },
    ])
    try {
      const result = tools.draftEmail(root, MACHINE, {
        title: 'Two Colorado nights',
        subject: 'Two Colorado nights',
        bodyMarkdown: 'We added two shows.',
        segmentIds: ['general'],
      })

      expect(result.ok).toBe(true)
      const audience = result.audience as { recipients: number }
      expect(audience.recipients).toBe(2)

      const job = readEmailJob(root, String(result.jobId))!
      // Drafting must never be a send.
      expect(job.status).toBe('draft')
      expect(job.send?.sentCount).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a draft with no subject or body is refused', () => {
    const root = workspace([{ email: 'a@example.com' }])
    try {
      const result = tools.draftEmail(root, MACHINE, {
        title: 'Empty',
        subject: '',
        bodyMarkdown: 'Body',
        segmentIds: ['general'],
      })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('subject and a body')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a draft with no audience is refused rather than reaching nobody', () => {
    const root = workspace([{ email: 'a@example.com' }])
    try {
      const result = tools.draftEmail(root, MACHINE, {
        title: 'To nobody',
        subject: 'Hello',
        bodyMarkdown: 'Anyone?',
        segmentIds: [],
      })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('reaches nobody')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a segment with nobody in it drafts but says it cannot be approved', () => {
    const root = workspace([{ email: 'a@example.com', segment: 'general' }])
    try {
      const result = tools.draftEmail(root, MACHINE, {
        title: 'VIPs only',
        subject: 'Early listen',
        bodyMarkdown: 'For you first.',
        segmentIds: ['vip'],
      })
      expect(result.ok).toBe(true)
      expect(String(result.note)).toContain('cannot be approved')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('asking to send', () => {
  test('a ready draft returns what the artist needs and sends nothing', () => {
    const root = workspace([{ email: 'a@example.com', segment: 'general' }])
    try {
      const draft = tools.draftEmail(root, MACHINE, {
        title: 'Note',
        subject: 'A quick note',
        bodyMarkdown: 'Hello there.',
        segmentIds: ['general'],
      })
      const result = tools.requestSend(root, String(draft.jobId))

      expect(result.ok).toBe(true)
      expect(result.needsApproval).toBe(true)
      expect(result.recipients).toBe(1)
      expect(String(result.note)).toContain('do not try to send it yourself')
      // Still a draft. Asking is not sending.
      expect(readEmailJob(root, String(draft.jobId))!.status).toBe('draft')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('an incomplete draft cannot even be offered to the artist', () => {
    const root = workspace([{ email: 'a@example.com', segment: 'general' }])
    try {
      const draft = tools.draftEmail(root, MACHINE, {
        title: 'Empty audience',
        subject: 'Hello',
        bodyMarkdown: 'Hi',
        segmentIds: ['vip'],
      })
      const result = tools.requestSend(root, String(draft.jobId))
      expect(result.ok).toBe(false)
      expect(result.failure).toBe('empty-audience')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('tagging', () => {
  test('tags are added and removed across contacts', () => {
    const root = workspace([
      { email: 'a@example.com', tags: ['old'] },
      { email: 'b@example.com' },
    ])
    try {
      const ids = listCommunityContacts(root).map(contact => contact.id)
      const result = tools.tagContacts(root, MACHINE, {
        contactIds: ids,
        addTags: ['denver-show'],
        removeTags: ['old'],
      })

      expect(result.updated).toBe(2)
      const after = listCommunityContacts(root)
      expect(after.every(contact => contact.tags.includes('denver-show'))).toBe(true)
      expect(after.some(contact => contact.tags.includes('old'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('unknown ids are counted rather than failing the whole call', () => {
    const root = workspace([{ email: 'a@example.com' }])
    try {
      const ids = listCommunityContacts(root).map(contact => contact.id)
      const result = tools.tagContacts(root, MACHINE, {
        contactIds: [...ids, 'does-not-exist'],
        addTags: ['x'],
      })
      expect(result.updated).toBe(1)
      expect(result.missing).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a call that changes nothing is refused', () => {
    const root = workspace([{ email: 'a@example.com' }])
    try {
      const result = tools.tagContacts(root, MACHINE, { contactIds: ['x'] })
      expect(result.ok).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('a draft is a real thing the artist can find', () => {
  test('drafting publishes an Output waiting for approval', () => {
    const root = workspace([{ email: 'a@example.com', segment: 'general' }])
    try {
      const result = tools.draftEmail(root, MACHINE, {
        title: 'Two nights',
        subject: 'Two Colorado nights',
        bodyMarkdown: 'We added two shows.',
        segmentIds: ['general'],
      }, { workspaceId: 'hq', agentSlug: 'community-agent' })

      expect(result.outputId).toBeTruthy()

      const output = listOutputManifests(root).find(item => item.id === result.outputId)!
      // Pending approval is what puts it in the approvals list and State of Play.
      expect(output.approval?.state).toBe('pending')
      expect(output.title).toBe('Two Colorado nights')
      expect(output.tags).toContain('fan-email')
      expect(output.summary).toContain('1 fan')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('settling the job stops the Output asking for attention', () => {
    const root = workspace([{ email: 'a@example.com', segment: 'general' }])
    try {
      const draft = tools.draftEmail(root, MACHINE, {
        title: 'Note',
        subject: 'A note',
        bodyMarkdown: 'Hello.',
        segmentIds: ['general'],
      }, { workspaceId: 'hq' })

      settleEmailJobOutput(root, String(draft.jobId), 'approved', 'Sent to the fan list.')

      const output = listOutputManifests(root).find(item => item.id === draft.outputId)!
      expect(output.approval?.state).toBe('approved')
      expect(output.status).toBe('published')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a discarded draft is marked as such rather than left pending', () => {
    const root = workspace([{ email: 'a@example.com', segment: 'general' }])
    try {
      const draft = tools.draftEmail(root, MACHINE, {
        title: 'Note',
        subject: 'A note',
        bodyMarkdown: 'Hello.',
        segmentIds: ['general'],
      }, { workspaceId: 'hq' })

      settleEmailJobOutput(root, String(draft.jobId), 'changes_requested', 'The artist discarded this draft.')
      expect(listOutputManifests(root).find(item => item.id === draft.outputId)!.approval?.state)
        .toBe('changes_requested')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('without a workspace the draft still succeeds, just unmirrored', () => {
    const root = workspace([{ email: 'a@example.com', segment: 'general' }])
    try {
      // The email itself is the real artifact; the Output is a convenience.
      const result = tools.draftEmail(root, MACHINE, {
        title: 'Note',
        subject: 'A note',
        bodyMarkdown: 'Hello.',
        segmentIds: ['general'],
      })
      expect(result.ok).toBe(true)
      expect(result.outputId).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
