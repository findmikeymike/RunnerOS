import { build } from 'esbuild'
import { chromium, type Page } from 'playwright'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { FixtureMode } from './fixtures/signals-setup-ui'

// Run: PLAYWRIGHT_CHANNEL=chrome bun scripts/test-signals-setup-ui.ts
// No live app, providers, user data, dependency installation, or persistent server.
const root = resolve(import.meta.dir, '..')
// Use the compiler dependencies owned by the app's declared Vite plugin, not hoisted root packages.
const requireTailwind = createRequire(import.meta.resolve('@tailwindcss/vite'))
const { compile } = requireTailwind('@tailwindcss/node')
const { Scanner } = requireTailwind('@tailwindcss/oxide')
const bundle = await build({
  entryPoints: [resolve(import.meta.dir, 'fixtures/signals-setup-ui.tsx')], bundle: true, write: false,
  platform: 'browser', format: 'iife', jsx: 'automatic',
  tsconfig: resolve(root, 'apps/electron/tsconfig.json'),
  // Resolve workspace source explicitly: node_modules may point to another worktree.
  alias: { '@craft-agent/shared/shared-intel': resolve(root, 'packages/shared/src/shared-intel/index.ts') },
  plugins: [{ name: 'panel-ancillary-surfaces', setup(builder) {
    const stubs: Record<string, string> = {
      '@craft-agent/ui': 'export const DocumentFormattedMarkdownOverlay = () => null',
      '@/components/info': 'import React from "react"; export const Info_Markdown = ({children}) => React.createElement("div", null, children)',
      '@/lib/navigate': 'export const navigate = () => {}; export const routes = {view:{output:id=>id}}',
      './SignalBriefingPlayer': 'export const SignalBriefingPlayer = () => null',
    }
    builder.onResolve({ filter: /^(?:@craft-agent\/ui|@\/components\/info|@\/lib\/navigate|\.\/SignalBriefingPlayer)$/ }, args => ({ path: args.path, namespace: 'fixture-stub' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture-stub' }, args => ({ contents: stubs[args.path], resolveDir: root }))
  } }],
})
const cssPath = resolve(root, 'apps/electron/src/renderer/index.css')
const compiler = await compile(await readFile(cssPath, 'utf8'), { base: dirname(cssPath), from: cssPath, onDependency: () => {} })
const css = compiler.build(new Scanner({ sources: compiler.sources }).scan())
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/fixture.js') return new Response(bundle.outputFiles[0]!.text, { headers: { 'Content-Type': 'text/javascript' } })
  if (path === '/app.css') return new Response(css, { headers: { 'Content-Type': 'text/css' } })
  if (path !== '/') return new Response('', { status: 404 })
  return new Response('<!doctype html><html lang="en" class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body style="margin:0;min-height:100vh;background:#111113;color:white"><div id="root"></div><script src="/fixture.js"></script></body></html>', { headers: { 'Content-Type': 'text/html' } })
} })
const origin = `http://127.0.0.1:${server.port}`
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let passed = 0

const track = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp('^' + name) })
const save = (page: Page, name = 'Industry') => page.getByRole('button', { name: 'Save ' + name, exact: true })
const value = (page: Page, label: string) => page.getByRole('textbox', { name: label, exact: true })
async function editName(page: Page, current: string, next: string) {
  await page.getByRole('button', { name: current, exact: true }).click()
  await value(page, 'Channel name').fill(next)
}
async function assertFrame(page: Page) {
  const result = await page.getByRole('dialog').evaluate(element => {
    const box = element.getBoundingClientRect()
    const interactive = Array.from(element.querySelectorAll('button,input,textarea,select')).filter(node => (node as HTMLElement).offsetWidth > 0)
    return { width: box.width, left: box.left, right: box.right, top: box.top, bottom: box.bottom,
      viewportWidth: innerWidth, viewportHeight: innerHeight, position: getComputedStyle(element).position,
      overflow: interactive.filter(node => { const rect = node.getBoundingClientRect(); return rect.left < box.left - 1 || rect.right > box.right + 1 }).length }
  })
  assert.equal(result.position, 'fixed', 'real dialog Tailwind styles must load')
  assert.ok(result.width > 280 && result.left >= 0 && result.right <= result.viewportWidth + 1)
  assert.ok(result.top >= 0 && result.bottom <= result.viewportHeight + 1)
  assert.equal(result.overflow, 0, 'controls must fit the dialog horizontally')
}

