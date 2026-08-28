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
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs profile status spotify --profile artist-main --live --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs snapshot spotify --profile artist-main --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs snapshot spotify --profile artist-main --capture-file /tmp/spotify-capture.json --workspace /tmp/artist-workspace --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs assets --asset-root assets --platform x --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs assets --asset-root "/tmp/my assets" --platform x --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs content --content-root content --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs content --content-root "/tmp/my content" --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs post x --profile p --text hi --dry-run --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs playlist spotify create --profile p --name Mood --tracks spotify:track:4iV5W9uYEdYUVa79Axb7Rh --dry-run --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs post x --profile p && echo BAD --dry-run --json', patterns).allowed).toBe(false)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs execute --action-file dry-run.json --expected-action-id act_abc-123 --confirm yes --json', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs execute --action-file "/tmp/dry runs/dry-run.json" --expected-action-id act_abc-123 --confirm yes --json', patterns).allowed).toBe(true)
    expect(validateBashCommand(`cd tools/printing-press-social && node src/social.mjs execute --action-file spotify.json --expected-action-id act_abc-123 --expected-action-digest sha256:${'a'.repeat(64)} --confirm yes --json`, patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs execute --action-file spotify.json --expected-action-id act_abc-123 --expected-action-digest sha256:bad --confirm yes --json', patterns).allowed).toBe(false)
    expect(validateBashCommand('cd tools/printing-press-social && node src/social.mjs execute --action-file dry-run.json --confirm yes --json', patterns).allowed).toBe(false)
  })

  it('allows workflow research CLIs but blocks paid and mutating variants', () => {
    const permissionsPath = resolve(import.meta.dir, '../../../apps/electron/resources/permissions/default.json')
    const permissions = JSON.parse(readFileSync(permissionsPath, 'utf-8')) as {
      allowedBashPatterns?: AllowedBashEntry[]
    }
    const patterns = compileBashPatterns(permissions.allowedBashPatterns)

    expect(validateBashCommand('command -v zero && zero --version', patterns).allowed).toBe(true)
    expect(validateBashCommand('zero search "Tomba LinkedIn email finder"', patterns).allowed).toBe(true)
    expect(validateBashCommand('ZERO_AGENT=codex zero search "Tomba LinkedIn email finder"', patterns).allowed).toBe(false)
    expect(validateBashCommand('zero get 1 --formatted', patterns).allowed).toBe(true)
    expect(validateBashCommand('zero fetch "https://example.com" --max-pay 0.50 --json', patterns).allowed).toBe(false)

    expect(validateBashCommand('python3 ~/.agents/skills/college-radio-matcher/match.py --limit 12 --format json', patterns).allowed).toBe(true)

    expect(validateBashCommand('cd tools/printify && node bin/printify.mjs doctor --agent', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printify && node bin/printify.mjs catalog retrieves-list-of-blueprints-in-the --agent', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printify && node bin/printify.mjs uploads an-image --body-json "{}" --dry-run --agent', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printify && node bin/printify.mjs uploads an-image --body-json "{}" --private-draft --agent', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printify && node bin/printify.mjs shops products-json create-anew-product 123 --title Draft --private-draft --agent', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/printify && node bin/printify.mjs shops products-json publish 123 product --private-draft --agent', patterns).allowed).toBe(false)
    expect(validateBashCommand('cd tools/printify && node bin/printify.mjs uploads an-image --private-draft --agent && touch /tmp/BAD', patterns).allowed).toBe(false)
    expect(validateBashCommand('cd tools/printify && node bin/printify.mjs uploads an-image --confirm-runner --agent', patterns).allowed).toBe(false)
    expect(validateBashCommand('cd tools/printify && node bin/printify.mjs uploads an-image --dry-run --confirm-runner --agent', patterns).allowed).toBe(false)

    expect(validateBashCommand('cd tools/shopify && node bin/shopify.mjs products list --first 10 --agent', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/shopify && node bin/shopify.mjs products create --input product.json --agent', patterns).allowed).toBe(true)
    expect(validateBashCommand('cd tools/shopify && node bin/shopify.mjs products create --input product.json --confirm --agent', patterns).allowed).toBe(false)
  })

  it('allows private Gmail drafts but never Gmail sends by default', () => {
    const permissionsPath = resolve(import.meta.dir, '../../../apps/electron/resources/permissions/default.json')
    const permissions = JSON.parse(readFileSync(permissionsPath, 'utf-8')) as {
      allowedApiEndpoints?: Array<{ method: string; path: string }>
    }
    const postRules = (permissions.allowedApiEndpoints ?? [])
      .filter((rule) => rule.method === 'POST')
      .map((rule) => new RegExp(rule.path))

    expect(postRules.some((rule) => rule.test('/users/me/drafts'))).toBe(true)
    expect(postRules.some((rule) => rule.test('/users/me/drafts/send'))).toBe(false)
    expect(postRules.some((rule) => rule.test('/users/me/messages/send'))).toBe(false)
  })
})
