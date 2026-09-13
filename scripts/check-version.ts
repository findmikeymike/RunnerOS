#!/usr/bin/env bun
import { assertConsistentReleaseVersions, defaultRepoRoot, readReleasePackageVersions } from './release-preflight'

export function checkVersion(repoRoot = defaultRepoRoot(), expectedVersion?: string): string {
  const packages = readReleasePackageVersions(repoRoot)
  const version = assertConsistentReleaseVersions(packages, expectedVersion)
  for (const entry of packages) console.log(`ok  ${entry.path}: ${entry.version}`)
  console.log(`Desktop release packages agree on ${version}`)
  return version
}

if (import.meta.main) {
  try {
    const expected = process.argv[2]
    if (expected && !/^\d+\.\d+\.\d+$/.test(expected)) throw new Error('Usage: bun run check-version [X.Y.Z]')
    checkVersion(defaultRepoRoot(), expected)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
