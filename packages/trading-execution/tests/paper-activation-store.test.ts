import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  PAPER_ACTIVATION_EVENT_SCHEMA_VERSION,
  PAPER_ACTIVATION_REVIEW_SCHEMA_VERSION,
  type PaperActivationEvent,
  type PaperActivationReview,
} from '@trade-god/contracts'
import { FilePaperActivationStore, sha256 } from '../src/index.ts'

const NOW = '2026-08-11T15:00:00.000Z'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const review = (): PaperActivationReview => {
  const unsigned = {
    review_schema_version: PAPER_ACTIVATION_REVIEW_SCHEMA_VERSION,
    review_id: 'review-paper-one',
    adapter_set_checksum: 'a'.repeat(64),
    control_checksum: 'b'.repeat(64),
    connections: [],
    pending_intents: [],
    blockers: [],
    ready: true,
    created_at: NOW,
    expires_at: '2026-08-11T15:01:00.000Z',
    state_checksum: 'c'.repeat(64),
  }
  return { ...unsigned, content_checksum: sha256(unsigned) }
}

const event = (
  status: PaperActivationEvent['status'],
  eventId: string,
): PaperActivationEvent => {
  const source = review()
  const unsigned = {
    event_schema_version: PAPER_ACTIVATION_EVENT_SCHEMA_VERSION,
    event_id: eventId,
    release_id: 'release-paper-one',
    review_id: source.review_id,
    review_checksum: source.content_checksum,
    state_checksum: source.state_checksum,
    status,
    account_snapshots: [],
    intent_results: [],
    detail: `Activation ${status}.`,
    occurred_at: NOW,
  }
  return { ...unsigned, content_checksum: sha256(unsigned) }
}

describe('paper activation journal', () => {
  test('keeps reviews immutable and enforces the durable release sequence', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'paper-activation-store-'))
    roots.push(root)
    const store = new FilePaperActivationStore(root, () => NOW)
    await store.saveReview(review())
    await store.appendEvent(event('prepared', 'event-prepared-one'))
    expect((await store.listIncomplete()).map((entry) => entry.status)).toEqual(['prepared'])
    await store.appendEvent(event('dismissed', 'event-dismissed-one'))
    await store.appendEvent(event('released', 'event-released-one'))
    expect(await store.listIncomplete()).toEqual([])
    await expect(store.appendEvent(event('halted', 'event-halted-late')))
      .rejects.toThrow('transition is invalid')
  })

  test('rejects a checksum-valid file whose event chain was rewritten', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'paper-activation-chain-'))
    roots.push(root)
    const store = new FilePaperActivationStore(root, () => NOW)
    await store.saveReview(review())
    await store.appendEvent(event('prepared', 'event-prepared-one'))
    await store.appendEvent(event('dismissed', 'event-dismissed-one'))

    const file = path.join(root, 'paper-activation-journal.json')
    const raw = JSON.parse(await readFile(file, 'utf8'))
    const second = raw.events[1]
    const { content_checksum: _oldEventChecksum, ...unsignedEvent } = second
    unsignedEvent.status = 'released'
    raw.events[1] = { ...unsignedEvent, content_checksum: sha256(unsignedEvent) }
    const { content_checksum: _oldStoreChecksum, ...body } = raw
    raw.content_checksum = sha256(body)
    await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`)

    await expect(store.listEvents()).rejects.toThrow('invalid release event chain')
  })
})
