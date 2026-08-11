import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { FileExecutionStore } from '../src/store.ts'

const NOW = '2026-08-11T15:05:00.000Z'
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const lease = (key: string, intentId: string) => ({
  ownership_key: key,
  intent_id: intentId,
  connection_id: `connection-${intentId}`,
  provider_account_key: `account-${key}`,
  instrument_id: 'CME:ESU6',
})

describe('execution ownership set', () => {
  test('does not leave a partial set when any requested account is already owned', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'execution-ownership-'))
    roots.push(root)
    const store = new FileExecutionStore(root, () => NOW)
    await store.acquireOwnership(lease('ownership-b', 'old-owner'))

    await expect(store.acquireOwnershipSet([
      lease('ownership-a', 'new-a'),
      lease('ownership-b', 'new-b'),
    ])).rejects.toMatchObject({ code: 'EXECUTION_BUSY' })

    expect(await store.readOwnership('ownership-a')).toBeNull()
    expect(await store.readOwnership('ownership-b')).toMatchObject({ intent_id: 'old-owner' })
  })

  test('allows only one overlapping set across independent store instances', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'execution-ownership-'))
    roots.push(root)
    const left = new FileExecutionStore(root, () => NOW)
    const right = new FileExecutionStore(root, () => NOW)
    const outcomes = await Promise.allSettled([
      left.acquireOwnershipSet([
        lease('ownership-a', 'left-a'),
        lease('ownership-b', 'left-b'),
      ]),
      right.acquireOwnershipSet([
        lease('ownership-b', 'right-b'),
        lease('ownership-c', 'right-c'),
      ]),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    const owners = await Promise.all([
      left.readOwnership('ownership-a'),
      left.readOwnership('ownership-b'),
      left.readOwnership('ownership-c'),
    ])
    expect(owners.filter(Boolean)).toHaveLength(2)
    expect(new Set(owners.filter(Boolean).map((owner) => owner!.intent_id.startsWith('left'))).size).toBe(1)
  })
})
