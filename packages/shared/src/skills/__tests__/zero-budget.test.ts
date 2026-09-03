import { afterEach, describe, expect, it } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const script = join(import.meta.dir, '..', 'bundled', 'zero', 'scripts', 'zero-budget.mjs')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function run(root: string, args: string[], extraEnv: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CRAFT_CONFIG_DIR: root, ...extraEnv },
  })
  return { status: result.status, body: JSON.parse(result.stdout) }
}

function fakeZero(root: string, paymentAmount = '0.10'): string {
  const executable = join(root, 'fake-zero.mjs')
  writeFileSync(executable, `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === 'get') {
  const slug = args[1]
  process.stdout.write(JSON.stringify({
    uid: 'cap_' + slug,
    slug,
    url: process.env.FAKE_ZERO_URL || 'https://trusted.example/' + slug,
    method: process.env.FAKE_ZERO_METHOD || 'GET',
  }))
} else {
  process.stdout.write(JSON.stringify({ ok: true, runId: 'run-1', payment: { amount: '${paymentAmount}', asset: 'USDC' } }))
}
`)
  chmodSync(executable, 0o700)
  return executable
}

function malformedZero(root: string): string {
  const executable = join(root, 'malformed-zero.mjs')
  writeFileSync(executable, `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === 'get') {
  const slug = args[1]
  process.stdout.write(JSON.stringify({ uid: 'cap_' + slug, slug, url: 'https://trusted.example/' + slug, method: 'GET' }))
} else {
  process.stdout.write('not-json')
}
`)
  chmodSync(executable, 0o700)
  return executable
}

