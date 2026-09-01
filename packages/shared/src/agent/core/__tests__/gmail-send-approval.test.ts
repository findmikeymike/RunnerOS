import { describe, expect, it } from 'bun:test'

import { classifyGmailMutation, isGmailSendAction, runPreToolUseChecks } from '../pre-tool-use'

const permissionManager = {
  isCommandWhitelisted: () => true,
  isDangerousCommand: () => false,
  getBaseCommand: (command: string) => command,
  extractDomainFromNetworkCommand: () => null,
  isDomainWhitelisted: () => true,
}

describe('Gmail exact-send approval classification', () => {
  it('requires approval for draft and raw-message send endpoints', () => {
    const paths = [
      '/users/me/drafts/send',
      '/users/me/messages/send',
      '/users/me/messages/send?alt=json',
      '/users/me/messages/send?uploadType=multipart',
      '/users/me/drafts/send?alt=json',
      'users/me/messages/send',
      '/users/me//messages/send',
      '/upload/gmail/v1/users/me/messages/send?uploadType=multipart',
      '/users/me/messages/%73end',
    ]

    for (const path of paths) {
      expect(isGmailSendAction('mcp__api_gmail__api_gmail', { method: 'POST', path })).toBe(true)
    }
  })

  it('does not classify private draft creation or reads as sends', () => {
    expect(isGmailSendAction('api_gmail', { method: 'POST', path: '/users/me/drafts' })).toBe(false)
    expect(isGmailSendAction('api_gmail', { method: 'GET', path: '/users/me/messages' })).toBe(false)
    expect(isGmailSendAction('api_other', { method: 'POST', path: '/users/me/drafts/send' })).toBe(false)
  })

  it('allows known draft work and prompts unknown Gmail mutations', () => {
    expect(classifyGmailMutation('api_gmail', { method: 'POST', path: '/users/me/drafts' })).toBe('draft')
    expect(classifyGmailMutation('api_gmail', { method: 'PUT', path: '/users/me/drafts/draft-123' })).toBe('draft')
    expect(classifyGmailMutation('api_gmail', { method: 'DELETE', path: '/users/me/drafts/draft-123' })).toBe('draft')
    expect(classifyGmailMutation('api_gmail', { method: 'PATCH', path: '/users/me/settings/sendAs/me' })).toBe('unknown')
  })

  it('cannot be bypassed by allow-all mode or a trusted tool entry', () => {
    const result = runPreToolUseChecks({
      toolName: 'mcp__api_gmail__api_gmail',
      input: {
        method: 'POST',
        path: '/users/me/messages/send?uploadType=multipart',
        body: { id: 'draft-123' },
      },
      sessionId: 'session-1',
      permissionMode: 'allow-all',
      workspaceRootPath: '/tmp/gmail-approval-test',
      workspaceId: 'workspace-1',
      activeSourceSlugs: ['api_gmail'],
      allSourceSlugs: ['api_gmail'],
      hasSourceActivation: true,
      trustedWorkerTools: ['mcp__api_gmail__api_gmail'],
      permissionManager,
    })

    expect(result.type).toBe('prompt')
    if (result.type !== 'prompt') throw new Error('Expected Gmail send approval prompt')
    expect(result.description).toContain('draft-123')
    expect(result.command).toBe('POST /users/me/messages/send?uploadType=multipart')
  })

  it('fails closed for an unknown Gmail mutation in allow-all mode', () => {
    const result = runPreToolUseChecks({
      toolName: 'mcp__api_gmail__api_gmail',
      input: { method: 'PATCH', path: '/users/me/settings/sendAs/me', params: { displayName: 'Changed' } },
      sessionId: 'session-unknown-mutation',
      permissionMode: 'allow-all',
      workspaceRootPath: '/tmp/gmail-approval-test',
      workspaceId: 'workspace-1',
      activeSourceSlugs: ['api_gmail'],
      allSourceSlugs: ['api_gmail'],
      hasSourceActivation: true,
      trustedWorkerTools: ['mcp__api_gmail__api_gmail'],
      permissionManager,
    })

    expect(result.type).toBe('prompt')
    if (result.type !== 'prompt') throw new Error('Expected unknown Gmail mutation approval prompt')
    expect(result.description).toContain('Approve this exact Gmail change')
  })
})
