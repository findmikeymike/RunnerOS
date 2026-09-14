import { expect, test } from 'bun:test'
import { reconcileDocumentDraft } from './document-draft-sync'

test('external updates preserve unsaved edits and retain conflict on repeat refresh', () => {
  const check = () => reconcileDocumentDraft('old', 'agent update', { text: 'my edits' }, { text: 'old' }, { text: 'agent update' })
  expect(check()).toBe('conflict')
  expect(check()).toBe('conflict')
})

test('untouched forms adopt agent updates', () => {
  expect(reconcileDocumentDraft('old', 'new', { text: 'old' }, { text: 'old' }, { text: 'new' })).toBe('accept')
})

test('unrelated document refresh leaves a dirty form untouched', () => {
  expect(reconcileDocumentDraft('old', 'old', { text: 'edits' }, { text: 'old' }, { text: 'old' })).toBe('unchanged')
})

test('own save echo does not raise a conflict', () => {
  expect(reconcileDocumentDraft('old', 'saved', { text: 'edits' }, { text: 'old' }, { text: 'edits' })).toBe('accept')
})

test('new edits made while save is pending are preserved', () => {
  expect(reconcileDocumentDraft('old', 'saved', { text: 'newer edits' }, { text: 'old' }, { text: 'saved edits' })).toBe('conflict')
})
