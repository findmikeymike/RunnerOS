import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const source = readFileSync(join(import.meta.dir, '..', 'VisualSurfacePanel.tsx'), 'utf8')
const tree = ts.createSourceFile('VisualSurfacePanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function callsNamed(name: string) {
  const matches: ts.CallExpression[] = []
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree).endsWith(name)) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return matches
}

describe('Canvas review consent boundary', () => {
  test('mount, preview settling, tab changes and reopen effects never send or request reviews', () => {
    const effects = [...callsNamed('useEffect'), ...callsNamed('useLayoutEffect')]
    expect(effects.length).toBeGreaterThan(0)
    for (const effect of effects) {
      const body = effect.arguments[0]!.getText(tree)
      expect(body).not.toContain('queueCanvasVisualReview')
      expect(body).not.toContain('requestVisualReview')
      expect(body).not.toContain('reviewTriggerId')
    }
    expect(source).not.toContain('setVisualReviewTriggerId')
  })

  test('only the explicit review handler queues a review and the button invokes that handler', () => {
    const queueCalls = callsNamed('queueCanvasVisualReview')
    expect(queueCalls).toHaveLength(1)
    let ancestor: ts.Node | undefined = queueCalls[0]
    while (ancestor && !ts.isVariableDeclaration(ancestor)) ancestor = ancestor.parent
    // The immediate variable is queued; walk to the enclosing callback declaration.
    ancestor = ancestor?.parent
    while (ancestor && !ts.isVariableDeclaration(ancestor)) ancestor = ancestor.parent
    expect(ancestor && ts.isVariableDeclaration(ancestor) ? ancestor.name.getText(tree) : '').toBe('requestVisualReview')
    expect(source).toContain('onClick={() => void requestVisualReview()}')
    expect(source).toContain('Ask agent to review')
  })

  test('blocks duplicate clicks and checks the selection after each awaited capture operation', () => {
    const handler = source.slice(source.indexOf('const requestVisualReview'), source.indexOf('if (!activeSurface) return null'))
    expect(handler).toContain('if (reviewPendingRef.current ||')
    expect(handler.indexOf('reviewPendingRef.current = true')).toBeLessThan(handler.indexOf('await window.electronAPI.captureVisualElement'))
    expect(handler.match(/if \(!isCurrent\(\)\) return/g)).toHaveLength(2)
    expect(handler).toContain('reviewSelectionGenerationRef.current === generation')
    expect(handler).toContain('finally')
    expect(handler).toContain('reviewPendingRef.current = false')
  })
})
