import { build } from 'esbuild'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

// Real React components, isolated fake RPC: no app startup, profile, or provider calls.
const bundle = await build({
  entryPoints: [resolve(import.meta.dir, 'fixtures/skill-preferences-ui.tsx')], bundle: true, write: false,
  platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: resolve(import.meta.dir, '../apps/electron/tsconfig.json'),
  plugins: [{ name: 'navigation-stub', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/navigate$/ }, () => ({ path: 'navigation', namespace: 'test' }))
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const navigate=x=>{window.navigation=x}; export const routes={view:{skills:()=>"skills"}}' }))
  } }],
})
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => void dialog.accept())
  const check = async (name: string, body: () => Promise<void>) => {
    await page.goto('about:blank'); await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
    await body(); assert.deepEqual(errors, []); passed++; console.log(`PASS ${name}`)
  }
  await check('shared and workspace drafts save only to selected scope', async () => {
    await page.evaluate(() => (window as any).renderPreferences())
    await page.getByRole('textbox', { name: 'Personal instructions', exact: true }).fill('Updated shared')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => (window as any).records[0].text === 'Updated shared')
    await page.getByRole('combobox').selectOption('workspace')
    await page.waitForFunction(() => (document.querySelector('textarea') as HTMLTextAreaElement)?.value === '')
    await page.getByRole('textbox', { name: 'Personal instructions', exact: true }).fill('Campaign preference')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => (window as any).records.length === 2)
    assert.deepEqual(await page.evaluate(() => (window as any).calls.map((call: any) => call.scope)), ['shared', 'workspace'])
  })
  await check('pending save locks scope, draft and import actions', async () => {
    await page.evaluate(() => { (window as any).holdSave = true; (window as any).renderPreferences() })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => !!(window as any).releaseSave)
    assert.equal(await page.getByRole('combobox').isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Import personal instructions', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('textbox', { name: 'Personal instructions', exact: true }).isDisabled(), true)
    await page.evaluate(() => (window as any).releaseSave())
    await page.getByRole('button', { name: 'Save', exact: true }).waitFor()
  })
  await check('empty save removes extension without disabling built-in', async () => {
    await page.evaluate(() => (window as any).renderPreferences())
    await page.getByRole('textbox', { name: 'Personal instructions', exact: true }).fill('')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => (window as any).records.length === 0)
    assert.equal(await page.getByLabel('Enabled', { exact: true }).isEnabled(), true)
  })
  await check('missing parent retains text but prevents enabling and saving', async () => {
    await page.evaluate(() => (window as any).renderPreferences(false))
    await page.getByText('This built-in is no longer available.', { exact: false }).waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'Personal instructions', exact: true }).inputValue(), 'Shared preference')
    assert.equal(await page.getByRole('textbox', { name: 'Personal instructions', exact: true }).getAttribute('readonly'), '')
    assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true)
    assert.equal(await page.getByLabel('Enabled', { exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.waitForFunction(() => (window as any).navigation === 'skills')
  })
  await check('load failure can retry without losing stored preferences', async () => {
    await page.evaluate(() => { (window as any).failLoad = true; (window as any).renderPreferences() })
    await page.getByText('Could not load personal instructions.').waitFor()
    await page.evaluate(() => { (window as any).failLoad = false })
    await page.getByRole('button', { name: 'Retry' }).click()
    await page.waitForFunction(() => (document.querySelector('textarea') as HTMLTextAreaElement)?.value === 'Shared preference')
  })
  await check('library import retains draft on failure and permits retry for missing parent', async () => {
    await page.evaluate(() => { (window as any).failImport = true; (window as any).renderImport() })
    await page.getByRole('button', { name: 'Import preferences' }).click()
    const payload = JSON.stringify({ parentManagedId: 'artist-os:skill:retired', text: 'My preferences' })
    await page.getByLabel('Exported personal instructions').fill(payload)
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert.equal(await page.getByLabel('Exported personal instructions').inputValue(), payload)
    await page.evaluate(() => { (window as any).failImport = false })
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => (window as any).calls.length), 2)
  })
  console.log(`${passed} skill preferences browser checks passed.`)
} finally { await browser.close() }
