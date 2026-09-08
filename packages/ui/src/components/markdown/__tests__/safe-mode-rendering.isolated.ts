import { describe, expect, mock, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Only the browser-specific PDF runtime is stubbed. The real Markdown component,
// parser, URL transform, components and KaTeX run in these rendering regressions.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'unused-test-worker' }))
mock.module('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }))
// Replace only the portal shell so the real overlay content branches render in SSR.
mock.module('../../overlay/FullscreenOverlayBase', () => ({
  FullscreenOverlayBase: ({ children, isOpen }: { children: import('react').ReactNode; isOpen: boolean }) => isOpen ? createElement('section', null, children) : null,
}))
const { Markdown, MemoizedMarkdown } = await import('../Markdown')
const { DocumentFormattedMarkdownOverlay } = await import('../../overlay/DocumentFormattedMarkdownOverlay')
import type { MarkdownProps } from '../Markdown'

function render(children: string, props: Partial<MarkdownProps> = {}): string {
  return renderToStaticMarkup(createElement(Markdown, { children, safeMode: true, ...props }))
}

describe('real safe Markdown rendering', () => {
  for (const mode of ['terminal', 'minimal', 'full'] as const) {
    test(`${mode}: excludes raw iframe srcdoc, global style, active attributes and SVG`, () => {
      const source = [
        '# Report', '', '<iframe srcdoc="<script>window.reportPwned=1</script>" src="https://evil.test/"></iframe>', '',
        '<style>body { display:none !important }</style>', '',
        '<div style="position:fixed;inset:0" onclick="alert(1)">Visible evidence</div>', '',
        '<svg onload="alert(1)"><foreignObject><iframe srcdoc="bad"></iframe></foreignObject></svg>', '',
        '<form action="https://evil.test/"><input autofocus name="secret"></form>',
      ].join('\n')
      for (const safeMode of [undefined, false, true]) {
        const html = render(source, { mode, safeMode })
        expect(html).toContain('Report')
        for (const payload of ['<iframe', 'srcdoc=', '<script', '<style', 'position:fixed', 'onclick=', '<svg', '<form', 'autofocus']) expect(html.toLowerCase()).not.toContain(payload)
      }
    })
    test(`${mode}: malicious/local links cannot regain an href from their labels`, () => {
      const html = render([
        '[javascript:alert(1)](javascript:alert%281%29)',
        '[file:///tmp/private](data:text/html,evil)',
        '[/tmp/private](/tmp/private)',
        '[app](artistos://danger)',
        '[encoded](java&#x73;cript:alert%281%29)',
        '[source](https://example.com/report)',
      ].join('\n\n'), { mode })
      expect(html.match(/<a\b/g)).toHaveLength(1)
      expect(html).toContain('href="https://example.com/report"')
      expect(html).not.toContain('href="/tmp')
      expect(html).not.toContain('href="javascript:')
    })
  }
  test('keeps headings, emphasis, lists, GFM tables, inline HTML text and HTTPS images', () => {
    const html = render('# Title\n\n**Bold** and *emphasis*, <span style="color:red">plain text</span>.\n\n- one\n- two\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n![Cover](https://example.com/cover.png)', { mode: 'full' })
    for (const tag of ['<h1', '<strong', '<em', '<ul', '<li', '<table', '<img']) expect(html).toContain(tag)
    expect(html).toContain('plain text')
    expect(html).not.toContain('color:red')
    expect(html).toContain('src="https://example.com/cover.png"')
  })
  test('unsafe image URLs never become resources', () => {
    const html = render('![bad](data:image/svg+xml,evil)\n\n![local](/tmp/private.png)\n\n<img src="https://evil.test/tracker" onerror="alert(1)">')
    expect(html).not.toContain('src=')
    expect(html).not.toContain('onerror')
  })
  test('retains KaTeX math, currency, and inert HTML code examples', () => {
    const html = render('Price $100.\n\n$$E=mc^2$$\n\n```latex\nx^2\n```\n\n```html\n<iframe srcdoc="bad"></iframe>\n```')
    expect(html).toContain('$100')
    expect(html).toContain('class="katex"')
    expect(html).toContain('&lt;iframe')
    expect(html).not.toContain('<iframe')
  })
  test('math cannot enable trusted HTML or executable links', () => {
    const html = render('$$\\href{javascript:alert(1)}{click}$$\n\n```latex\n\\htmlStyle{position:fixed}{x}\n```')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('style="position:fixed')
  })
  test('retains inline data tables and spreadsheets', () => {
    const inline = '{"columns":[{"key":"value","label":"Evidence"}],"rows":[{"value":"Verified"}]}'
    const html = render(`\`\`\`datatable\n${inline}\n\`\`\`\n\n\`\`\`spreadsheet\n${inline}\n\`\`\``)
    expect(html.match(/<table\b/g)).toHaveLength(2)
    expect(html).toContain('Verified')
  })
  test('downgrades resource-backed/HTML/SVG preview fences to inert code', () => {
    const html = render(['html-preview', 'pdf-preview', 'image-preview', 'datatable', 'spreadsheet', 'mermaid']
      .map(language => `\`\`\`${language}\n{"src":"/tmp/private","items":[{"src":"/tmp/other"}]}\n\`\`\``).join('\n\n'))
    expect(html.match(/<pre\b/g)).toHaveLength(6)
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('data-ca-block-type="datatable"')
    expect(html).not.toContain('data-ca-block-type="mermaid"')
  })
  test('raw HTML stays disabled in default mode without overriding the default URL transform', () => {
    const source = '<div style="color:red">Trusted</div>\n\n<iframe srcdoc="trusted"></iframe>'
    const html = render(source, { safeMode: false })
    expect(html).not.toContain('style="color:red"')
    expect(html).not.toContain('<iframe')
    expect(render(source)).not.toContain('<iframe')
    // Installed react-markdown uses options.urlTransform || defaultUrlTransform.
    expect(render('[bad](javascript:alert%281%29)', { safeMode: false })).not.toContain('href="javascript:')
  })
  test('memoization never ignores a trust-mode change', () => {
    const compare = (MemoizedMarkdown as unknown as { compare: (a: MarkdownProps, b: MarkdownProps) => boolean }).compare
    const props = { children: '<iframe srcdoc="bad"></iframe>', id: 'same' }
    expect(compare(props, { ...props, safeMode: true })).toBe(false)
    expect(compare({ ...props, safeMode: true }, props)).toBe(false)
  })
  test('default rendering keeps rich preview components available', () => {
    const html = render(['html-preview', 'pdf-preview', 'image-preview', 'datatable', 'spreadsheet']
      .map(language => `\`\`\`${language}\n{"src":"/tmp/example","items":[{"src":"/tmp/image.png"}]}\n\`\`\``).join('\n\n'), { safeMode: undefined })
    for (const type of ['html-preview', 'pdf-preview', 'image-preview', 'datatable', 'spreadsheet']) {
      expect(html).toContain(`data-ca-block-type="${type}"`)
    }
  })
  for (const annotations of [false, true]) test(`document overlay preserves plan links and Mermaid but blocks raw HTML, annotation branch=${annotations}`, () => {
    const props = { content: '<iframe srcdoc="evil"></iframe>\n\n<style>body{display:none}</style>\n\n[local](/tmp/private)\n\n```mermaid\ngraph TD\nA --> B\n```',
      isOpen: true, onClose: () => {}, ...(annotations ? { messageId: 'message', onAddAnnotation: () => {} } : {}) }
    const html = renderToStaticMarkup(createElement(DocumentFormattedMarkdownOverlay, props))
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('body{display:none}')
    expect(html).toContain('href="/tmp/private"')
    expect(html).toContain('data-ca-block-type="mermaid"')
    expect(html).toContain('data-from="A" data-to="B"')
    const strict = renderToStaticMarkup(createElement(DocumentFormattedMarkdownOverlay, { ...props, safeMode: true }))
    expect(strict).not.toContain('<iframe')
    expect(strict).not.toContain('<style')
    expect(strict).not.toContain('href="/tmp')
    expect(strict).not.toContain('data-ca-block-type="mermaid"')
    expect(strict).toContain('<pre')
  })
})
