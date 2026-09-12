import { build } from 'esbuild'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
const base = resolve(import.meta.dir, '..')
const stubs: Record<string, string> = {
  context: `
    import React from 'react'
    const Context = React.createContext({})
    export const AppShellProvider = ({ value, children }) =>
      React.createElement(Context.Provider, { value }, children)
    export const useAppShellContext = () => React.useContext(Context)
  `,
  main: `
    import React from 'react'
    import Page from '${base}/apps/electron/src/renderer/pages/WorkspaceContextPage.tsx'
    import { useAppShellContext } from '@/context/AppShellContext'
    export const MainContentPanel = () =>
      React.createElement(Page, { workspaceId: useAppShellContext().activeWorkspaceId })
  `,
  i18n: `export const useTranslation = () => ({ t: key => key })`,
  atoms: `
    import { atom } from 'jotai'
    export const closePanelAtom = atom(null, () => {})
    export const focusedPanelIdAtom = atom('same-panel')
  `,
  route: `export const parseRouteToNavigationState = () => ({ navigator: 'workspaceContext' })`,
  utils: `export const cn = (...args) => args.filter(value => typeof value === 'string').join(' ')`,
  product: `export const RENDERER_PRODUCT_VARIANT = 'artist-os'`,
  blank: `
    export const PanelHeaderCenterButton = () => null
    export const UserProfileDialog = () => null
  `,
  header: `
    import React from 'react'
    export const CompactPageHeader = ({ actions, title }) =>
      React.createElement('header', null, title, actions)
  `,
  docs: `
    export const useWorkspaceContext = workspaceId => ({
      docs: [], loading: false, error: null,
      upsert: async input => { window.saved.push({ workspaceId, ...input }) },
      remove: async () => true,
    })
  `,
  agents: `export const useAgents = () => ({ activeAgents: [] })`,
  transport: `export const useTransportConnectionState = () => ({ mode: window.pickerMode || 'remote' })`,
  server: `
    import React from 'react'
    export const ServerDirectoryBrowser = ({ open, onSelect }) => open
      ? React.createElement('button', {
          onClick: () => onSelect('/campaign-A/repo'),
        }, 'Confirm remote directory')
      : null
  `,
  dialog: `
    import React from 'react'
    export const Dialog = ({ open, children }) => open
      ? React.createElement('div', { role: 'dialog' }, children)
      : null
    const Element = ({ children }) => React.createElement('div', null, children)
    export const DialogContent = Element, DialogHeader = Element, DialogTitle = Element,
      DialogDescription = Element, DialogFooter = Element
  `,
  button: `
    import React from 'react'
    export const Button = ({ children, variant, size, ...props }) =>
      React.createElement('button', props, children)
  `,
}
const routeMap: Record<string, string> = {
  '@/context/AppShellContext': 'context',
  './MainContentPanel': 'main',
  'react-i18next': 'i18n',
  '@/atoms/panel-stack': 'atoms',
  '../../../shared/route-parser': 'route',
  '@/lib/utils': 'utils',
  '@/lib/product-identity': 'product',
  '@/components/ui/PanelHeaderCenterButton': 'blank',
  '@/components/agents/UserProfileDialog': 'blank',
  '@/components/app-shell/CompactPageHeader': 'header',
  '@/hooks/useWorkspaceContext': 'docs',
  '@/hooks/useAgents': 'agents',
  './useTransportConnectionState': 'transport',
  '@/components/ServerDirectoryBrowser': 'server',
  '@/components/ui/dialog': 'dialog',
  '@/components/ui/button': 'button',
}
// Keep the real PanelSlot key boundary, Context page state, and directory-picker
// hook. Only shell infrastructure, presentation wrappers, and external IO are stubbed.
const bundle = await build({
  entryPoints: [resolve(import.meta.dir, 'fixtures/workspace-identity-ui.tsx')],
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  tsconfig: resolve(base, 'apps/electron/tsconfig.json'),
  plugins: [{ name: 'isolated-boundaries', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      const key = args.path.endsWith('/context/AppShellContext') ? 'context' : routeMap[args.path]
      if (key) return { path: key, namespace: 'fixture' }
    })
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
      contents: stubs[args.path], loader: 'jsx', resolveDir: base,
    }))
  } }],
})
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
let passed = 0
let failures = 0
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const settle = () => page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  const reset = async () => {
    errors.length = 0
    await page.goto('about:blank')
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
    await page.getByRole('button', { name: 'New', exact: true }).waitFor()
  }
  const swap = async (id: string) => {
    await page.evaluate(id => (window as any).renderWorkspace(id), id)
  }
  const openDraft = async () => {
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('Project brief').fill('A private draft')
    await page.locator('textarea').fill('Campaign A private text')
  }
  const check = async (name: string, body: () => Promise<void>) => {
    try {
      await reset()
      await body()
      assert.deepEqual(errors, [])
      passed++
      console.log(`PASS ${name}`)
    } catch (error) {
      failures++
      console.error(`FAIL ${name}: ${error}`)
      if (errors.length) console.error(errors)
    }
  }
  await check('same workspace rerender preserves real context draft', async () => {
    await openDraft()
    await swap('A')
    assert.equal(await page.getByPlaceholder('Project brief').inputValue(), 'A private draft')
    assert.equal(await page.locator('textarea').inputValue(), 'Campaign A private text')
  })
  await check('workspace switch removes A draft before B can save', async () => {
    await openDraft()
    await swap('B')
    if (await page.getByRole('dialog').count()) {
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      console.error('Unexpected cross-workspace save:', await page.evaluate(() => (window as any).saved))
    }
    assert.equal(await page.evaluate(() => (window as any).saved.length), 0)
    assert.equal(await page.getByRole('dialog').count(), 0)
    // The replacement page remains usable and saves only the new workspace draft.
    await openDraft()
    await page.locator('textarea').fill('Campaign B text')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => (window as any).saved.map((save: any) => ({
      workspaceId: save.workspaceId, body: save.body,
    }))), [{ workspaceId: 'B', body: 'Campaign B text' }])
  })
  await check('remote picker opened in A cannot confirm into B', async () => {
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    const confirm = page.getByRole('button', { name: 'Confirm remote directory' })
    await confirm.waitFor()
    await swap('B')
    if (await confirm.count()) await confirm.click()
    assert.equal(await page.evaluate(() => (window as any).settingsSaved.length), 0)
    assert.equal(await confirm.count(), 0)
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await confirm.click()
    assert.equal(await page.evaluate(() => (window as any).settingsSaved[0]?.workspaceId), 'B')
  })
  await check('late A file import cannot populate B', async () => {
    await page.evaluate(() => (window as any).deferImport())
    await page.locator('input[type=file]').setInputFiles({
      name: 'campaign-A.md', mimeType: 'text/markdown', buffer: Buffer.from('A private import'),
    })
    await page.waitForFunction(() => typeof (window as any).finishImport === 'function')
    await swap('B')
    await page.evaluate(() => (window as any).finishImport('A private import'))
    await settle()
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await page.evaluate(() => (window as any).saved.length), 0)
  })
  await check('remote picker retains opener and consumes each selection once', async () => {
    await page.evaluate(() => (window as any).renderPicker('A'))
    await page.getByRole('button', { name: 'Open harness picker' }).click()
    await page.evaluate(() => (window as any).renderPicker('B'))
    await page.evaluate(() => {
      const host = window as any
      host.picker.confirmServerBrowser('/selected-for-A')
      host.picker.confirmServerBrowser('/duplicate')
    })
    assert.deepEqual(await page.evaluate(() => (window as any).pickerCalls), [
      { owner: 'A', path: '/selected-for-A' },
    ])
    await page.getByRole('button', { name: 'Open harness picker' }).click()
    await page.evaluate(() => (window as any).picker.confirmServerBrowser('/selected-for-B'))
    assert.deepEqual(await page.evaluate(() => (window as any).pickerCalls), [
      { owner: 'A', path: '/selected-for-A' },
      { owner: 'B', path: '/selected-for-B' },
    ])
  })
  await check('cancelled remote picker cannot deliver a late confirmation', async () => {
    await page.evaluate(() => (window as any).renderPicker('A'))
    await page.getByRole('button', { name: 'Open harness picker' }).click()
    await page.evaluate(() => (window as any).renderPicker('B'))
    await page.evaluate(() => {
      const host = window as any
      host.picker.cancelServerBrowser()
      host.picker.confirmServerBrowser('/cancelled')
    })
    assert.deepEqual(await page.evaluate(() => (window as any).pickerCalls), [])
  })
  await check('native picker retains opener through a callback owner change', async () => {
    await page.evaluate(() => (window as any).renderPicker('A', 'local'))
    await page.getByRole('button', { name: 'Open harness picker' }).click()
    await page.waitForFunction(() => typeof (window as any).finishNativePicker === 'function')
    await page.evaluate(() => (window as any).renderPicker('B', 'local'))
    await page.evaluate(() => (window as any).finishNativePicker('/native-for-A'))
    await settle()
    assert.deepEqual(await page.evaluate(() => (window as any).pickerCalls), [
      { owner: 'A', path: '/native-for-A' },
    ])
  })
} finally {
  await browser.close()
}
console.log(`${passed} passed, ${failures} failed`)
if (failures) process.exitCode = 1