try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
  for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', serviceWorkers: 'block' })
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const check = async (name: string, body: () => Promise<void>, mode: FixtureMode = 'setup') => {
      errors.length = 0
      await page.goto(origin)
      await page.evaluate(mode => window.signalsSetupFixture.reset(mode), mode)
      if (mode.startsWith('panel-')) {
        await page.getByRole('region', { name: 'Signals intelligence reader' }).waitFor()
        await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent?.includes('Channels & schedule') && !button.disabled))
      } else await page.getByRole('dialog').waitFor()
      await body()
      assert.deepEqual(errors, [])
      passed++; console.log(`PASS ${viewport.name}: ${name}`)
    }
    await check('both drafts survive switching; save current only and reuse returned revision', async () => {
      await editName(page, 'Industry Briefing', 'Industry draft')
      await track(page, 'Your World').click()
      await editName(page, 'Studio Practice', 'World draft')
      await track(page, 'Industry').click()
      await page.getByRole('button', { name: 'Industry draft', exact: true }).click()
      assert.equal(await value(page, 'Channel name').inputValue(), 'Industry draft')
      await save(page).click()
      await page.getByRole('status').filter({ hasText: 'Industry saved' }).waitFor()
      let calls = await page.evaluate(() => window.signalsSetupFixture.saves)
      assert.deepEqual(calls.map(call => call.config.track), ['industry'])
      assert.equal(calls[0]!.config.revision, 'industry-initial')
      await track(page, 'Your World').click()
      await page.getByRole('button', { name: 'World draft', exact: true }).click()
      assert.equal(await value(page, 'Channel name').inputValue(), 'World draft')
      await track(page, 'Industry').click()
      await editName(page, 'Industry draft', 'Industry second draft')
      await save(page).click()
      await page.getByRole('status').filter({ hasText: 'Industry saved' }).waitFor()
      calls = await page.evaluate(() => window.signalsSetupFixture.saves)
      assert.equal(calls[1]!.config.revision, 'industry-saved-1')
      assert.deepEqual(calls.map(call => call.config.track), ['industry', 'industry'])
    })
    await check('pending URL blocks save and survives track switches', async () => {
      await value(page, 'YouTube channel URL or handle').fill('@alternate')
      await track(page, 'Your World').click(); await track(page, 'Industry').click()
      assert.equal(await value(page, 'YouTube channel URL or handle').inputValue(), '@alternate')
      await save(page).click()
      await page.getByRole('alert').filter({ hasText: 'Add or clear' }).waitFor()
      assert.equal(await page.evaluate(() => window.signalsSetupFixture.saves.length), 0)
    })
    await check('edited URL is resolved to its canonical ID without losing editorial fields', async () => {
      await editName(page, 'Industry Briefing', 'My channel label')
      await value(page, 'YouTube URL for My channel label').fill('https://www.youtube.com/@alternate')
      await value(page, 'Notes for My channel label').fill('Keep the production details.')
      await page.getByRole('combobox', { name: 'Priority for My channel label' }).selectOption('high')
      await save(page).click()
      await page.getByRole('status').filter({ hasText: 'Industry saved' }).waitFor()
      const state = await page.evaluate(() => ({ calls: window.signalsSetupFixture.saves, lookups: window.signalsSetupFixture.resolutions, expected: window.signalsSetupFixture.channels.alternate }))
      assert.deepEqual(state.lookups, ['https://www.youtube.com/@alternate'])
      assert.deepEqual(state.calls[0]!.config.sources[0], { ...state.expected, name: 'My channel label', priority: 'high', notes: 'Keep the production details.' })
    })
    await check('duplicate add and edited-URL collision cannot save duplicate canonical channels', async () => {
      await value(page, 'YouTube channel URL or handle').fill('@industry')
      await page.getByRole('button', { name: 'Add channel', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'already saved' }).waitFor()
      await value(page, 'YouTube channel URL or handle').fill('@alternate')
      await page.getByRole('button', { name: 'Add channel', exact: true }).click()
      await value(page, 'YouTube URL for Creative Process').fill('https://www.youtube.com/@industry')
      await save(page).click()
      await page.getByRole('alert').filter({ hasText: 'same YouTube channel' }).waitFor()
      assert.equal(await page.evaluate(() => window.signalsSetupFixture.saves.length), 0)
    })
    await check('dirty close sees unsaved other tab after saving current tab', async () => {
      await editName(page, 'Industry Briefing', 'Unsaved Industry')
      await track(page, 'Your World').click()
      await editName(page, 'Studio Practice', 'Saved World')
      await save(page, 'Your World').click()
      await page.getByRole('status').filter({ hasText: 'Your World saved' }).waitFor()
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await page.getByText('Discard unsaved changes?', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
      await track(page, 'Industry').click()
      await page.getByRole('button', { name: 'Unsaved Industry', exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Discard', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      assert.equal(await page.evaluate(() => window.signalsSetupFixture.closed), true)
    })
    await check('save failure retains draft and original revision for retry', async () => {
      await page.evaluate(() => { window.signalsSetupFixture.failSave = true })
      await editName(page, 'Industry Briefing', 'Retry draft')
      await save(page).click()
      await page.getByRole('alert').filter({ hasText: 'Fixture save unavailable' }).waitFor()
      assert.equal(await value(page, 'Channel name').inputValue(), 'Retry draft')
      await page.evaluate(() => { window.signalsSetupFixture.failSave = false })
      await save(page).click()
      await page.getByRole('status').filter({ hasText: 'Industry saved' }).waitFor()
      const calls = await page.evaluate(() => window.signalsSetupFixture.saves)
      assert.deepEqual(calls[0], calls[1])
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
    })
    await check('pending resolver blocks track switching, save, and close until completion', async () => {
      await page.evaluate(() => { window.signalsSetupFixture.holdResolve = true })
      await value(page, 'YouTube channel URL or handle').fill('@alternate')
      await page.getByRole('button', { name: 'Add channel', exact: true }).click()
      await page.waitForFunction(() => !!window.signalsSetupFixture.finishResolve)
      assert.equal(await track(page, 'Your World').isDisabled(), true)
      assert.equal(await save(page).isDisabled(), true)
      await page.keyboard.press('Escape')
      assert.equal(await page.evaluate(() => window.signalsSetupFixture.closed), false)
      await page.evaluate(() => window.signalsSetupFixture.finishResolve?.())
      await value(page, 'Channel name').waitFor()
      assert.equal(await value(page, 'Channel name').inputValue(), 'Creative Process')
    })
    await check('one-off rejects invalid and over-limit links without invoking provider', async () => {
      const create = page.getByRole('button', { name: 'Create report', exact: true })
      assert.equal(await create.isDisabled(), true)
      await value(page, 'YouTube video links').fill('https://example.com/watch?v=abcdefghijk')
      await page.getByRole('alert').waitFor(); assert.equal(await create.isDisabled(), true)
      await value(page, 'YouTube video links').fill(Array.from({ length: 11 }, (_, i) => 'https://youtu.be/' + String(i).padStart(11, '0')).join('\n'))
      assert.equal(await create.isDisabled(), true)
      assert.equal(await page.evaluate(() => window.signalsSetupFixture.analyses.length), 0)
    }, 'links')
    await check('one-off retry keeps key for same canonical input and changes key for new video', async () => {
      const input = value(page, 'YouTube video links')
      const create = page.getByRole('button', { name: 'Create report', exact: true })
      await input.fill('https://youtu.be/abcdefghijk')
      await create.click(); await page.getByRole('alert').waitFor()
      await input.fill('https://www.youtube.com/watch?v=abcdefghijk')
      await create.click(); await page.getByRole('alert').waitFor()
      let calls = await page.evaluate(() => window.signalsSetupFixture.analyses)
      assert.equal(calls.length, 2); assert.ok(calls[0]!.key); assert.equal(calls[0]!.key, calls[1]!.key)
      await input.fill('https://youtu.be/lmnopqrstuv')
      await create.click(); await page.getByRole('alert').waitFor()
      calls = await page.evaluate(() => window.signalsSetupFixture.analyses)
      assert.notEqual(calls[2]!.key, calls[1]!.key)
      await page.evaluate(() => { window.signalsSetupFixture.failAnalyze = false })
      await create.click(); await page.getByRole('dialog').waitFor({ state: 'hidden' })
      calls = await page.evaluate(() => window.signalsSetupFixture.analyses)
      assert.equal(calls[3]!.key, calls[2]!.key)
      assert.equal(await page.evaluate(() => window.signalsSetupFixture.saves.length), 0)
    }, 'links')
    await check('real styled settings fit viewport with expanded channel and persistent actions', async () => {
      await track(page, 'Your World').click()
      await page.getByRole('button', { name: 'Studio Practice', exact: true }).click()
      await value(page, 'Notes for Studio Practice').fill('Production choices, audience connection, and sustainable studio routines.')
      await assertFrame(page)
      const button = await save(page, 'Your World').boundingBox()
      assert.ok(button && button.y >= 0 && button.y + button.height <= viewport.height)
      await page.screenshot({ path: viewport.name === 'desktop' ? '/tmp/signals-ux-settings.png' : '/tmp/signals-ux-settings-mobile.png' })
    })
    await check('zero-channel settings preserve Industry weekly scans but disable Your World scans', async () => {
      await page.getByRole('button', { name: 'Industry Briefing', exact: true }).click()
      await page.getByRole('button', { name: 'Remove Industry Briefing', exact: true }).click()
      assert.equal(await page.getByRole('switch').isEnabled(), true)
      await save(page).click()
      await page.getByRole('status').filter({ hasText: 'Industry saved' }).waitFor()
      await track(page, 'Your World').click()
      await page.getByRole('button', { name: 'Studio Practice', exact: true }).click()
      await page.getByRole('button', { name: 'Remove Studio Practice', exact: true }).click()
      assert.equal(await page.getByRole('switch').isDisabled(), true)
      await save(page, 'Your World').click()
      await page.getByRole('status').filter({ hasText: 'Your World saved' }).waitFor()
      const calls = await page.evaluate(() => window.signalsSetupFixture.saves)
      assert.deepEqual(calls.map(call => [call.config.track, call.config.sources.length, call.config.enabled, call.config.cadence]), [
        ['industry', 0, true, 'weekly'], ['your-world', 0, false, 'manual'],
      ])
    })
    await check('empty panel has a clear report state, Saved insights and back, and no page weekly toggle', async () => {
      await page.getByText('No Industry reports yet', { exact: true }).waitFor()
      await page.getByText('1 channel', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Create first report', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Choose channels', exact: true }).count(), 0)
      assert.equal(await page.getByRole('combobox').count(), 0)
      assert.equal(await page.getByRole('checkbox').count(), 0)
      assert.equal(await page.getByRole('switch').count(), 0)
      await page.getByRole('button', { name: 'Saved insights', exact: true }).click()
      await page.getByText('No saved insights yet', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Back to reports', exact: true }).click()
      await page.getByText('No Industry reports yet', { exact: true }).waitFor()
      if (viewport.name === 'desktop') await page.screenshot({ path: '/tmp/signals-ux-page.png' })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await page.getByRole('button', { name: 'Create first report', exact: true }).click()
      await page.waitForFunction(() => window.signalsSetupFixture.starts.length === 1)
      assert.deepEqual(await page.evaluate(() => window.signalsSetupFixture.starts.map(call => [call.track, call.mode])), [['industry', 'scan']])
    }, 'panel-empty')
    for (const mode of ['panel-empty', 'panel-legacy'] as const) await check(`${mode}: shared settings opens both tracks without invoking old settings`, async () => {
      if (mode === 'panel-legacy') await page.getByRole('button', { name: 'Choose channels', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Channels & schedule', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('heading', { name: 'Channels & schedule' }).waitFor()
      await dialog.getByRole('tab', { name: 'Your World', exact: true }).click()
      await dialog.getByRole('button', { name: 'Studio Practice', exact: true }).waitFor()
      await dialog.getByRole('tab', { name: 'Industry', exact: true }).click()
      await dialog.getByRole('button', { name: 'Industry Briefing', exact: true }).waitFor()
      if (mode === 'panel-legacy') await dialog.getByText('Save to update your existing scan.', { exact: false }).waitFor()
      assert.equal(await page.evaluate(() => window.signalsSetupFixture.legacyConfigureCalls), 0)
    }, mode)
    await check('panel one-off routes each track without saving channels or schedule', async () => {
      for (const name of ['Industry', 'Your World']) {
        await track(page, name).click()
        await page.getByRole('button', { name: 'Review videos', exact: true }).click()
        await page.getByText(`A one-off ${name} report. Your channels and schedule stay unchanged.`, { exact: true }).waitFor()
        await value(page, 'YouTube video links').fill('https://youtu.be/abcdefghijk')
        await page.getByRole('button', { name: 'Create report', exact: true }).click()
        await page.getByRole('dialog').waitFor({ state: 'hidden' })
      }
      const calls = await page.evaluate(() => ({ starts: window.signalsSetupFixture.starts, writes: window.signalsSetupFixture.configWrites }))
      assert.deepEqual(calls.starts.map(call => [call.track, call.mode, call.links]), [
        ['industry', 'links', ['https://youtu.be/abcdefghijk']], ['your-world', 'links', ['https://youtu.be/abcdefghijk']],
      ])
      assert.equal(calls.writes, 0)
    }, 'panel-empty')
    for (const mode of ['panel-one', 'panel-two'] as const) await check(`${mode}: report selector exists only for multiple reports`, async () => {
      await page.getByRole('heading', { name: 'Independent release research', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Read full report', exact: true }).waitFor()
      assert.equal(await page.getByRole('combobox', { name: 'Industry report library' }).count(), mode === 'panel-two' ? 1 : 0)
      if (mode === 'panel-two') {
        assert.equal(await page.getByRole('combobox').locator('option').count(), 2)
        await page.getByRole('combobox').selectOption('output:fixture-report-1')
        await page.getByRole('heading', { name: 'Earlier industry research', exact: true }).waitFor()
      }
    }, mode)
    await check('failed legacy provider lookup can pause exact existing schedule without migration or losing drafts', async () => {
      await page.getByRole('button', { name: 'Channels & schedule', exact: true }).click()
      await editName(page, 'Industry Briefing', 'Unsaved legacy edit')
      await value(page, 'Notes for Unsaved legacy edit').fill('Keep these notes after pausing.')
      await page.evaluate(() => { window.signalsSetupFixture.failResolve = true })
      await save(page).click()
      await page.getByRole('alert').filter({ hasText: 'Fixture channel provider unavailable' }).waitFor()
      await page.getByRole('button', { name: 'Pause existing weekly scan', exact: true }).click()
      await page.getByRole('status').filter({ hasText: 'Existing weekly scan paused' }).waitFor()
      assert.equal(await value(page, 'Channel name').inputValue(), 'Unsaved legacy edit')
      assert.equal(await value(page, 'Notes for Unsaved legacy edit').inputValue(), 'Keep these notes after pausing.')
      assert.equal(await page.getByRole('switch').getAttribute('aria-checked'), 'false')
      const state = await page.evaluate(() => ({ writes: window.signalsSetupFixture.configWrites, lookups: window.signalsSetupFixture.resolutions,
        workflows: window.signalsSetupFixture.workflowChecks, replacements: window.signalsSetupFixture.replacements }))
      assert.equal(state.writes, 0); assert.equal(state.workflows, 0); assert.equal(state.lookups.length, 1)
      assert.equal(state.replacements.length, 1)
      const change = state.replacements[0]!
      assert.deepEqual([change.workspace, change.event, change.id], ['fixture-hq', 'SchedulerTick', 'legacy-weekly'])
      assert.deepEqual(change.after, { ...change.before, enabled: false })
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await page.getByText('Discard unsaved changes?', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
      await page.evaluate(() => { window.signalsSetupFixture.failResolve = false })
      await page.getByRole('switch').click()
      await save(page).click()
      await page.getByRole('status').filter({ hasText: 'Industry saved' }).waitFor()
      assert.equal(await page.getByRole('status').filter({ hasText: 'Existing weekly scan paused' }).count(), 0)
      assert.equal(await page.getByRole('switch').getAttribute('aria-checked'), 'true')
      const resumed = await page.evaluate(() => ({ writes: window.signalsSetupFixture.configWrites, changes: window.signalsSetupFixture.replacements }))
      assert.equal(resumed.writes, 1)
      assert.equal(resumed.changes.length, 2)
      assert.equal(resumed.changes[1]!.after.enabled, true)
      await page.getByRole('button', { name: 'Unsaved legacy edit', exact: true }).click()
      assert.equal(await value(page, 'Notes for Unsaved legacy edit').inputValue(), 'Keep these notes after pausing.')
    }, 'panel-legacy')
    await check('removed legacy schedule rejects pause without a false success or lost edits', async () => {
      await page.getByRole('button', { name: 'Channels & schedule', exact: true }).click()
      await editName(page, 'Industry Briefing', 'Keep this draft')
      await page.evaluate(() => { window.signalsSetupFixture.failResolve = true })
      await save(page).click()
      await page.getByRole('alert').filter({ hasText: 'Fixture channel provider unavailable' }).waitFor()
      await page.evaluate(() => window.signalsSetupFixture.removeLegacySchedule())
      await page.getByRole('button', { name: 'Pause existing weekly scan', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'The schedule changed' }).waitFor()
      assert.equal(await page.getByRole('status').filter({ hasText: 'Existing weekly scan paused' }).count(), 0)
      assert.equal(await value(page, 'Channel name').inputValue(), 'Keep this draft')
      assert.equal(await page.getByRole('switch').getAttribute('aria-checked'), 'true')
      assert.deepEqual(await page.evaluate(() => [window.signalsSetupFixture.configWrites, window.signalsSetupFixture.replacements.length, window.signalsSetupFixture.resolutions.length]), [0, 0, 1])
    }, 'panel-legacy')
    await check('malformed legacy Industry blocks only Industry; Your World saves normally', async () => {
      await page.getByRole('button', { name: 'Channels & schedule', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'Industry settings are unreadable' }).waitFor()
      assert.equal(await save(page).isDisabled(), true)
      await page.getByRole('dialog').getByRole('tab', { name: 'Your World', exact: true }).click()
      await editName(page, 'Studio Practice', 'World remains editable')
      await save(page, 'Your World').click()
      await page.getByRole('status').filter({ hasText: 'Your World saved' }).waitFor()
      const state = await page.evaluate(() => ({ writes: window.signalsSetupFixture.configWrites, lookups: window.signalsSetupFixture.resolutions.length, replacements: window.signalsSetupFixture.replacements.length }))
      assert.deepEqual(state, { writes: 1, lookups: 0, replacements: 0 })
    }, 'panel-malformed')
    await check('zero-channel panel can scan website-capable Industry but not Your World', async () => {
      const scan = page.getByRole('button', { name: 'Scan now', exact: true })
      assert.equal(await scan.isEnabled(), true)
      await scan.click()
      await page.waitForFunction(() => window.signalsSetupFixture.starts.length === 1)
      await track(page, 'Your World').click()
      assert.equal(await scan.isDisabled(), true)
      await page.getByRole('button', { name: 'Choose channels', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Create first report', exact: true }).count(), 0)
      assert.deepEqual(await page.evaluate(() => window.signalsSetupFixture.starts.map(call => [call.track, call.mode])), [['industry', 'scan']])
    }, 'panel-zero-channels')
    await context.close()
  }
  console.log(`${passed} Signals setup browser checks passed; screenshots: /tmp/signals-ux-settings.png, /tmp/signals-ux-settings-mobile.png, /tmp/signals-ux-page.png`)
} finally {
  await browser?.close()
  server.stop(true)
}
