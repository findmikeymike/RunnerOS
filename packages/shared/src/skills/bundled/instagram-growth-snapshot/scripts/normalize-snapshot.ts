#!/usr/bin/env npx tsx
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

type CliOptions = { capture: string; workspace: string; out?: string }

import { normalizeInstagramCapture } from './normalization-core'
export { normalizeInstagramCapture, type NormalizedInstagramSnapshot } from './normalization-core'

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const workspace = path.resolve(options.workspace)
  const capture = insideWorkspace(workspace, options.capture)
  await assertRealContainment(workspace, capture)
  const parsed = JSON.parse(await fs.readFile(capture, 'utf8')) as unknown
  const snapshot = normalizeInstagramCapture(parsed)
  const output = insideWorkspace(workspace, options.out ?? `data/instagram/snapshots/${snapshot.snapshotDate}-insights-${randomUUID()}.json`)
  await assertRealContainment(workspace, path.dirname(output))
  await fs.mkdir(path.dirname(output), { recursive: true })
  await assertRealContainment(workspace, path.dirname(output))
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
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('path must stay inside the workspace')
  return resolved
}

async function assertRealContainment(workspace: string, candidate: string): Promise<void> {
  const realWorkspace = await fs.realpath(workspace)
  let ancestor = candidate
  while (true) {
    try {
      const realAncestor = await fs.realpath(ancestor)
      insideWorkspace(realWorkspace, realAncestor)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // A dangling symlink is not a missing directory we may create through.
      try { if ((await fs.lstat(ancestor)).isSymbolicLink()) throw new Error('path contains a dangling symlink') }
      catch (statError) { if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError }
      const parent = path.dirname(ancestor)
      if (parent === ancestor) throw new Error('workspace path cannot be resolved')
      ancestor = parent
    }
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
