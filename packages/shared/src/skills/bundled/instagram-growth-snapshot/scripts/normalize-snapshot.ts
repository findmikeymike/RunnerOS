#!/usr/bin/env npx tsx
import { promises as fs } from 'node:fs'
import path from 'node:path'

type CliOptions = { capture: string; workspace: string; out?: string }

export interface NormalizedInstagramSnapshot {
  version: 1
  dataSource: 'instagram-insights-browser'
  snapshotDate: string
  windowDays: number | null
  profile: { profile: string; handle: string | null; accountUrl: string | null }
  metrics: Record<'followers' | 'followerDelta' | 'accountsReached' | 'accountsEngaged' | 'interactions' | 'profileVisits' | 'likes' | 'comments', number | null>
  partial: boolean
  errors: string[]
  updatedAt: string
}

const metricNames = ['followers', 'followerDelta', 'accountsReached', 'accountsEngaged', 'interactions', 'profileVisits', 'likes', 'comments'] as const

export function normalizeInstagramCapture(input: unknown, now = new Date()): NormalizedInstagramSnapshot {
  const root = record(input)
  const profile = record(root.profile)
  const metrics = record(root.metrics)
  const snapshotDate = string(root.snapshotDate)
  const profileId = string(profile.profile)
  if (!snapshotDate || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) throw new Error('capture snapshotDate must use YYYY-MM-DD')
  if (!profileId) throw new Error('capture profile.profile is required')

  const errors = Array.isArray(root.errors) ? root.errors.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())) : []
  const normalizedMetrics = Object.fromEntries(metricNames.map((name) => [name, metric(metrics[name], name === 'followerDelta')])) as NormalizedInstagramSnapshot['metrics']
  const missing = metricNames.filter((name) => normalizedMetrics[name] === null)
  if (missing.length) errors.push(`Metrics not visible: ${missing.join(', ')}.`)

  return {
    version: 1,
    dataSource: 'instagram-insights-browser',
    snapshotDate,
    windowDays: positiveInteger(root.windowDays),
    profile: {
      profile: profileId,
      handle: string(profile.handle),
      accountUrl: string(profile.accountUrl),
    },
    metrics: normalizedMetrics,
    partial: root.partial === true || missing.length > 0 || positiveInteger(root.windowDays) === null,
    errors: [...new Set(errors)],
    updatedAt: now.toISOString(),
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const workspace = path.resolve(options.workspace)
  const capture = insideWorkspace(workspace, options.capture)
  const parsed = JSON.parse(await fs.readFile(capture, 'utf8')) as unknown
  const snapshot = normalizeInstagramCapture(parsed)
  const output = insideWorkspace(workspace, options.out ?? `data/instagram/snapshots/${snapshot.snapshotDate}-insights.json`)
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' })
  console.log(JSON.stringify({
    ok: true,
    outPath: output,
    snapshot,
    contextPayload: { slug: 'artist-instagram-snapshot', body: snapshot },
  }, null, 2))
}

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[++index]
      if (!value) throw new Error(`Missing value for ${arg}`)
      return value
    }
    if (arg === '--capture') options.capture = next()
    else if (arg === '--workspace') options.workspace = next()
    else if (arg === '--out') options.out = next()
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!options.capture || !options.workspace) throw new Error('Usage: normalize-snapshot.ts --capture <path> --workspace <path> [--out <path>]')
  return options as CliOptions
}

function insideWorkspace(workspace: string, candidate: string): string {
  const resolved = path.resolve(workspace, candidate)
  const relative = path.relative(workspace, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('path must stay inside the workspace')
  return resolved
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function metric(value: unknown, signed: boolean): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (!signed && value < 0) return null
  return value
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
