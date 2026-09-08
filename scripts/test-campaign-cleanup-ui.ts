import { build } from 'esbuild'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const bundle = await build({
  entryPoints: [resolve(import.meta.dir, 'fixtures/campaign-cleanup-ui.tsx')],
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  tsconfig: resolve(import.meta.dir, '../apps/electron/tsconfig.json'),
  loader: { '.svg': 'dataurl', '.css': 'empty' },
  define: { 'import.meta.env': JSON.stringify({ VITE_CRAFT_PRODUCT_VARIANT: 'artist-os' }) },
  plugins: [{ name: 'unrelated-workspace-creation', setup(builder) {
    builder.onResolve({ filter: /\?url$/ }, () => ({ path: 'asset', namespace: 'asset' }))
    builder.onLoad({ filter: /.*/, namespace: 'asset' }, () => ({ contents: 'export default ""' }))
    builder.onResolve({ filter: /SocialVariantSetupDrawer$/ }, () => ({ path: 'variants', namespace: 'variants' }))
    builder.onLoad({ filter: /.*/, namespace: 'variants' }, () => ({ contents: 'export const SocialVariantSetupDrawer=()=>null' }))
    builder.onResolve({ filter: /^@\/components\/workspace$/ }, () => ({ path: 'creation', namespace: 'test' }))
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const WorkspaceCreationScreen=()=>null' }))
  } }],
})
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 720 } })
  page.setDefaultTimeout(5000)
  const errors: string[] = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  const assets = resolve(process.env.CAMPAIGN_UI_RENDERER_DIR ?? resolve(import.meta.dir, '../apps/electron/dist/renderer'), 'assets')
  const css = readdirSync(assets).filter(name => /^index-.*\.css$/.test(name))
    .map(name => readFileSync(resolve(assets, name), 'utf8')).join('\n')
  const reset = async (options = {}) => {
    await page.goto('about:blank')
    await page.setContent('<html class="dark"><body style="background:#09090c"><div id="root"></div></body></html>')
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
    await page.evaluate(options => Object.assign(window, options), options)
    await page.getByRole('button', { name: 'Delete campaign', exact: true }).click()
  }
  const confirm = page.getByRole('button', { name: 'Keep files & delete campaign', exact: true })
  let passed = 0
  const check = async (name: string, fn: () => Promise<void>) => {
    await fn(); assert.deepEqual(errors, []); passed++; console.log(`PASS ${name}`)
  }
  await check('opening only previews; explicit keep/delete explanation and file review', async () => {
    await reset()
    await confirm.waitFor()
    await page.getByText('Review files being kept').click()
    await page.getByText('assets/master.wav', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => (window as any).calls), [['preview', 'summer']])
    await page.getByText('Permanently delete', { exact: true }).waitFor()
  })
  await check('Cancel never deletes', async () => {
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await page.evaluate(() => (window as any).calls.filter((c: string[]) => c[0] === 'delete').length), 0)
  })
  await check('confirmation submits reviewed token once and prevents dismissal during deletion', async () => {
    await reset({ delayDelete: true })
    await confirm.click()
    const busy = page.getByRole('button', { name: 'Saving files and deleting…' })
    assert.equal(await busy.isDisabled(), true)
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 1)
    assert.deepEqual(await page.evaluate(() => (window as any).calls), [['preview', 'summer'], ['delete', 'summer', 'reviewed-inventory']])
    await page.evaluate(() => (window as any).finishDelete())
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => (window as any).deleted.length), 1)
  })
  await check('blocked preview disables confirmation and can be checked again', async () => {
    await reset({ failPreview: true })
    await page.getByRole('alert').waitFor()
    assert.equal(await confirm.isDisabled(), true)
    await page.evaluate(() => { (window as any).failPreview = false })
    await page.getByRole('button', { name: 'Check again' }).click()
    await page.waitForFunction(() => document.querySelector('[role="alert"]') === null)
    assert.equal(await confirm.isEnabled(), true)
  })
  await check('stale or failed delete requires a new preview', async () => {
    await reset({ failDelete: true })
    await confirm.click()
    await page.getByRole('alert').waitFor()
    assert.equal(await confirm.isDisabled(), true)
    assert.equal(await page.evaluate(() => (window as any).deleted.length), 0)
    await page.getByRole('button', { name: 'Check again' }).click()
    await page.waitForFunction(() => (window as any).calls.filter((c: string[]) => c[0] === 'preview').length === 2)
  })
  await check('narrow dialog stays within viewport', async () => {
    await reset()
    await page.setViewportSize({ width: 390, height: 650 })
    await page.waitForTimeout(200)
    const box = await page.getByRole('dialog').boundingBox()
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 650)
    await page.screenshot({ path: '/tmp/artist-os-campaign-cleanup-dialog.png' })
  })
  await check('actual Campaigns menu exposes deletion for campaigns only', async () => {
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.evaluate(() => (window as any).renderRail())
    await page.getByRole('button', { name: 'Campaigns' }).click()
    await page.getByRole('menuitem', { name: 'Delete current campaign…' }).click()
    await page.getByRole('dialog', { name: 'Delete “Summer EP”?' }).waitFor()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.evaluate(() => (window as any).renderRail('hq'))
    await page.getByRole('button', { name: 'Campaigns' }).click()
    assert.equal(await page.getByRole('menuitem', { name: 'Delete current campaign…' }).count(), 0)
    await page.keyboard.press('Escape')
  })
  await check('Past Releases shows kept files across categories and filters by release', async () => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.evaluate(() => (window as any).renderVault())
    await page.getByRole('button', { name: 'Past Releases', exact: true }).click()
    await page.getByText('Summer cover', { exact: true }).waitFor()
    await page.getByText('Winter video', { exact: true }).waitFor()
    assert.equal(await page.getByText('New demo', { exact: true }).count(), 0)
    await page.getByLabel('Release', { exact: true }).selectOption('summer')
    assert.equal(await page.getByText('Winter video', { exact: true }).count(), 0)
    await page.getByText('Summer master', { exact: true }).waitFor()
    await page.getByText('Summer cover', { exact: true }).waitFor()
  })
  console.log(`${passed} campaign cleanup browser checks passed.`)
} finally { await browser.close() }
