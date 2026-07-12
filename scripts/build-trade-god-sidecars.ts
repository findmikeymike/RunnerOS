import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dir, '..')

function readOutdir(args: string[]): string {
  const flagIndex = args.indexOf('--outdir')
  if (flagIndex === -1) return path.join(repoRoot, 'apps', 'electron', 'dist', 'trade-god')
  const value = args[flagIndex + 1]
  if (!value) throw new Error('--outdir requires a path')
  return path.resolve(value)
}

export async function buildTradeGodSidecars(outdir: string): Promise<string> {
  mkdirSync(outdir, { recursive: true })
  const result = await Bun.build({
    entrypoints: [path.join(repoRoot, 'sidecars', 'order-flow-engine', 'src', 'cli.ts')],
    outdir,
    naming: 'order-flow-engine.mjs',
    target: 'bun',
    format: 'esm',
    sourcemap: 'none',
  })

  if (!result.success) {
    throw new AggregateError(result.logs, 'Trade God sidecar build failed')
  }

  const output = path.join(outdir, 'order-flow-engine.mjs')
  if (!existsSync(output)) throw new Error(`Trade God sidecar output missing: ${output}`)
  return output
}

if (import.meta.main) {
  const output = await buildTradeGodSidecars(readOutdir(process.argv.slice(2)))
  console.log(`Built Trade God Order Flow sidecar: ${output}`)
}
