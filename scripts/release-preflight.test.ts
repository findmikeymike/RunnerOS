import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import {
  assertConsistentReleaseVersions,
  assertGitReleaseState,
  readReleasePackageVersions,
  validateMacUpdateArtifacts,
} from './release-preflight'
import { parseReleaseOptions } from './release'

const require = createRequire(import.meta.url)
const { assertPublicArtistOsUpdateUrl } = require('../apps/electron/scripts/artist-os-release-config.cjs') as {
  assertPublicArtistOsUpdateUrl: (value: string | undefined) => string
}

const temporaryDirectories: string[] = []
const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'artist-os-release-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Artist OS update feed gate', () => {
  test('requires a public HTTPS endpoint and rejects the unavailable private GitHub feed', () => {
    for (const value of [
      undefined,
      '',
      'http://updates.artistos.com/downloads',
      'https://localhost/updates',
      'https://192.168.1.5/updates',
      'https://user:password@updates.artistos.com',
      'https://updates.artistos.com/files?token=secret',
      'https://github.com/findmikeymike/ArtistOS/releases/latest/download',
    ]) {
      expect(() => assertPublicArtistOsUpdateUrl(value)).toThrow()
    }
  })

  test('normalizes an explicit public HTTPS endpoint', () => {
    expect(assertPublicArtistOsUpdateUrl(' https://updates.artistos.com/v1/ ')).toBe('https://updates.artistos.com/v1')
  })
})

describe('release preflight', () => {
  test('requires main and a clean working tree', () => {
    expect(() => assertGitReleaseState({ branch: 'feature', status: '' })).toThrow('must run from main')
    expect(() => assertGitReleaseState({ branch: 'main', status: ' M package.json' })).toThrow('clean working tree')
    expect(() => assertGitReleaseState({ branch: 'main', status: '' })).not.toThrow()
  })

  test('checks desktop package versions while excluding the separately deployed entitlement service', () => {
    const root = temporaryDirectory()
    for (const [path, version] of [
      ['package.json', '1.2.3'],
      ['apps/electron/package.json', '1.2.3'],
      ['packages/shared/package.json', '1.2.3'],
      ['packages/entitlement-service/package.json', '0.1.0'],
    ]) {
      mkdirSync(join(root, path, '..'), { recursive: true })
      writeFileSync(join(root, path), JSON.stringify({ version }))
    }
    const versions = readReleasePackageVersions(root)
    expect(versions.map((entry) => entry.path)).not.toContain('packages/entitlement-service/package.json')
    expect(assertConsistentReleaseVersions(versions, '1.2.3')).toBe('1.2.3')
    expect(() => assertConsistentReleaseVersions([...versions, { path: 'apps/bad/package.json', version: '1.2.4' }])).toThrow('version mismatch')
  })

  test('stays preflight-only and verifies existing artifacts only when requested', () => {
    expect(parseReleaseOptions([], '/repo')).toMatchObject({ verifyArtifacts: false })
    expect(() => parseReleaseOptions(['--build'], '/repo')).toThrow()
    expect(parseReleaseOptions(['--verify-artifacts', '--version', '1.2.3'], '/repo')).toMatchObject({
      verifyArtifacts: true,
      version: '1.2.3',
    })
  })
})

