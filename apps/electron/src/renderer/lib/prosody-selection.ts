export interface ProsodySelectionInfo {
  selectedText: string
  start: number
  end: number
  line: string
}

const TRAILING_LINE_END = /^[\s.,!?;:)"'’”\]-]*$/

export function buildProsodySelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): ProsodySelectionInfo | null {
  if (selectionEnd <= selectionStart) return null

  const selectedText = value.slice(selectionStart, selectionEnd)
  if (!selectedText.trim()) return null
  if (!/[A-Za-z]/.test(selectedText)) return null

  const lineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1
  const nextLineBreak = value.indexOf('\n', selectionEnd)
  const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak
  const afterSelection = value.slice(selectionEnd, lineEnd)
  if (!TRAILING_LINE_END.test(afterSelection)) return null

  return {
    selectedText,
    start: selectionStart,
    end: selectionEnd,
    line: value.slice(lineStart, lineEnd).trim(),
  }
}

export function replaceSelectedRange(
  value: string,
  selection: Pick<ProsodySelectionInfo, 'selectedText' | 'start' | 'end'>,
  replacement: string,
): string {
  if (value.slice(selection.start, selection.end) !== selection.selectedText) return value
  return `${value.slice(0, selection.start)}${replacement}${value.slice(selection.end)}`
}
