import { describe, expect, it } from 'bun:test'

import { validateGmailReadRequest } from '../api-tools'

describe('Gmail API read guard', () => {
  it('requires an explicit intent and a bounded list size', () => {
    expect(validateGmailReadRequest('gmail', 'GET', '/users/me/messages', { maxResults: 10 }, undefined))
      .toContain('_intent')
    expect(validateGmailReadRequest('gmail', 'GET', '/users/me/messages', {}, 'Read the test messages'))
      .toContain('maxResults')
    expect(validateGmailReadRequest('gmail', 'GET', '/users/me/messages', { maxResults: 100 }, 'Read recent mail'))
      .toContain('Bulk inbox crawling')
    expect(validateGmailReadRequest('gmail', 'GET', '/users/me/messages', { maxResults: 10 }, 'Read the selected test mail'))
      .toBeNull()
  })

  it('does not block direct message/thread reads or other sources', () => {
    expect(validateGmailReadRequest('gmail', 'GET', '/users/me/messages/abc', undefined, undefined)).toBeNull()
    expect(validateGmailReadRequest('other', 'GET', '/users/me/messages', undefined, undefined)).toBeNull()
  })
})
