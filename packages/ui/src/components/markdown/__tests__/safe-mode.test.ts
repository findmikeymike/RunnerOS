import { describe, expect, test } from 'bun:test'
import { isSafeMarkdownFence, safeMarkdownUrl } from '../safe-mode'

describe('untrusted markdown URL policy', () => {
  test('allows explicit web/mail links and document fragments', () => {
    for (const value of ['https://example.com/report?a=1#source', 'http://example.com/', 'mailto:artist@example.com', '#user-content-fn-1']) {
      expect(safeMarkdownUrl(value)).toBe(value)
    }
    expect(safeMarkdownUrl(' HTTPS://EXAMPLE.COM/report ')).toBe('https://example.com/report')
  })
  test('blocks executable, local, relative, credential-bearing and app destinations', () => {
    for (const value of [undefined, '', 'javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,hello', 'vbscript:msgbox(1)',
      'file:///tmp/private.txt', '/tmp/private.txt', '../secret', '//example.com/a', 'C:\\private.txt',
      'artistos://action', 'craftagents://action', 'https://user:password@example.com/', 'https://example.com/\u0000x']) {
      expect(safeMarkdownUrl(value)).toBeUndefined()
    }
  })
  test('images accept only web URLs, not files, data, mail or fragments', () => {
    expect(safeMarkdownUrl('https://example.com/image.png', true)).toBe('https://example.com/image.png')
    for (const value of ['data:image/svg+xml,<svg/>', 'file:///tmp/a.png', '/tmp/a.png', 'mailto:a@example.com', '#target']) {
      expect(safeMarkdownUrl(value, true)).toBeUndefined()
    }
  })
})

describe('untrusted markdown rich blocks', () => {
  test('disables resource previews and independently injected SVG', () => {
    for (const language of ['html-preview', 'pdf-preview', 'image-preview', 'mermaid']) expect(isSafeMarkdownFence(language, '{}')).toBe(false)
  })
  test('keeps inline data but blocks every src-bearing table/spreadsheet', () => {
    for (const language of ['datatable', 'spreadsheet']) {
      expect(isSafeMarkdownFence(language, '{"columns":[],"rows":[]}')).toBe(true)
      for (const code of ['{"src":"/tmp/private"}', '{"src":"","columns":[],"rows":[]}', 'null', 'invalid']) {
        expect(isSafeMarkdownFence(language, code)).toBe(false)
      }
    }
    for (const language of ['json', 'diff', 'latex', 'math', 'typescript']) expect(isSafeMarkdownFence(language, 'content')).toBe(true)
  })
})
