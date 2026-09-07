import { afterEach, describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

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
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (args[0] === 'get') {
  const slug = args[1]
  process.stdout.write(JSON.stringify({
    uid: 'cap_' + slug,
    slug,
    url: process.env.FAKE_ZERO_URL || 'https://trusted.example/' + slug,
    method: process.env.FAKE_ZERO_METHOD || 'GET',
    availabilityStatus: process.env.FAKE_ZERO_HEALTH || 'healthy',
    displayCostAmount: process.env.FAKE_ZERO_PRICE || '0.01',
    displayCostAsset: process.env.FAKE_ZERO_ASSET || 'USDC',
    bodySchema: process.env.FAKE_ZERO_SCHEMA ? JSON.parse(process.env.FAKE_ZERO_SCHEMA) : undefined,
  }))
} else {
  if (process.env.FAKE_ZERO_LOG) appendFileSync(process.env.FAKE_ZERO_LOG, JSON.stringify(args) + '\\n')
  process.stdout.write(JSON.stringify({ ok: !process.env.FAKE_ZERO_FAIL, runId: 'run-1', payment: { amount: '${paymentAmount}', asset: 'USDC' } }))
  if (process.env.FAKE_ZERO_FAIL) process.exitCode = 1
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
  it.each(['same', 'endpoint', 'health', 'schema', 'price', 'asset', 'malformed', 'non-GET'])(
    'pins the preflight GET contract before spending: %s', (change) => {
      const root = mkdtempSync(join(tmpdir(), 'zero-contract-'))
      roots.push(root)
      const log = join(root, 'fetches.jsonl')
      const bodySchema = { properties: { input: { properties: { queryParams: {
        type: 'object', properties: { v: { type: 'string' } }, required: ['v'],
      } } } } }
      const contract = { uid: 'cap_transcript', slug: 'transcript', url: 'https://trusted.example/transcript', method: 'GET',
        availabilityStatus: 'healthy', displayCostAmount: '0.01', displayCostAsset: 'USDC', bodySchema }
      const expected = createHash('sha256').update(JSON.stringify(contract)).digest('hex')
      const env: Record<string, string> = { ZERO_CLI: fakeZero(root, '0.01'), FAKE_ZERO_LOG: log, FAKE_ZERO_SCHEMA: JSON.stringify(bodySchema) }
      if (change === 'endpoint') env.FAKE_ZERO_URL = 'https://changed.example/transcript'
      if (change === 'health') env.FAKE_ZERO_HEALTH = 'unhealthy'
      if (change === 'schema') env.FAKE_ZERO_SCHEMA = JSON.stringify({ ...bodySchema, description: 'Changed contract' })
      if (change === 'price') env.FAKE_ZERO_PRICE = '0.02'
      if (change === 'asset') env.FAKE_ZERO_ASSET = 'OTHER'
      if (change === 'non-GET') env.FAKE_ZERO_METHOD = 'POST'
      run(root, ['configure', '--weekly-limit', '0.02'])
      const result = run(root, ['fetch', '--capability', 'transcript', '--max-pay', '0.01', '--query-json', '{"v":"abcdefghijk"}',
        '--expected-read-contract', change === 'malformed' ? 'not-a-digest' : expected], env)
      if (change === 'same') {
        expect(result.status).toBe(0)
        expect(result.body.guard).toMatchObject({ chargedUsd: 0.01, remainingUsd: 0.01 })
        expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(1)
      } else {
        expect(result.status).not.toBe(0)
        expect(result.body.error).toContain(change === 'malformed' ? '64-character' : change === 'non-GET' ? 'only supported for GET' : 'changed since preflight')
        expect(existsSync(log)).toBe(false)
        expect(run(root, ['status']).body).toMatchObject({ spentUsd: 0, remainingUsd: 0.02, callsThisWeek: 0 })
      }
    },
  )

  const querySchema = {
    type: 'object', properties: {
      v: { type: 'string', minLength: 1, maxLength: 100 },
      lang: { type: 'string', enum: ['en', 'es'] },
      count: { type: 'integer', minimum: 1, maximum: 3 },
      ratio: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 },
      enabled: { type: 'boolean' },
    }, required: ['v'],
  }
  function queryFixture(schema: unknown = querySchema) {
    const root = mkdtempSync(join(tmpdir(), 'zero-query-'))
    roots.push(root)
    const log = join(root, 'fetches.jsonl')
    run(root, ['configure', '--weekly-limit', '0.02', '--json'])
    const env = { ZERO_CLI: fakeZero(root, '0.01'), FAKE_ZERO_LOG: log,
      FAKE_ZERO_URL: 'https://toolsmith-api.dassad10.workers.dev/t/youtube/transcript?fixed=keep%26me',
      FAKE_ZERO_SCHEMA: JSON.stringify({ properties: { input: { properties: { queryParams: schema } } } }),
    }
    const fetch = (raw?: string, extraEnv: Record<string, string> = {}) => run(root,
      ['fetch', '--capability', 'transcript', '--max-pay', '0.01', ...(raw === undefined ? [] : ['--query-json', raw])],
      { ...env, ...extraEnv })
    return { root, log, fetch }
  }

  it('encodes declared GET query values, preserves configured query, and enforces remaining budget', () => {
    const { root, log, fetch } = queryFixture()
    const query = { v: 'video &?=#/+\u00e9', lang: 'en', count: 2, ratio: 0.5, enabled: false }
    expect(fetch(JSON.stringify(query)).body.guard).toMatchObject({ chargedUsd: 0.01, remainingUsd: 0.01 })
    const args = JSON.parse(readFileSync(log, 'utf8').trim())
    const url = new URL(args[1])
    expect(url.origin + url.pathname).toBe('https://toolsmith-api.dassad10.workers.dev/t/youtube/transcript')
    expect(url.searchParams.get('fixed')).toBe('keep&me')
    for (const [key, value] of Object.entries(query)) expect(url.searchParams.get(key)).toBe(String(value))
    expect([...url.searchParams.keys()]).toHaveLength(6)
    expect(args).not.toContain('--header')
    expect(fetch('{"v":"second"}').status).toBe(0)
    expect(fetch('{"v":"third"}').status).toBe(3)
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(2)
    expect(run(root, ['status']).body).toMatchObject({ remainingUsd: 0, callsThisWeek: 2 })
  })

  it.each([
    undefined, '{}', '{', '[]', 'null', '{"v":null}', '{"v":[]}', '{"v":{}}', '{"v":7}',
    '{"v":"ok","unknown":"x"}', '{"v":""}', JSON.stringify({ v: 'x'.repeat(101) }),
    '{"v":"ok","lang":"fr"}', '{"v":"ok","count":1.5}', '{"v":"ok","count":0}',
    '{"v":"ok","count":4}', '{"v":"ok","ratio":0}', '{"v":"ok","ratio":1}',
    '{"v":"ok","ratio":1e999}', '{"v":"ok","enabled":"true"}',
    '{"v":"ok","__proto__":"x"}',
  ])('rejects invalid query %s without a paid fetch or reservation', (raw) => {
    const { root, log, fetch } = queryFixture()
    expect(fetch(raw).status).not.toBe(0)
    expect(existsSync(log)).toBe(false)
    expect(run(root, ['status']).body).toMatchObject({ spentUsd: 0, remainingUsd: 0.02, callsThisWeek: 0 })
  })

  it('rejects query input on non-GET methods before reserving', () => {
    const { root, log, fetch } = queryFixture()
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(fetch('{"v":"ok"}', { FAKE_ZERO_METHOD: method }).body.error).toContain('only supported for GET')
    }
    expect(existsSync(log)).toBe(false)
    expect(run(root, ['status']).body.callsThisWeek).toBe(0)
  })

  it('charges a failed query call once without retrying', () => {
    const { root, log, fetch } = queryFixture()
    const result = fetch('{"v":"ok"}', { FAKE_ZERO_FAIL: '1' })
    expect(result.status).not.toBe(0)
    expect(result.body.guard).toMatchObject({ chargedUsd: 0.01, remainingUsd: 0.01 })
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(1)
    expect(run(root, ['status']).body.callsThisWeek).toBe(1)
  })

  it('rejects even a declared override of a configured query parameter', () => {
    const { root, log, fetch } = queryFixture({ ...querySchema,
      properties: { ...querySchema.properties, fixed: { type: 'string' } } })
    expect(fetch('{"v":"ok","fixed":"changed"}').body.error).toContain('Cannot override')
    expect(existsSync(log)).toBe(false)
    expect(run(root, ['status']).body.callsThisWeek).toBe(0)
  })

  it.each([null, {}, { type: 'object', properties: { v: { type: 'object' } } }])(
    'rejects undeclared or nonscalar live query schemas', (schema) => {
      const { root, log, fetch } = queryFixture(schema)
      expect(fetch('{"v":"ok"}').status).not.toBe(0)
      expect(existsSync(log)).toBe(false)
      expect(run(root, ['status']).body.callsThisWeek).toBe(0)
    },
  )

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
    expect(run(root, ['fetch', '--header', 'Authorization:secret', '--max-pay', '0.1']).body.error)
      .toContain('Unsupported option')
  })
})
