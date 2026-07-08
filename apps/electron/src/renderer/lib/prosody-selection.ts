export interface ProsodySelectionInfo {
  selectedText: string
  start: number
  end: number
  line: string
}

const TRAILING_LINE_END = /^[\s.,!?;:)"'’”\]-]*$/
const MAX_PROSODY_SELECTION_WORDS = 4

export function buildProsodySelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): ProsodySelectionInfo | null {
  if (selectionEnd <= selectionStart) return null

  const selectedText = value.slice(selectionStart, selectionEnd)
  if (!selectedText.trim()) return null
  if (!/[A-Za-z]/.test(selectedText)) return null
  if (selectedText.trim().split(/\s+/).filter(Boolean).length > MAX_PROSODY_SELECTION_WORDS) return null

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
