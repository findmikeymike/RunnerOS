/** Explicit destinations only: untrusted reports cannot invoke local/app handlers. */
export function safeMarkdownUrl(value: string | undefined, image = false): string | undefined {
  if (!value) return undefined
  const target = value.trim()
  if (!target || /[\u0000-\u0020\u007f]/.test(target)) return undefined
  if (!image && target.startsWith('#')) return target
  try {
    const url = new URL(target)
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href
    if (!image && url.protocol === 'mailto:') return url.href
  } catch { /* Relative paths and malformed URLs are not report destinations. */ }
  return undefined
}

/** Rich renderers that read files or inject their own SVG/HTML need trusted input. */
export function isSafeMarkdownFence(language: string | undefined, code: string): boolean {
  if (['html-preview', 'pdf-preview', 'image-preview', 'mermaid'].includes(language ?? '')) return false
  if (language === 'datatable' || language === 'spreadsheet') {
    try {
      const value = JSON.parse(code)
      return value !== null && typeof value === 'object' && !Object.hasOwn(value, 'src')
    } catch { return false }
  }
  return true
}
