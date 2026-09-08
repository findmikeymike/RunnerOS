import { build } from 'esbuild'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { STARTER_AGENTS } from '../packages/shared/src/agent-definitions/starter-templates'

// Isolated actual React components + production CSS. Never connects to the app/providers.
const root = resolve(import.meta.dir, '..')
const modes = STARTER_AGENTS.find(agent => agent.slug === 'branding-agent')!.metadata.taskModes!
const html = await readFile(resolve(root, 'apps/electron/dist/renderer/index.html'), 'utf8')
const cssPaths = [...html.matchAll(/href="\.\/([^"\s]+\.css)"/g)].map(match => match[1]!)
assert.ok(cssPaths.length, 'Build the production renderer before running this check')
const styles = (await Promise.all(cssPaths.map(path => readFile(resolve(root, 'apps/electron/dist/renderer', path), 'utf8')))).join('\n')
const bundle = await build({
  entryPoints: [resolve(import.meta.dir, 'fixtures/task-mode-header-ui.tsx')],
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  loader: { '.css': 'empty' },
  tsconfig: resolve(root, 'apps/electron/tsconfig.json'),
  plugins: [{ name: 'header-ui-exports', setup(builder) {
    // Use the actual shared header primitives without bundling unrelated PDF/media viewers.
    builder.onResolve({ filter: /^@craft-agent\/ui$/ }, () => ({ path: 'header-ui', namespace: 'header-ui' }))
    builder.onLoad({ filter: /.*/, namespace: 'header-ui' }, () => ({
      contents: `export * from ${JSON.stringify(resolve(root, 'packages/ui/src/components/tooltip.tsx'))}; export * from ${JSON.stringify(resolve(root, 'packages/ui/src/components/ui/StyledDropdown.tsx'))};`,
      resolveDir: root,
    }))
  } }],
})
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 400 } })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<html class="dark"><head></head><body style="margin:0;font-family:system-ui"><div id="root"></div></body></html>')
  await page.addStyleTag({ content: styles })
  await page.evaluate(value => { (window as any).focusModes = value }, modes)
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
  const title = page.getByRole('heading', { name: 'Branding Agent', exact: true })
  await title.waitFor()
  const focus = page.getByLabel('Agent focus', { exact: true })
  const checkLayout = async (width: number) => {
    await page.setViewportSize({ width, height: 400 })
    const titleBox = (await title.boundingBox())!
    const rowBox = (await focus.boundingBox())!
    assert.ok(titleBox.y + titleBox.height <= rowBox.y, `Title sits above focus buttons at ${width}px`)
    assert.ok(rowBox.y + rowBox.height <= 76, `Two-row header stays within 76px at ${width}px`)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `No page overflow at ${width}px`)
  }
  assert.equal(await focus.locator('button[aria-pressed]').count(), 5, 'Exactly five focus choices')
  await checkLayout(1280)
  const firstButton = (await focus.locator('button[aria-pressed]').first().boundingBox())!
  const lastButton = (await focus.locator('button[aria-pressed]').last().boundingBox())!
  const divider = (await focus.locator('[data-focus-divider]').boundingBox())!
  assert.ok(Math.abs(divider.x - firstButton.x) < 1, 'Divider starts at first button')
  assert.ok(Math.abs(divider.x + divider.width - lastButton.x - lastButton.width) < 1, 'Divider ends at last button')
  assert.equal(divider.height, 0.5)
  assert.ok(divider.y - firstButton.y - firstButton.height >= 7, 'Divider has breathing room below buttons')

  for (let index = 0; index < modes.length; index++) {
    const button = focus.locator('button[aria-pressed]').nth(index)
    await button.hover()
    const tooltip = page.getByRole('tooltip')
    await tooltip.waitFor({ timeout: 700 })
    assert.ok((await tooltip.innerText()).length > 30, `Helpful description for ${modes[index]!.label}`)
    assert.equal(await button.getAttribute('title'), null, 'No duplicate native tooltip')
    await page.mouse.move(0, 300, { steps: 10 })
    await tooltip.waitFor({ state: 'hidden' })
  }
  await focus.getByRole('button', { name: 'Brand Audit', exact: true }).focus()
  await page.getByRole('tooltip').waitFor()
  assert.ok((await page.getByRole('tooltip').innerText()).includes('what makes you distinct'))
  assert.deepEqual(await page.evaluate(() => (window as any).focusClicks), [], 'Reading helpers never selects a focus')
  await page.keyboard.press('Escape')

  // Helpers remain readable during a pending selection, without admitting another click.
  await page.evaluate(() => window.renderFocusHeader('Branding Agent', true))
  const busyButton = focus.getByRole('button', { name: 'Artist World', exact: true })
  await busyButton.hover()
  await page.getByRole('tooltip').waitFor({ timeout: 700 })
  await busyButton.focus()
  await page.keyboard.press('Enter')
  assert.deepEqual(await page.evaluate(() => (window as any).focusClicks), [])
  await page.mouse.move(0, 300, { steps: 10 })
  await page.evaluate(() => window.renderFocusHeader())
  await page.getByRole('button', { name: 'Voice & Beliefs', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Voice & Beliefs', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: 'Artist World', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Artist World', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: 'Chat options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Session details' }).waitFor()
  await page.keyboard.press('Escape')
  await mkdir('/tmp/artist-focus-ui', { recursive: true })
  for (let index = 0; index < modes.length; index++) {
    const box = (await focus.locator('button[aria-pressed]').nth(index).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 })
    await page.getByRole('tooltip').filter({ hasText: modes[index]!.label }).waitFor({ timeout: 700 }).catch(async error => { await page.screenshot({ path: '/tmp/artist-focus-ui/helper-failure.png' }); throw error })
  }
  const worldBox = (await focus.getByRole('button', { name: 'Artist World', exact: true }).boundingBox())!
  await page.mouse.move(worldBox.x + worldBox.width / 2, worldBox.y + worldBox.height / 2, { steps: 12 })
  await page.getByRole('tooltip').filter({ hasText: 'Artist World' }).waitFor({ timeout: 700 }).catch(async error => { await page.screenshot({ path: '/tmp/artist-focus-ui/helper-failure.png' }); throw error })
  const surface = await page.locator('[data-slot="tooltip-content"]').evaluate(el => {
    const style = getComputedStyle(el)
    return { background: style.backgroundColor, filter: style.backdropFilter }
  })
  assert.equal(surface.background, 'rgb(24, 24, 24)', 'Opaque neutral soot surface')
  assert.equal(surface.filter, 'none', 'Underlying colors cannot tint the helper')
  await page.locator('[data-slot="tooltip-content"]').hover()
  await page.waitForTimeout(200)
  assert.equal(await page.locator('[data-slot="tooltip-content"]').isVisible(), true, 'Helper stays open while reading it')
  await page.screenshot({ path: '/tmp/artist-focus-ui/helper.png' })
  await page.locator('[data-slot="tooltip-content"]').screenshot({ path: '/tmp/artist-focus-ui/helper-card.png' })
  await page.mouse.move(0, 300, { steps: 10 })
  await page.keyboard.press('Escape')

  await page.screenshot({ path: '/tmp/artist-focus-ui/desktop.png' })
  await page.locator('#root > div > div:first-child').screenshot({ path: '/tmp/artist-focus-ui/header.png' })
  await checkLayout(768)
  await checkLayout(390)
  await checkLayout(320)
  await page.getByRole('button', { name: 'Brand Audit', exact: true }).focus()
  for (let i = 0; i < modes.length - 1; i++) await page.keyboard.press('Tab')
  const full = page.getByRole('button', { name: /^Full Brand System/ })
  assert.equal(await full.evaluate(el => el === document.activeElement), true, 'Keyboard reaches Full on small screens')
  await page.keyboard.press('Enter')
  assert.equal(await full.getAttribute('aria-pressed'), 'true')
  const fullBox = (await full.boundingBox())!
  const labelBox = (await full.locator('span').first().boundingBox())!
  assert.ok(labelBox.y >= fullBox.y && labelBox.y + labelBox.height <= fullBox.y + fullBox.height,
    'Full label wraps inside its button rather than spilling out')
  await page.setViewportSize({ width: 390, height: 400 })
  await page.waitForFunction(() => {
    const selected = document.querySelector<HTMLButtonElement>('[aria-pressed="true"]')!
    const button = selected.getBoundingClientRect()
    const row = selected.closest('[data-focus-options]')!.parentElement!.getBoundingClientRect()
    return button.left >= row.left - 1 && button.right <= row.right + 1
  })
  await page.screenshot({ path: '/tmp/artist-focus-ui/narrow.png' })
  assert.deepEqual(await page.evaluate(() => (window as any).focusClicks), ['voice-beliefs', 'artist-world', 'full-brand-system'])
  assert.deepEqual(errors, [])
  console.log('PASS: hover under 700ms, rapid sweeps and re-entry, hoverable cards, busy-state helpers, keyboard, selection, and 1280/768/390/320px layouts; no browser errors.')
} finally { await browser.close() }
