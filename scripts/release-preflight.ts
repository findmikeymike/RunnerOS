import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import yaml from 'js-yaml'

const require = createRequire(import.meta.url)
const { assertPublicArtistOsUpdateUrl } = require('../apps/electron/scripts/artist-os-release-config.cjs') as {
  assertPublicArtistOsUpdateUrl: (value: string | undefined) => string
}

export interface PackageVersion {
  path: string
  version: string
}

export interface MacUpdateFile {
  url: string
  sha512: string
  size: number
}

interface MacUpdateManifest {
  version?: unknown
  files?: unknown
  path?: unknown
  sha512?: unknown
}

export const RELEASE_PACKAGE_EXCLUSIONS = new Set([
  // Separately deployed service with its own 0.x lifecycle, not part of the desktop binary.
  'packages/entitlement-service/package.json',
])

export function listReleasePackageFiles(repoRoot: string): string[] {
  const roots = ['apps', 'packages']
  const files = [join(repoRoot, 'package.json')]
  for (const root of roots) {
    const directory = join(repoRoot, root)
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const packageFile = join(directory, entry.name, 'package.json')
      const relativePath = relative(repoRoot, packageFile).replace(/\\/g, '/')
      if (existsSync(packageFile) && !RELEASE_PACKAGE_EXCLUSIONS.has(relativePath)) files.push(packageFile)
    }
  }
  return files.sort()
}

export function readReleasePackageVersions(repoRoot: string): PackageVersion[] {
  return listReleasePackageFiles(repoRoot).map((file) => {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }
    if (typeof parsed.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(parsed.version)) {
      throw new Error(`${relative(repoRoot, file)} must declare a stable X.Y.Z version`)
    }
    return { path: relative(repoRoot, file).replace(/\\/g, '/'), version: parsed.version }
  })
}

export function assertConsistentReleaseVersions(
  versions: PackageVersion[],
  expectedVersion?: string,
): string {
  if (versions.length === 0) throw new Error('No desktop release packages were found')
  const reference = expectedVersion ?? versions.find((entry) => entry.path === 'package.json')?.version
  if (!reference || !/^\d+\.\d+\.\d+$/.test(reference)) {
    throw new Error('Expected release version must use stable X.Y.Z format')
  }
  const mismatches = versions.filter((entry) => entry.version !== reference)
  if (mismatches.length > 0) {
    throw new Error(`Release version mismatch (expected ${reference}):\n${mismatches.map((entry) => `- ${entry.path}: ${entry.version}`).join('\n')}`)
  }
  return reference
}

export function assertGitReleaseState(input: { branch: string; status: string }): void {
  if (input.branch !== 'main') throw new Error(`Artist OS releases must run from main (current: ${input.branch || 'detached HEAD'})`)
  if (input.status.trim()) throw new Error('Artist OS releases require a clean working tree')
}

export function readGitReleaseState(repoRoot: string): { branch: string; status: string } {
  const run = (args: string[]) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
  return {
    branch: run(['branch', '--show-current']),
    status: run(['status', '--porcelain', '--untracked-files=all']),
  }
}

function parseMacUpdateFiles(value: unknown): MacUpdateFile[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('latest-mac.yml must contain at least one update file')
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`latest-mac.yml files[${index}] is invalid`)
    const candidate = entry as Record<string, unknown>
    if (typeof candidate.url !== 'string' || !candidate.url) throw new Error(`latest-mac.yml files[${index}].url is missing`)
    if (typeof candidate.sha512 !== 'string' || !candidate.sha512) throw new Error(`latest-mac.yml files[${index}].sha512 is missing`)
    if (typeof candidate.size !== 'number' || !Number.isSafeInteger(candidate.size) || candidate.size <= 0) {
      throw new Error(`latest-mac.yml files[${index}].size is invalid`)
    }
    return { url: candidate.url, sha512: candidate.sha512, size: candidate.size }
  })
}

