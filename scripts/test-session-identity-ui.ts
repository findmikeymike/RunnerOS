import { build } from 'esbuild'
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import ts from 'typescript'

// Tests the actual MainContentPanel route/key boundary. ChatPage is an explicit
// lifecycle probe, not a mock claimed to verify production attachment parsing.
const base = resolve(import.meta.dir, '..')
const panel = resolve(base, 'apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx')
const source = ts.createSourceFile(panel, readFileSync(panel, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const exportsByModule = new Map<string, Set<string>>()
for (const statement of source.statements) {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
  const clause = statement.importClause
  if (!clause || clause.isTypeOnly) continue
  const names = new Set<string>()
  if (clause.name) names.add('default')
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const item of clause.namedBindings.elements) if (!item.isTypeOnly) names.add(item.propertyName?.text ?? item.name.text)
  }
  exportsByModule.set(statement.moduleSpecifier.text, names)
}
const selection = `{ useIsMultiSelectActive: () => false, useSelectionCount: () => 0, useSelectedIds: () => new Set(), useSelection: () => ({ clearMultiSelect() {} }) }`
const overrides: Record<string, string> = {
  useTranslation: `() => ({ t: key => key })`,
  useAppShellContext: `() => window.fixtureContext`,
  useNavigation: `() => ({ navigate() {} })`,
  useNavigationState: `() => ({ navigator: 'sessions' })`,
  isSessionsNavigation: `value => value.navigator === 'sessions'`,
  useAtomValue: `value => value`,
  sessionMetaMapAtom: `new Map()`, automationsAtom: `[]`,
  useSessionSelection: `() => ({ clearMultiSelect() {} })`,
  useIsMultiSelectActive: `() => false`, useSelectedIds: `() => new Set()`, useSelectionCount: `() => 0`,
  sourceSelection: selection, skillSelection: selection, automationSelection: selection,
  useOutputs: `() => ({ outputs: [], loading: false })`,
  Panel: `({ children }) => children`, StoplightProvider: `({ children }) => children`,
  cn: `(...values) => values.filter(value => typeof value === 'string').join(' ')`,
}
const probe = `
  import React from 'react'
  export default function SessionLifecycleProbe({ sessionId }) {
    const [draft, setDraft] = React.useState(() => window.drafts[sessionId])
    const [completed, setCompleted] = React.useState(null)
    const owner = React.useRef(sessionId)
    owner.current = sessionId
    React.useEffect(() => {
      if (completed) window.saved.push({ owner: owner.current, value: completed })
    }, [completed])
    return React.createElement('div', { 'data-session': sessionId },
      React.createElement('input', { 'aria-label': 'Lifecycle draft', value: draft, onChange: e => setDraft(e.target.value) }),
      React.createElement('button', { onClick: () => {
        window.finishPending = () => setCompleted(sessionId + ' pending result')
      } }, 'Begin pending operation'),
      React.createElement('output', null, completed || 'No pending result'))
  }
`
const bundle = await build({
  entryPoints: [resolve(base, 'scripts/fixtures/session-identity-ui.tsx')], bundle: true, write: false,
  platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{ name: 'session-boundary-fixture', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (args.importer !== panel || args.path === 'react') return
      if (exportsByModule.has(args.path)) return { path: args.path, namespace: 'fixture' }
    })
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
      loader: 'jsx', resolveDir: base,
      contents: args.path === '@/pages/ChatPage' ? probe : [...exportsByModule.get(args.path)!].map(name => {
        const value = overrides[name] ?? `() => null`
        return name === 'default' ? `export default ${value};` : `export const ${name} = ${value};`
      }).join('\n'),
    }))
  } }],
})
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
try {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
  await page.getByLabel('Lifecycle draft').waitFor({ timeout: 5000 })
  await page.getByLabel('Lifecycle draft').fill('Unsaved A draft')
  await page.evaluate(() => (window as any).renderSession('A'))
  assert.equal(await page.getByLabel('Lifecycle draft').inputValue(), 'Unsaved A draft')
  console.log('PASS same-session rerender preserves local draft')
  await page.getByRole('button', { name: 'Begin pending operation' }).click()
  await page.evaluate(() => (window as any).renderSession('B'))
  await page.evaluate(() => (window as any).finishPending())
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const actual = { draft: await page.getByLabel('Lifecycle draft').inputValue(), saved: await page.evaluate(() => (window as any).saved) }
  console.log('Session-switch result:', JSON.stringify(actual))
  assert.deepEqual(actual, { draft: 'Restored B draft', saved: [] })
  console.log('PASS session switch restores B state and isolates pending A state update')
  await page.getByRole('button', { name: 'Begin pending operation' }).click()
  await page.evaluate(() => (window as any).finishPending())
  await page.waitForFunction(() => (window as any).saved.length === 1)
  assert.deepEqual(await page.evaluate(() => (window as any).saved), [{ owner: 'B', value: 'B pending result' }])
  assert.deepEqual(errors, [])
  console.log('PASS replacement session accepts its own pending operation')
} finally { await browser.close() }