describe('macOS update artifacts', () => {
  function writeValidPayload(architectures = ['arm64', 'x64'], formats = ['zip']): { directory: string; artifacts: string[] } {
    const directory = temporaryDirectory()
    const artifacts = formats.flatMap((format) => architectures.map((architecture) => `Artist-OS-1.2.3-${architecture}.${format}`))
    const entries = artifacts.map((artifact) => {
      const bytes = Buffer.from(`verified update bytes for ${artifact}`)
      writeFileSync(join(directory, artifact), bytes)
      writeFileSync(join(directory, `${artifact}.blockmap`), 'blockmap')
      return { artifact, bytes, sha512: createHash('sha512').update(bytes).digest('base64') }
    })
    writeFileSync(join(directory, 'latest-mac.yml'), [
      'version: 1.2.3',
      'files:',
      ...entries.flatMap(({ artifact, bytes, sha512 }) => [
        `  - url: ${artifact}`,
        `    sha512: ${sha512}`,
        `    size: ${bytes.length}`,
      ]),
      `path: ${entries[0]!.artifact}`,
      `sha512: ${entries[0]!.sha512}`,
      '',
    ].join('\n'))
    return { directory, artifacts }
  }

  test('verifies manifest version, ZIP checksum and blockmap', () => {
    const { directory, artifacts } = writeValidPayload()
    expect(validateMacUpdateArtifacts(directory, '1.2.3')).toEqual([
      'latest-mac.yml',
      ...artifacts.flatMap((artifact) => [artifact, `${artifact}.blockmap`]),
    ])
  })

  test('accepts the combined ZIP and DMG manifest emitted by electron-builder', () => {
    const { directory, artifacts } = writeValidPayload(['arm64', 'x64'], ['zip', 'dmg'])
    expect(validateMacUpdateArtifacts(directory, '1.2.3')).toEqual([
      'latest-mac.yml',
      ...artifacts.flatMap((artifact) => [artifact, `${artifact}.blockmap`]),
    ])
  })

  test('DMGs do not replace required ZIPs and duplicate files remain invalid', () => {
    const dmgOnly = writeValidPayload(['arm64', 'x64'], ['dmg'])
    expect(() => validateMacUpdateArtifacts(dmgOnly.directory, '1.2.3')).toThrow('missing required architecture(s): arm64, x64')

    const duplicate = writeValidPayload(['arm64', 'x64'], ['zip', 'dmg', 'dmg'])
    expect(() => validateMacUpdateArtifacts(duplicate.directory, '1.2.3')).toThrow('Duplicate macOS update artifact')
  })

  test('checks optional DMG identity, size, checksum, and blockmap', () => {
    for (const damage of ['identity', 'size', 'checksum', 'blockmap'] as const) {
      const { directory, artifacts } = writeValidPayload(['arm64', 'x64'], ['zip', 'dmg'])
      const dmg = artifacts.find((artifact) => artifact.endsWith('.dmg'))!
      const file = join(directory, dmg)
      if (damage === 'identity') {
        const manifestPath = join(directory, 'latest-mac.yml')
        writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace(dmg, dmg.replace('1.2.3', '1.2.4')))
      } else if (damage === 'size') {
        writeFileSync(file, 'truncated')
      } else if (damage === 'checksum') {
        const bytes = readFileSync(file)
        bytes[0] = bytes[0]! ^ 1
        writeFileSync(file, bytes)
      } else {
        rmSync(`${file}.blockmap`)
      }
      const expectedError = {
        identity: 'Unexpected macOS update artifact name',
        size: 'Artifact size does not match',
        checksum: 'Artifact checksum does not match',
        blockmap: 'Missing update blockmap',
      }[damage]
      expect(() => validateMacUpdateArtifacts(directory, '1.2.3')).toThrow(expectedError)
    }
  })

  test('fails closed on damaged or incomplete update payloads', () => {
    const checksum = writeValidPayload()
    writeFileSync(join(checksum.directory, checksum.artifacts[0]!), 'tampered')
    expect(() => validateMacUpdateArtifacts(checksum.directory, '1.2.3')).toThrow()

    const blockmap = writeValidPayload()
    rmSync(join(blockmap.directory, `${blockmap.artifacts[0]}.blockmap`))
    expect(() => validateMacUpdateArtifacts(blockmap.directory, '1.2.3')).toThrow('Missing update blockmap')

    const version = writeValidPayload()
    expect(() => validateMacUpdateArtifacts(version.directory, '1.2.4')).toThrow('does not match')

    const architecture = writeValidPayload(['arm64'])
    expect(() => validateMacUpdateArtifacts(architecture.directory, '1.2.3')).toThrow('missing required architecture(s): x64')

    const crossOrigin = writeValidPayload()
    const manifestPath = join(crossOrigin.directory, 'latest-mac.yml')
    let manifest = readFileSync(manifestPath, 'utf8')
    for (const artifact of crossOrigin.artifacts) {
      manifest = manifest.replaceAll(artifact, `https://evil.example/${artifact}`)
    }
    writeFileSync(manifestPath, manifest)
    expect(() => validateMacUpdateArtifacts(crossOrigin.directory, '1.2.3')).toThrow('relative artifact filename')
  })
})

test('Artist OS builder uses the gated feed and its own package cache identity', async () => {
  const config = Bun.file(join(import.meta.dir, '../apps/electron/electron-builder.artist-os.yml'))
  const runtimeIdentity = Bun.file(join(import.meta.dir, '../packages/shared/src/config/runtime-identity.ts'))
  const source = await config.text()
  expect(source).toContain('url: ${env.ARTIST_OS_UPDATE_URL}')
  expect(source).toContain('name: artist-os')
  expect(source).not.toContain('github.com/findmikeymike/ArtistOS/releases/latest/download')
  expect(await runtimeIdentity.text()).not.toContain('updateFeedUrl')
})

test('Artist OS beforePack rejects a missing feed before performing package work', async () => {
  const beforePack = require('../apps/electron/scripts/beforePack.cjs').default as (context: unknown) => Promise<void>
  const previous = process.env.ARTIST_OS_UPDATE_URL
  delete process.env.ARTIST_OS_UPDATE_URL
  try {
    await expect(beforePack({})).rejects.toThrow('ARTIST_OS_UPDATE_URL is required')
  } finally {
    if (previous === undefined) delete process.env.ARTIST_OS_UPDATE_URL
    else process.env.ARTIST_OS_UPDATE_URL = previous
  }
})