function decodeArtifactName(urlValue: string): string {
  if (
    !urlValue
    || urlValue !== urlValue.trim()
    || urlValue.includes('/')
    || urlValue.includes('\\')
    || urlValue.includes('?')
    || urlValue.includes('#')
  ) {
    throw new Error(`latest-mac.yml must use a relative artifact filename: ${urlValue}`)
  }

  let name: string
  try {
    name = decodeURIComponent(urlValue)
  } catch {
    throw new Error(`latest-mac.yml contains an invalid artifact URL: ${urlValue}`)
  }
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`latest-mac.yml contains an unsafe artifact URL: ${urlValue}`)
  }
  return name
}

function sha512Base64(file: string): string {
  return createHash('sha512').update(readFileSync(file)).digest('base64')
}

export function validateMacUpdateArtifacts(artifactDir: string, expectedVersion: string): string[] {
  const directory = resolve(artifactDir)
  const manifestPath = join(directory, 'latest-mac.yml')
  if (!existsSync(manifestPath)) throw new Error(`Missing macOS update manifest: ${manifestPath}`)

  const manifest = yaml.load(readFileSync(manifestPath, 'utf8')) as MacUpdateManifest | null
  if (!manifest || typeof manifest !== 'object') throw new Error('latest-mac.yml is not a YAML object')
  if (manifest.version !== expectedVersion) {
    throw new Error(`latest-mac.yml version ${String(manifest.version)} does not match ${expectedVersion}`)
  }

  const files = parseMacUpdateFiles(manifest.files)
  const requiredArchitectures = new Set(['arm64', 'x64'])
  const foundArchitectures = new Set<string>()
  const foundArtifacts = new Set<string>()
  const verified: string[] = []
  for (const entry of files) {
    const name = decodeArtifactName(entry.url)
    const expectedName = new RegExp(`^Artist-OS-${expectedVersion.replace(/\./g, '\\.')}-(arm64|x64)\\.(zip|dmg)$`)
    const match = expectedName.exec(name)
    if (!match) throw new Error(`Unexpected macOS update artifact name: ${name}`)
    const architecture = match[1]!
    if (foundArtifacts.has(name)) throw new Error(`Duplicate macOS update artifact: ${name}`)
    foundArtifacts.add(name)
    // electron-builder merges optional DMG entries into the same manifest.
    // macOS auto-update still needs a ZIP for each supported architecture.
    if (match[2] === 'zip') foundArchitectures.add(architecture)
    const file = join(directory, name)
    if (!existsSync(file)) throw new Error(`Manifest references missing artifact: ${name}`)
    if (statSync(file).size !== entry.size) throw new Error(`Artifact size does not match latest-mac.yml: ${name}`)
    if (sha512Base64(file) !== entry.sha512) throw new Error(`Artifact checksum does not match latest-mac.yml: ${name}`)
    const blockmap = `${file}.blockmap`
    if (!existsSync(blockmap) || statSync(blockmap).size === 0) throw new Error(`Missing update blockmap: ${basename(blockmap)}`)
    verified.push(name, basename(blockmap))
  }

  const missingArchitectures = [...requiredArchitectures].filter((architecture) => !foundArchitectures.has(architecture))
  if (missingArchitectures.length > 0) {
    throw new Error(`latest-mac.yml is missing required architecture(s): ${missingArchitectures.join(', ')}`)
  }

  if (typeof manifest.path === 'string') {
    const primaryName = decodeArtifactName(manifest.path)
    const primary = files.find((entry) => decodeArtifactName(entry.url) === primaryName)
    if (!primary) throw new Error('latest-mac.yml path does not identify one of its files')
    if (typeof manifest.sha512 !== 'string' || manifest.sha512 !== primary.sha512) {
      throw new Error('latest-mac.yml primary checksum does not match its files entry')
    }
  }

  return ['latest-mac.yml', ...verified]
}

export function runReleasePreflight(input: {
  repoRoot: string
  updateUrl: string | undefined
  expectedVersion?: string
}): { version: string; updateUrl: string; packages: PackageVersion[] } {
  assertGitReleaseState(readGitReleaseState(input.repoRoot))
  const updateUrl = assertPublicArtistOsUpdateUrl(input.updateUrl)
  const packages = readReleasePackageVersions(input.repoRoot)
  const version = assertConsistentReleaseVersions(packages, input.expectedVersion)
  return { version, updateUrl, packages }
}

export function defaultRepoRoot(): string {
  return dirname(import.meta.dir)
}
