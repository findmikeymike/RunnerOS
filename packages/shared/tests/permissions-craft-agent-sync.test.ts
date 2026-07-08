import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateBashCommand } from '../src/agent/bash-validator.ts'
import { getCraftAgentReadOnlyBashPatterns } from '../src/config/cli-domains.ts'

type AllowedBashEntry = { pattern: string; comment?: string }
type CompiledBashEntry = { regex: RegExp; source: string }

function compileBashPatterns(entries: AllowedBashEntry[] = []): CompiledBashEntry[] {
  return entries.map(entry => ({ regex: new RegExp(entry.pattern), source: entry.pattern }))
}

describe('permissions craft-agent allowlist sync', () => {
  it('keeps default.json craft-agent read-only rules aligned with shared CLI domain policy', () => {
    const permissionsPath = resolve(import.meta.dir, '../../../apps/electron/resources/permissions/default.json')
    const permissions = JSON.parse(readFileSync(permissionsPath, 'utf-8')) as {
      allowedBashPatterns?: AllowedBashEntry[]
    }

    const actual = (permissions.allowedBashPatterns ?? [])
      .filter(entry => typeof entry.pattern === 'string' && entry.pattern.startsWith('^craft-agent\\s'))
      .map(entry => ({ pattern: entry.pattern, comment: entry.comment ?? '' }))
      .sort((a, b) => a.pattern.localeCompare(b.pattern))

    const expected = getCraftAgentReadOnlyBashPatterns()
      .map(entry => ({ pattern: entry.pattern, comment: entry.comment }))
      .sort((a, b) => a.pattern.localeCompare(b.pattern))

    expect(actual).toEqual(expected)
  })

  it('allows only the guarded Printing Press Social execute handoff shape by default', () => {
    const permissionsPath = resolve(import.meta.dir, '../../../apps/electron/resources/permissions/default.json')
    const permissions = JSON.parse(readFileSync(permissionsPath, 'utf-8')) as {
      allowedBashPatterns?: AllowedBashEntry[]
    }

    const executePattern = permissions.allowedBashPatterns?.find(entry =>
      entry.pattern.includes('social\\.mjs\\s+execute')
    )

    expect(executePattern).toBeDefined()
    expect(executePattern!.pattern).toContain('--action-file')
    expect(executePattern!.pattern).toContain('--expected-action-id')
    expect(executePattern!.pattern).toContain('--confirm\\s+yes')
    expect(executePattern!.pattern).toContain('--json')

    const patterns = compileBashPatterns(permissions.allowedBashPatterns)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs registry --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs doctor --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs catalog --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs assets --asset-root assets --platform x --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs assets --asset-root "/tmp/my assets" --platform x --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs content --content-root content --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs content --content-root "/tmp/my content" --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs post x --profile p --text hi --dry-run --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs post x --profile p && echo BAD --dry-run --json', patterns).allowed).toBe(false)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs execute --action-file dry-run.json --expected-action-id act_abc-123 --confirm yes --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs execute --action-file "/tmp/dry runs/dry-run.json" --expected-action-id act_abc-123 --confirm yes --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs execute --action-file dry-run.json --confirm yes --json', patterns).allowed).toBe(false)
  })
})
