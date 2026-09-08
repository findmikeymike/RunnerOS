import { build } from 'esbuild'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

// Real React components in Chromium, isolated from the live app and providers.
const bundle = await build({
  entryPoints: [resolve(import.meta.dir, 'fixtures/signals-ui.tsx')], bundle: true, write: false,
  platform: 'browser', format: 'iife', jsx: 'automatic',
  tsconfig: resolve(import.meta.dir, '../apps/electron/tsconfig.json'),
  plugins: [{ name: 'navigation-stub', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/navigate$/ }, () => ({ path: 'navigation', namespace: 'test' }))
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const navigate=()=>{}; export const routes={view:{allSessions:x=>x}}' }))
  } }],
})
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const reset = async () => {
    await page.goto('about:blank')
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
  }
  const check = async (name: string, body: () => Promise<void>) => {
    await reset(); await body(); assert.deepEqual(errors, []); passed++; console.log(`PASS ${name}`)
  }
  await check('ordinary chat stays free of Signals UI on missing RPC', async () => {
    await page.evaluate(() => { const w = window as any; w.lookup = 'error'; w.renderNotice() })
    await page.waitForFunction(() => (window as any).guarded === true)
    assert.equal(await page.locator('[aria-label="Signal draft source"]').count(), 0)
  })
  await check('confirmed source retains errors until lookup recovers', async () => {
    await page.evaluate(() => (window as any).renderNotice())
    await page.getByText('Review source', { exact: true }).waitFor()
    await page.evaluate(() => { const w = window as any; w.lookup = 'error'; w.poll() })
    await page.getByRole('alert').waitFor()
    await page.evaluate(() => { const w = window as any; w.lookup = 'attached'; w.poll() })
    await page.getByRole('alert').waitFor({ state: 'detached' })
  })
  await check('poll success does not erase an action failure', async () => {
    await page.evaluate(() => (window as any).renderNotice())
    await page.getByText('Review source', { exact: true }).click()
    await page.getByRole('alert').waitFor()
    await page.evaluate(() => (window as any).poll())
    await page.waitForTimeout(50)
    assert.equal(await page.getByRole('alert').innerText(), 'Unavailable')
  })
  await check('processing changes preserve detach review and disable action', async () => {
    await page.evaluate(() => (window as any).renderNotice())
    await page.getByText('Detach source', { exact: true }).click()
    await page.getByRole('checkbox').check()
    await page.evaluate(() => (window as any).renderNotice('chat', true))
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Detach and keep reviewed draft' && button.disabled))
    assert.equal(await page.getByRole('checkbox').isChecked(), true)
    assert.equal(await page.getByText('Detach and keep reviewed draft').isDisabled(), true)
    await page.evaluate(() => (window as any).renderNotice('chat', false))
    await page.getByText('Detach and keep reviewed draft').click()
    await page.locator('[aria-label="Signal draft source"]').waitFor({ state: 'detached' })
  })
  await check('switching chats removes old source UI', async () => {
    await page.evaluate(() => (window as any).renderNotice())
    await page.getByText('Review source', { exact: true }).waitFor()
    await page.evaluate(() => { const w = window as any; w.lookup = 'empty'; w.renderNotice('other') })
    await page.locator('[aria-label="Signal draft source"]').waitFor({ state: 'detached' })
  })
  await check('late lookup cannot attach the previous chat source', async () => {
    await page.evaluate(() => { const w = window as any; w.lookup = 'pending'; w.renderNotice() })
    await page.waitForFunction(() => !!(window as any).resolveLookup)
    await page.evaluate(() => { const w = window as any; w.lookup = 'empty'; w.renderNotice('other') })
    await page.waitForFunction(() => (window as any).guarded === false)
    await page.evaluate(() => { const w = window as any; w.resolveLookup(w.reference) })
    await page.waitForTimeout(50)
    assert.equal(await page.locator('[aria-label="Signal draft source"]').count(), 0)
  })
  await check('failed detach retains reviewed draft and can be retried', async () => {
    await page.evaluate(() => { const w = window as any; w.failDetach = true; w.renderNotice() })
    await page.getByText('Detach source', { exact: true }).click()
    await page.getByRole('checkbox').check()
    await page.getByText('Detach and keep reviewed draft').click()
    await page.getByRole('alert').waitFor()
    await page.evaluate(() => (window as any).poll())
    await page.waitForTimeout(50)
    assert.equal(await page.getByRole('alert').innerText(), 'Could not detach')
    assert.equal(await page.getByRole('checkbox').isChecked(), true)
    await page.evaluate(() => { (window as any).failDetach = false })
    await page.getByText('Detach and keep reviewed draft').click()
    await page.locator('[aria-label="Signal draft source"]').waitFor({ state: 'detached' })
  })
  await check('failed idea lookup retries and restores develop action', async () => {
    await page.evaluate(() => (window as any).renderIdeas())
    await page.getByRole('alert').waitFor()
    await page.evaluate(() => { (window as any).ideaResult = 'success' })
    await page.getByRole('button', { name: 'Retry' }).click()
    await page.getByRole('button', { name: 'Develop this idea: A useful idea' }).click()
    assert.equal(await page.evaluate(() => (window as any).developed), true)
  })
  await check('refused idea result is not mistaken for empty report', async () => {
    await page.evaluate(() => { const w = window as any; w.ideaResult = 'refused'; w.renderIdeas() })
    await page.getByRole('alert').waitFor()
    await page.evaluate(() => { (window as any).ideaResult = 'empty' })
    await page.getByRole('button', { name: 'Retry' }).click()
    await page.getByRole('alert').waitFor({ state: 'detached' })
    assert.equal(await page.locator('button').count(), 0)
  })
  await check('workspace events cannot refresh a half-finished mutation', async () => {
    await page.evaluate(() => (window as any).renderTracks())
    await page.getByRole('button', { name: 'hq: Ready' }).click()
    await page.getByRole('button', { name: 'hq: Busy' }).waitFor()
    const reads = await page.evaluate(() => (window as any).stateReads)
    await page.evaluate(() => { const w = window as any; w.contextChanged('hq'); w.automationsChanged(); w.poll() })
    await page.waitForTimeout(50)
    assert.equal(await page.evaluate(() => (window as any).stateReads), reads)
    await page.evaluate(() => (window as any).finishResearch({ runId: 'test' }))
    await page.getByRole('button', { name: 'hq: Ready' }).waitFor()
    assert.equal(await page.evaluate(() => (window as any).stateReads), reads + 1)
  })
  await check('switching workspaces during a mutation leaves new workspace usable', async () => {
    await page.evaluate(() => (window as any).renderTracks())
    await page.getByRole('button', { name: 'hq: Ready' }).click()
    await page.getByRole('button', { name: 'hq: Busy' }).waitFor()
    await page.evaluate(() => (window as any).renderTracks('other'))
    await page.getByRole('button', { name: 'other: Ready' }).waitFor()
    await page.evaluate(() => (window as any).finishResearch({ runId: 'test' }))
    await page.waitForTimeout(50)
    assert.equal(await page.getByRole('button', { name: 'other: Ready' }).isEnabled(), true)
  })
  console.log(`${passed} Signals browser regression checks passed.`)
} finally { await browser.close() }