describe('Zero weekly budget guard', () => {
  it('requires one configured weekly allowance and releases its lock on refusal', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-budget-'))
    roots.push(root)
    const result = run(root, ['fetch', '--capability', 'example', '--max-pay', '0.1', '--json'], { ZERO_CLI: fakeZero(root) })
    expect(result.status).toBe(2)
    expect(result.body.error).toContain('No weekly Zero allowance')
    expect(run(root, ['status', '--json']).status).toBe(0)
  })

  it('persists the allowance and blocks overspend before execution', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-budget-'))
    roots.push(root)
    expect(run(root, ['configure', '--weekly-limit', '0.25', '--json']).status).toBe(0)
    expect(run(root, ['status', '--json']).body).toMatchObject({ configured: true, weeklyLimitUsd: 0.25, remainingUsd: 0.25 })
    const blocked = run(root, ['fetch', '--capability', 'example', '--max-pay', '0.3', '--json'], { ZERO_CLI: fakeZero(root) })
    expect(blocked.status).toBe(3)
    expect(blocked.body).toMatchObject({ requestedMaxPayUsd: 0.3, remainingUsd: 0.25 })
  })

  it('allows GET retrieval automatically inside the weekly allowance', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-budget-'))
    roots.push(root)
    run(root, ['configure', '--weekly-limit', '1', '--json'])
    const result = run(root, ['fetch', '--capability', 'example', '--max-pay', '0.1', '--json'], { ZERO_CLI: fakeZero(root) })
    expect(result.status).toBe(0)
    expect(result.body.guard).toMatchObject({ chargedUsd: 0.1, remainingUsd: 0.9 })
  })

  it('settles the actual charge and exposes the remaining weekly balance', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-budget-'))
    roots.push(root)
    run(root, ['configure', '--weekly-limit', '0.25', '--json'])

    const result = run(
      root,
      ['fetch', '--capability', 'trusted-example', '--max-pay', '0.15', '--json'],
      { ZERO_CLI: fakeZero(root) },
    )

    expect(result.status).toBe(0)
    expect(result.body.guard).toMatchObject({ chargedUsd: 0.1, remainingUsd: 0.15, weeklyLimitUsd: 0.25 })
    expect(run(root, ['status', '--json']).body).toMatchObject({ spentUsd: 0.1, remainingUsd: 0.15, callsThisWeek: 1 })
  })

  it('conservatively charges the reservation when Zero omits usable payment metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-budget-'))
    roots.push(root)
    run(root, ['configure', '--weekly-limit', '0.25', '--json'])

    const result = run(
      root,
      ['fetch', '--capability', 'trusted-example', '--max-pay', '0.15', '--json'],
      { ZERO_CLI: malformedZero(root) },
    )

    expect(result.status).not.toBe(0)
    expect(result.body.guard).toMatchObject({ chargedUsd: 0.15, remainingUsd: 0.1, weeklyLimitUsd: 0.25 })
    expect(run(root, ['status', '--json']).body).toMatchObject({ spentUsd: 0.15, remainingUsd: 0.1, callsThisWeek: 1 })
  })

  it('uses one bounded authorization for a multi-call POST job', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-budget-'))
    roots.push(root)
    const zero = fakeZero(root, '0.05')
    run(root, ['configure', '--weekly-limit', '1', '--json'])
    const authorized = run(root, [
      'authorize', '--capability', 'send-campaign-email', '--method', 'POST', '--max-calls', '2',
      '--max-total-pay', '0.2', '--expires-in-hours', '24', '--purpose', 'Send two approved campaign emails', '--json',
    ], { ZERO_CLI: zero, FAKE_ZERO_METHOD: 'POST' })

    expect(authorized.status).toBe(0)
    const authorizationId = authorized.body.authorization.id as string

    for (const recipient of ['one@example.com', 'two@example.com']) {
      const result = run(root, [
        'fetch', '--capability', 'send-campaign-email', '--method', 'POST',
        '--data-json', JSON.stringify({ recipient }), '--max-pay', '0.1',
        '--authorization', authorizationId, '--json',
      ], { ZERO_CLI: zero, FAKE_ZERO_METHOD: 'POST' })
      expect(result.status).toBe(0)
    }

    const blocked = run(root, [
      'fetch', '--capability', 'send-campaign-email', '--method', 'POST',
      '--data-json', JSON.stringify({ recipient: 'three@example.com' }), '--max-pay', '0.1',
      '--authorization', authorizationId, '--json',
    ], { ZERO_CLI: zero, FAKE_ZERO_METHOD: 'POST' })
    expect(blocked.status).not.toBe(0)
    expect(blocked.body.error).toContain('call limit')
  })

  it('blocks non-GET work without authorization and rejects capability drift', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-budget-'))
    roots.push(root)
    const zero = fakeZero(root)
    run(root, ['configure', '--weekly-limit', '1', '--json'])

    const unapproved = run(root, [
      'fetch', '--capability', 'create-artifact', '--method', 'POST', '--data-json', '{}', '--max-pay', '0.1', '--json',
    ], { ZERO_CLI: zero, FAKE_ZERO_METHOD: 'POST' })
    expect(unapproved.status).not.toBe(0)
    expect(unapproved.body.error).toContain('authorization')

    const authorized = run(root, [
      'authorize', '--capability', 'create-artifact', '--method', 'POST', '--max-calls', '1',
      '--max-total-pay', '0.1', '--expires-in-hours', '1', '--purpose', 'Create one requested artifact', '--json',
    ], { ZERO_CLI: zero, FAKE_ZERO_METHOD: 'POST' })

    const drifted = run(root, [
      'fetch', '--capability', 'create-artifact', '--method', 'POST', '--data-json', '{}', '--max-pay', '0.1',
      '--authorization', authorized.body.authorization.id, '--json',
    ], { ZERO_CLI: zero, FAKE_ZERO_METHOD: 'POST', FAKE_ZERO_URL: 'https://changed.example/create-artifact' })
    expect(drifted.status).not.toBe(0)
    expect(drifted.body.error).toContain('changed since authorization')
  })

  it('never prunes charges from the current week', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-budget-'))
    roots.push(root)
    const stateDir = join(root, 'integrations', 'zero')
    mkdirSync(stateDir, { recursive: true })
    const createdAt = new Date().toISOString()
    writeFileSync(join(stateDir, 'spend-policy.json'), JSON.stringify({
      version: 2,
      weeklyLimitUsd: 10,
      updatedAt: createdAt,
      ledger: Array.from({ length: 501 }, (_, index) => ({
        id: `entry-${index}`, createdAt, status: 'settled', reservedUsd: 0.01, actualUsd: 0.01,
        capability: 'example', method: 'GET',
      })),
      authorizations: [],
    }))

    expect(run(root, ['configure', '--weekly-limit', '10', '--json']).body).toMatchObject({ callsThisWeek: 501, spentUsd: 5.01 })
  })

  it('fails closed when valid JSON contains a malformed ledger', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-budget-'))
    roots.push(root)
    const stateDir = join(root, 'integrations', 'zero')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(join(stateDir, 'spend-policy.json'), JSON.stringify({ version: 2, weeklyLimitUsd: 10, ledger: {} }))

    const result = run(root, ['status', '--json'])
    expect(result.status).not.toBe(0)
    expect(result.body.error).toContain('invalid')
  })

  it('rejects arbitrary URLs and unsupported options', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-budget-'))
    roots.push(root)
    run(root, ['configure', '--weekly-limit', '1', '--json'])

    expect(run(root, ['fetch', '--url', 'https://example.com', '--max-pay', '0.1', '--json']).body.error)
      .toContain('Unsupported option')
  })
})
