import { expect, mock, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { ActivityItem } from '../turn-utils'

// PDF previews are browser-only and unrelated to these activity-only cards.
mock.module('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }))
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker' }))
await i18n.use(initReactI18next).init({
  lng: 'en', resources: { en: { translation: {
    'turnCard.stillWorking': 'still working',
    'turnCard.stillWorkingLong': 'still working {{duration}}',
  } } },
})
const { TurnCard } = await import('../TurnCard')

function card(activities: ActivityItem[], isComplete = false) {
  return renderToStaticMarkup(React.createElement(TurnCard, {
    turnId: 'test', activities, isComplete, isStreaming: false, isExpanded: false,
  }))
}
function tool(age: number, status: ActivityItem['status'] = 'running'): ActivityItem {
  return { id: String(age), type: 'tool', toolName: 'artwork_compose', status, timestamp: Date.now() - age }
}

test('collapsed card shows elapsed time for the oldest running tool', () => {
  expect(card([tool(60_000), tool(5_000)])).toContain('still working 1:00')
})
test('collapsed card stays quiet for fast, completed and backgrounded tools', () => {
  expect(card([tool(500)])).not.toContain('still working')
  expect(card([tool(60_000, 'completed')])).not.toContain('still working')
  expect(card([tool(60_000, 'backgrounded')])).not.toContain('still working')
  expect(card([tool(60_000)], true)).not.toContain('still working')
})
test('collapsed card ignores an older finished tool when measuring the current one', () => {
  expect(card([tool(120_000, 'completed'), tool(500)])).not.toContain('still working')
})
