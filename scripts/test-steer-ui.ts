import { build } from 'esbuild'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'

// Exercise the real composer and height container without an app or provider call.
const bundle = await build({
  entryPoints: [resolve(import.meta.dir, 'fixtures/steer-ui.tsx')], bundle: true, write: false,
  platform: 'browser', format: 'iife', jsx: 'automatic',
  loader: { '.svg': 'dataurl', '.css': 'empty' },
  banner: { js: 'var __testGlob = () => ({});' },
  tsconfig: resolve(import.meta.dir, '../apps/electron/tsconfig.json'),
  define: { 'import.meta.env': JSON.stringify({ VITE_CRAFT_PRODUCT_VARIANT: 'artist-os' }), 'import.meta.glob': '__testGlob' },
  plugins: [{ name: 'unrelated-dialogs', setup(builder) {
    builder.onResolve({ filter: /\?url$/ }, () => ({ path: 'asset', namespace: 'asset' }))
    builder.onLoad({ filter: /.*/, namespace: 'asset' }, () => ({ contents: 'export default ""' }))
    builder.onResolve({ filter: /^@\/components\/ui\/EditPopover$/ }, () => ({ path: 'edit', namespace: 'test' }))
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const EditPopover=()=>null; export const getEditConfig=()=>({})' }))
  } }],
})
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const assets = resolve(process.env.STEER_UI_RENDERER_DIR ?? resolve(import.meta.dir, '../apps/electron/dist/renderer'), 'assets')
  const css = readdirSync(assets).filter(name => /^index-.*\.css$/.test(name))
    .map(name => readFileSync(resolve(assets, name), 'utf8')).join('\n')
  assert.ok(css, 'Build the renderer before running the browser checks')
  let passed = 0
  const reset = async (options = {}, sendKey = 'enter') => {
    await page.goto('about:blank')
    await page.setViewportSize({ width: 960, height: 700 })
    await page.setContent('<html class="dark"><body style="background:#08090b;padding:24px"><div id="root"></div></body></html>')
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
    await page.evaluate(({ options, sendKey }) => { const w = window as any; w.sendKey = sendKey; w.renderInput(options) }, { options, sendKey })
    await page.getByRole('textbox').waitFor()
  }
  const input = page.getByRole('textbox')
  const send = page.getByRole('button', { name: 'Send update', exact: true })
  const stop = page.getByRole('button', { name: 'Stop response', exact: true })
  const check = async (name: string, body: () => Promise<void>) => {
    await body(); assert.deepEqual(errors, []); passed++; console.log(`PASS ${name}`)
  }
  await check('working composer exposes Send update and a separate Stop', async () => {
    await reset()
    assert.equal(await send.count(), 1)
    assert.equal(await send.isDisabled(), true)
    assert.equal(await stop.isEnabled(), true)
    assert.equal(await input.getAttribute('aria-placeholder'), 'Send an update while the agent works…')
    await input.fill('Use the acoustic version')
    await send.click()
    assert.deepEqual(await page.evaluate(() => (window as any).sent), ['Use the acoustic version'])
    assert.equal(await page.evaluate(() => (window as any).stops), 0)
    assert.equal((await input.innerText()).trim(), '')
  })
  await check('Enter sends successive updates without stopping', async () => {
    await reset()
    for (const message of ['Keep the intro', 'Make it shorter']) {
      await input.fill(message)
      await input.press('Enter')
    }
    assert.deepEqual(await page.evaluate(() => (window as any).sent), ['Keep the intro', 'Make it shorter'])
    assert.equal(await page.evaluate(() => (window as any).stops), 0)
  })
  await check('narrow and popover-sized composers keep their input and actions visible', async () => {
    for (const width of [600, 360]) {
      await reset({ compactMode: true })
      await page.setViewportSize({ width, height: 700 })
      await page.waitForFunction(() => {
        const element = document.querySelector('[role="textbox"]')!
        const editor = element.getBoundingClientRect()
        const container = document.querySelector('.input-container')!.getBoundingClientRect()
        // The border can overlap the editor's padding by a pixel; its text must stay visible.
        const textTop = editor.y + parseFloat(getComputedStyle(element).paddingTop)
        return editor.height >= 40 && textTop >= container.y && editor.bottom <= container.bottom
      }).catch(async error => {
        console.log(await page.evaluate(() => {
          const editor = document.querySelector('[role="textbox"]')!
          const container = document.querySelector('.input-container')!
          return { editor: editor.getBoundingClientRect().toJSON(), container: container.getBoundingClientRect().toJSON(), height: getComputedStyle(editor).minHeight }
        }))
        await page.screenshot({ path: '/tmp/artist-os-steer-layout.png' })
        throw error
      })
      await input.fill('Change the release date')
      await send.click()
      assert.deepEqual(await page.evaluate(() => (window as any).sent), ['Change the release date'])
      assert.equal(await stop.isVisible(), true)
    }
  })
  await check('starting and finishing work preserves a focused compact draft', async () => {
    await reset({ compactMode: true, isProcessing: false })
    await input.fill('A correction in progress')
    await input.focus()
    await page.evaluate(() => (window as any).renderInput({ compactMode: true, isProcessing: true }))
    await send.waitFor()
    assert.equal(await input.innerText(), 'A correction in progress')
    assert.equal(await input.evaluate(node => node === document.activeElement), true)
    await page.evaluate(() => (window as any).renderInput({ compactMode: true, isProcessing: false }))
    await page.getByRole('button', { name: 'Send message', exact: true }).waitFor()
    assert.equal(await input.innerText(), 'A correction in progress')
    assert.equal(await stop.count(), 0)
  })
  await check('Stop never submits or discards the draft', async () => {
    await reset({ compactMode: true })
    await input.fill('Save this correction')
    await stop.click()
    assert.equal(await page.evaluate(() => (window as any).stops), 1)
    assert.deepEqual(await page.evaluate(() => (window as any).sent), [])
    assert.equal(await input.innerText(), 'Save this correction')
  })
  await check('send guards still block both button and keyboard while Stop remains usable', async () => {
    for (const guard of ['disabled', 'disableSend']) {
      await reset({ [guard]: true, inputValue: 'Do not send', compactMode: true })
      assert.equal(await send.isDisabled(), true)
      await input.press('Enter')
      assert.deepEqual(await page.evaluate(() => (window as any).sent), [])
      await stop.click()
      assert.equal(await page.evaluate(() => (window as any).stops), 1)
    }
  })
  await check('multiline and configured send shortcuts still work during processing', async () => {
    await reset()
    await input.fill('First line')
    await input.press('Shift+Enter')
    await input.pressSequentially('Second line')
    assert.deepEqual(await page.evaluate(() => (window as any).sent), [])
    await send.click()
    assert.match((await page.evaluate(() => (window as any).sent))[0], /First line\nSecond line/)
    await reset({}, 'cmd-enter')
    await input.fill('Another update')
    await input.press('Enter')
    assert.deepEqual(await page.evaluate(() => (window as any).sent), [])
    await input.press('Control+Enter')
    assert.equal((await page.evaluate(() => (window as any).sent))[0].trim(), 'Another update')
  })
  console.log(`${passed} steering browser regression checks passed.`)
} finally { await browser.close() }
