import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestPlan, discoverIsolatedTests, parseTestOptions, runTestCommand, runTests, TEST_ROOTS } from './run-tests'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'test-runner-fixture-')); roots.push(root)
  for (const directory of TEST_ROOTS) mkdirSync(join(root, directory))
  return root
}
function put(root: string, path: string, text = '') {
  const file = join(root, path); mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text)
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

test('isolated discovery handles spaces, ignores generated copies and does not follow symlinks', () => {
  const root = fixture()
  put(root, 'packages/z test.isolated.ts'); put(root, 'apps/a.isolated.ts')
  for (const directory of ['dist', 'release-artist-os', 'node_modules']) put(root, `apps/${directory}/copy.isolated.ts`)
  symlinkSync(join(root, 'packages'), join(root, 'apps/linked'), 'dir')
  expect(discoverIsolatedTests(root)).toEqual(['./apps/a.isolated.ts', './packages/z test.isolated.ts'])
  const plan = createTestPlan(root, { suite: 'isolated' })
  expect(plan.map(x => x.args)).toEqual([['test', './apps/a.isolated.ts'], ['test', './packages/z test.isolated.ts']])
})

test('missing roots and empty isolated discovery cannot pass silently', () => {
  const root = fixture()
  expect(() => discoverIsolatedTests(root)).toThrow('No isolated tests')
  rmSync(join(root, 'tools'), { recursive: true })
  expect(() => discoverIsolatedTests(root)).toThrow()
})

test('regular runs preserve discovery mode and the same six-shard plan in local and CI', () => {
  const root = fixture()
  const all = createTestPlan(root, { suite: 'regular' })
  expect(all).toHaveLength(6)
  expect(createTestPlan(root, parseTestOptions(['--suite=regular', '--shard=4/6']))).toEqual([all[3]!])
  expect(all.every(x => x.args.includes('--path-ignore-patterns=**/dist/**') && x.args.includes('--path-ignore-patterns=**/release-artist-os/**'))).toBe(true)
  expect(() => parseTestOptions(['--shard=1/6'])).toThrow('--shard requires')
  expect(() => parseTestOptions(['--suite=regular', '--shard=0/6'])).toThrow('Unknown')
  expect(() => parseTestOptions(['--pass-with-no-tests'])).toThrow('Unknown')
})

test('child success, failures, signals and timeouts all have honest outcomes', async () => {
  const root = fixture()
  const run = (script: string, timeoutMs = 3000) => runTestCommand({ label: 'fixture', args: ['-e', script], timeoutMs }, root, { ...process.env })
  expect(await run('process.exit(0)')).toBe(0)
  expect(await run('process.exit(7)')).toBe(7)
  expect(await run('process.kill(process.pid, "SIGTERM")')).not.toBe(0)
  expect(await run('setInterval(() => {}, 1000)', 100)).not.toBe(0)
})

test('an actual isolated test in a space-containing path executes and reports failed assertions', async () => {
  const root = fixture()
  put(root, 'packages/space name.isolated.ts', 'import {test,expect} from "bun:test"; test("sentinel",()=>expect(1).toBe(2));')
  const command = createTestPlan(root, { suite: 'isolated' })[0]!
  expect(await runTestCommand(command, root, { ...process.env })).not.toBe(0)
  put(root, 'packages/space name.isolated.ts', 'import {test,expect} from "bun:test"; test("sentinel",()=>expect(1).toBe(1));')
  expect(await runTestCommand(command, root, { ...process.env })).toBe(0)
})


test('later successful processes cannot hide an earlier failure and every process receives Artist OS setup', async () => {
  const root = fixture()
  put(root, 'packages/a.isolated.ts', 'import {test,expect} from "bun:test"; test("failure sentinel",()=>expect(false).toBe(true));')
  put(root, 'packages/b.isolated.ts', `import {test,expect} from "bun:test";
    import {writeFileSync} from "node:fs";
    test("setup sentinel",()=>{
      expect(process.env.CRAFT_PRODUCT_VARIANT).toBe("artist-os");
      expect(process.env.PANGOCAIRO_BACKEND).toBe("fontconfig");
      expect(process.env.CRAFT_BUNDLED_ASSETS_ROOT).toBe(${JSON.stringify(join(root, 'apps/electron'))});
      writeFileSync(${JSON.stringify(join(root, 'observed.json'))},JSON.stringify({profile:process.env.CRAFT_CONFIG_DIR}));
    });`)
  expect(await runTests(root, { suite: 'isolated' })).toBe(1)
  const observed = JSON.parse(readFileSync(join(root, 'observed.json'), 'utf8'))
  expect(observed.profile).toContain('artist-os-tests-')
  expect(existsSync(observed.profile)).toBe(false)
})

test('cancelled child is a failure instead of a successful empty run', async () => {
  const root = fixture()
  const controller = new AbortController()
  controller.abort()
  expect(await runTestCommand({ label: 'cancel sentinel', args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 3000 }, root, { ...process.env }, controller.signal)).not.toBe(0)
})


test.skipIf(process.platform === 'win32')('a failed parent cannot leave its fixture grandchild running', async () => {
  const root = fixture()
  const pidFile = join(root, 'grandchild.pid')
  const script = `import {spawn} from "node:child_process"; import {writeFileSync} from "node:fs";
    const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
    writeFileSync(${JSON.stringify(pidFile)},String(child.pid));child.unref();process.exit(7);`
  let pid: number | undefined
  try {
    expect(await runTestCommand({label:'grandchild fixture',args:['-e',script],timeoutMs:3000},root,{...process.env})).toBe(7)
    pid = Number(readFileSync(pidFile,'utf8'))
    const alive = () => { try { process.kill(pid!,0); return true } catch { return false } }
    const deadline = Date.now()+1000
    while (alive() && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10))
    expect(alive()).toBe(false)
  } finally {
    if (pid) { try {process.kill(pid,'SIGKILL')} catch { /* Already reaped. */ } }
  }
})
