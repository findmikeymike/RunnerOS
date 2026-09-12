import { readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

export const TEST_ROOTS = ['packages', 'apps', 'tools', 'scripts']
export const TEST_IGNORES = ['node_modules', 'release-artist-os', 'dist', '.git']
export const SHARD_COUNT = 6
export interface TestOptions { suite: 'all' | 'regular' | 'isolated'; shard?: string }
export interface TestCommand { label: string; args: string[]; timeoutMs: number }

export function parseTestOptions(args: string[]): TestOptions {
  const options: TestOptions = { suite: 'all' }
  for (const arg of args) {
    if (arg.startsWith('--suite=') && ['all', 'regular', 'isolated'].includes(arg.slice(8))) {
      options.suite = arg.slice(8) as TestOptions['suite']
    } else if (/^--shard=[1-6]\/6$/.test(arg)) options.shard = arg.slice(8)
    else throw new Error(`Unknown test option: ${arg}. Use --suite=all|regular|isolated and --shard=N/6.`)
  }
  if (options.shard && options.suite !== 'regular') throw new Error('--shard requires --suite=regular')
  return options
}

export function discoverIsolatedTests(root: string): string[] {
  const files: string[] = []
  const walk = (relative: string) => {
    // Do not follow symlink directories into another checkout or installation.
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      if (TEST_IGNORES.includes(entry.name)) continue
      const path = `${relative}/${entry.name}`
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith('.isolated.ts')) files.push(`./${path}`)
    }
  }
  for (const directory of TEST_ROOTS) walk(directory) // Missing roots are discovery failures.
  if (!files.length) throw new Error('No isolated tests discovered; refusing an empty isolated run.')
  return files.sort()
}

export function createTestPlan(root: string, options: TestOptions): TestCommand[] {
  const plan: TestCommand[] = []
  if (options.suite !== 'isolated') {
    const shards = options.shard ? [options.shard] : Array.from({ length: SHARD_COUNT }, (_, i) => `${i + 1}/${SHARD_COUNT}`)
    for (const shard of shards) plan.push({
      label: `regular shard ${shard}`,
      // Keep discovery mode. Explicit file lists change Bun module-loading behavior.
      args: ['test', `--shard=${shard}`, ...TEST_IGNORES.map(name => `--path-ignore-patterns=**/${name}/**`)],
      timeoutMs: 15 * 60_000,
    })
  }
  if (options.suite !== 'regular') {
    for (const file of discoverIsolatedTests(root)) plan.push({ label: file, args: ['test', file], timeoutMs: 3 * 60_000 })
  }
  return plan
}

export async function runTestCommand(command: TestCommand, root: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<number> {
  return new Promise(resolveResult => {
    let timedOut = false
    const child = spawn(process.execPath, command.args, { cwd: root, env, stdio: 'inherit', detached: process.platform !== 'win32' })
    const terminate = () => {
      try {
        // Include fixture grandchildren so timeouts cannot strand local servers.
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch { /* Already exited. */ }
    }
    const deadline = setTimeout(() => { timedOut = true; terminate() }, command.timeoutMs)
    signal?.addEventListener('abort', terminate, { once: true })
    if (signal?.aborted) terminate()
    const cleanup = () => { clearTimeout(deadline); signal?.removeEventListener('abort', terminate) }
    child.once('error', error => {
      terminate()
      cleanup()
      console.error(`${command.label}: ${error.message}`)
      resolveResult(1)
    })
    child.once('close', (code, signal) => {
      // A parent can exit while an unref'ed fixture server still owns the group.
      terminate()
      cleanup()
      if (timedOut) console.error(`${command.label}: exceeded ${command.timeoutMs}ms`)
      else if (signal) console.error(`${command.label}: terminated by ${signal}`)
      resolveResult(timedOut || signal || code === null ? 1 : code)
    })
  })
}

export async function runTests(root: string, options: TestOptions): Promise<number> {
  const plan = createTestPlan(root, options)
  let failed = 0
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  process.once('SIGTERM', cancel)
  let completed = 0
  try {
    for (const command of plan) {
      if (controller.signal.aborted) break
      // Every process starts fresh; no real user profile or sibling run's cache.
      const profile = mkdtempSync(join(tmpdir(), 'artist-os-tests-'))
      console.log(`\n== ${command.label}`)
      try {
        const code = await runTestCommand(command, root, {
          ...process.env,
          CRAFT_CONFIG_DIR: profile,
          CRAFT_PRODUCT_VARIANT: 'artist-os',
          CRAFT_BUNDLED_ASSETS_ROOT: join(root, 'apps/electron'),
          PANGOCAIRO_BACKEND: 'fontconfig',
        }, controller.signal)
        completed++
        if (code !== 0) failed++
      } finally { rmSync(profile, { recursive: true, force: true }) }
    }
  } finally {
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', cancel)
  }
  console.log(`\nTest processes: ${completed - failed} passed, ${failed} failed, ${plan.length - completed} not run (${plan.length} total).`)
  return failed || controller.signal.aborted ? 1 : 0
}

if (import.meta.main) {
  try { process.exitCode = await runTests(resolve(import.meta.dir, '..'), parseTestOptions(process.argv.slice(2))) }
  catch (error) { console.error(error); process.exitCode = 1 }
}
