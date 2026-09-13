#!/usr/bin/env bun
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { defaultRepoRoot, runReleasePreflight, validateMacUpdateArtifacts } from './release-preflight'

export interface ReleaseOptions {
  verifyArtifacts: boolean
  version?: string
  artifactDir: string
}

export function parseReleaseOptions(args: string[], repoRoot = defaultRepoRoot()): ReleaseOptions {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: false,
    strict: true,
    options: {
      'verify-artifacts': { type: 'boolean', default: false },
      version: { type: 'string' },
      'artifact-dir': { type: 'string', default: resolve(repoRoot, 'apps/electron/release-artist-os') },
      help: { type: 'boolean', default: false },
    },
  })
  if (positionals.length > 0) throw new Error(`Unexpected arguments: ${positionals.join(' ')}`)
  if (values.help) {
    console.log(`Artist OS release preflight

Usage:
  bun run release
  bun run release -- --version X.Y.Z
  bun run release -- --verify-artifacts [--artifact-dir PATH]

The default is read-only preflight. --verify-artifacts validates a separately built
two-architecture macOS payload. This command never builds, commits, tags, pushes,
signs, or publishes.`)
    process.exit(0)
  }
  return {
    verifyArtifacts: values['verify-artifacts'] ?? false,
    version: values.version,
    artifactDir: resolve(values['artifact-dir']!),
  }
}

export function main(args = process.argv.slice(2)): void {
  const repoRoot = defaultRepoRoot()
  const options = parseReleaseOptions(args, repoRoot)
  const preflight = runReleasePreflight({
    repoRoot,
    updateUrl: process.env.ARTIST_OS_UPDATE_URL,
    expectedVersion: options.version,
  })

  console.log(`Release preflight passed for Artist OS ${preflight.version}`)
  console.log(`Update feed: ${preflight.updateUrl}`)
  console.log(`Versioned packages: ${preflight.packages.length}`)

  if (options.verifyArtifacts) {
    const verified = validateMacUpdateArtifacts(options.artifactDir, preflight.version)
    console.log(`Verified macOS update payload: ${verified.join(', ')}`)
  } else {
    console.log('No build, signing, publishing, commit, tag, or push was performed.')
  }
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
