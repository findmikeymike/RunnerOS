import { afterEach, describe, expect, it } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  writeFileSync(executable, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ ok: true, runId: 'run-1', payment: { amount: '${paymentAmount}' } }))\n`)
  chmodSync(executable, 0o700)
  return executable
}

function malformedZero(root: string): string {
  const executable = join(root, 'malformed-zero.mjs')
  writeFileSync(executable, "#!/usr/bin/env node\nprocess.stdout.write('not-json')\n")
  chmodSync(executable, 0o700)
  return executable
}

describe('Zero weekly budget guard', () => {
  it('requires one configured weekly allowance and releases its lock on refusal', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-budget-'))
    roots.push(root)
    const result = run(root, ['fetch', '--capability', 'example', '--max-pay', '0.1', '--read-only', '--json'])
    expect(result.status).toBe(2)
    expect(result.body.error).toContain('No weekly Zero allowance')
    expect(run(root, ['status', '--json']).status).toBe(0)
  })

  it('persists the allowance and blocks overspend before execution', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-budget-'))
    roots.push(root)
    expect(run(root, ['configure', '--weekly-limit', '0.25', '--json']).status).toBe(0)
    expect(run(root, ['status', '--json']).body).toMatchObject({ configured: true, weeklyLimitUsd: 0.25, remainingUsd: 0.25 })
    const blocked = run(root, ['fetch', '--capability', 'example', '--max-pay', '0.3', '--read-only', '--json'])
    expect(blocked.status).toBe(3)
    expect(blocked.body).toMatchObject({ requestedMaxPayUsd: 0.3, remainingUsd: 0.25 })
  })

  it('requires the read-only declaration for automatic calls', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-budget-'))
    roots.push(root)
    run(root, ['configure', '--weekly-limit', '1', '--json'])
    const result = run(root, ['fetch', '--capability', 'example', '--max-pay', '0.1', '--json'])
    expect(result.status).toBe(1)
    expect(result.body.error).toContain('--read-only')
  })

  it('settles the actual charge and exposes the remaining weekly balance', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-budget-'))
    roots.push(root)
    run(root, ['configure', '--weekly-limit', '0.25', '--json'])

    const result = run(
      root,
      ['fetch', '--capability', 'trusted-example', '--max-pay', '0.15', '--read-only', '--json'],
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
      ['fetch', '--capability', 'trusted-example', '--max-pay', '0.15', '--read-only', '--json'],
      { ZERO_CLI: malformedZero(root) },
    )

    expect(result.status).not.toBe(0)
    expect(result.body.guard).toMatchObject({ chargedUsd: 0.15, remainingUsd: 0.1, weeklyLimitUsd: 0.25 })
    expect(run(root, ['status', '--json']).body).toMatchObject({ spentUsd: 0.15, remainingUsd: 0.1, callsThisWeek: 1 })
  })

  it('rejects arbitrary URLs and mutation-risk HTTP methods', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-budget-'))
    roots.push(root)
    run(root, ['configure', '--weekly-limit', '1', '--json'])

    expect(run(root, ['fetch', '--url', 'https://example.com', '--max-pay', '0.1', '--read-only', '--json']).body.error)
      .toContain('Unsupported option')
    expect(run(root, ['fetch', '--capability', 'example', '--method', 'DELETE', '--max-pay', '0.1', '--read-only', '--json']).body.error)
      .toContain('only GET or POST')
  })
})
