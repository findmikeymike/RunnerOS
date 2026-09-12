import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { TEST_IGNORES, TEST_ROOTS } from './run-tests'

function globalBuiltinMocks(text: string): number[] {
  const source = ts.createSourceFile('test.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const mockNames = new Set<string>()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'bun:test') continue
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) if ((binding.propertyName ?? binding.name).text === 'mock') mockNames.add(binding.name.text)
    }
  }
  const lines: number[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && mockNames.has(node.expression.expression.text)
      && node.expression.name.text === 'module') {
      const name = node.arguments[0]
      if (name && ts.isStringLiteralLike(name) && /^(?:node:)?(?:os|path|fs)(?:\/|$)/.test(name.text)) {
        lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return lines
}

test('global builtin mocks cannot leak into discovery runs', () => {
  const root = join(import.meta.dir, '..')
  const violations: string[] = []
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      if (TEST_IGNORES.includes(entry.name)) continue
      const path = `${relative}/${entry.name}`
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && /[._](?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
        for (const line of globalBuiltinMocks(readFileSync(join(root, path), 'utf8'))) violations.push(`${path}:${line} must run in .isolated.ts`)
      }
    }
  }
  for (const directory of TEST_ROOTS) walk(directory)
  expect(violations).toEqual([])
})

test('policy catches aliased builtin mocks without flagging subprocess scripts or comments', () => {
  expect(globalBuiltinMocks('import {mock as m} from "bun:test"; m.module("node:fs/promises",()=>({}));')).toEqual([1])
  expect(globalBuiltinMocks('import {mock} from "bun:test"; test("x",()=>mock.module("os",()=>({})));')).toEqual([1])
  expect(globalBuiltinMocks('import {mock} from "bun:test"; const childScript = `mock.module("os",()=>({}));`; // mock.module("fs",()=>({}));')).toEqual([])
})
