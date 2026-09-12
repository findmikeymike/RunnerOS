import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { publishImportedSession, validateSessionBundleFiles } from '../import-bundle'
import { readSessionJsonl } from '../jsonl'
import type { StoredSession } from '../types'
const file = (relativePath: string) => ({ relativePath, size: 2, contentBase64: 'b2s=' })
for (const files of [[file('session.jsonl')], [file('SESSION.JSONL')], [file('../escape')], [file('a'),file('a/b')], [file('A'),file('a')], [file('fine'), {...file('bad'),size:3}]]) {
  test(`rejects invalid complete payload: ${files.map(f=>f.relativePath).join(',')}`, () => {
    expect(() => validateSessionBundleFiles(files)).toThrow()
  })
}
test('publication preserves an existing destination and never exposes partial invalid imports', () => {
 const root=mkdtempSync('/tmp/session-publish-')
 const session={id:'original',createdAt:1,lastUsedAt:1,workspaceRootPath:root,messages:[],tokenUsage:{}} as StoredSession
 try {
  publishImportedSession(root,session,[file('attachments/a.txt')])
  const before=readFileSync(join(root,'sessions/original/session.jsonl'),'utf8')
  expect(()=>publishImportedSession(root,session,[file('replacement')])).toThrow()
  expect(readFileSync(join(root,'sessions/original/session.jsonl'),'utf8')).toBe(before)
  expect(readSessionJsonl(join(root,'sessions/original/session.jsonl'))?.id).toBe('original')
  expect(()=>publishImportedSession(root,{...session,id:'invalid'},[file('ok'),file('../bad')])).toThrow()
  expect(existsSync(join(root,'sessions/invalid'))).toBe(false)
  mkdirSync(join(root,'sessions/reserved'))
  expect(()=>publishImportedSession(root,{...session,id:'reserved'},[])).toThrow()
  expect(existsSync(join(root,'sessions/reserved'))).toBe(true)
 } finally {rmSync(root,{recursive:true,force:true})}
})
