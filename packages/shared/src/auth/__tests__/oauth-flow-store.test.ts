import { expect, test } from 'bun:test'
import { OAuthFlowStore, createPendingFlow, type PendingOAuthFlow } from '../oauth-flow-store.ts'
import type { LoadedSource } from '../../sources/types.ts'

function flow(state: string, overrides: Partial<PendingOAuthFlow> = {}): PendingOAuthFlow {
  return createPendingFlow({
    flowId: `flow-${state}`,
    state,
    codeVerifier: 'verifier',
    redirectUri: 'https://example.invalid/callback',
    source: {} as LoadedSource,
    clientId: 'client',
    clientSecret: 'secret',
    tokenEndpoint: 'https://example.invalid/token',
    provider: 'generic',
    ownerClientId: 'owner',
    workspaceId: 'workspace',
    sourceSlug: 'fixture',
    ...overrides,
  })
}

test('claim consumes the nonce while retaining cancellation', () => {
  const store = new OAuthFlowStore()
  try {
    store.store(flow('state-1'))
    expect(store.claim('state-1')).toMatchObject({ state: 'state-1' })
    expect(store.getByState('state-1')).toBeNull()
    expect(store.getForCancellation('state-1')).toMatchObject({ state: 'state-1' })
  } finally {
    store.dispose()
  }
})

test('cleanup prunes expired flows and never-completed claimed flows', () => {
  const store = new OAuthFlowStore()
  try {
    const pending = flow('pending'), claimed = flow('claimed')
    pending.expiresAt = Date.now() - 1
    store.store(pending)
    store.store(claimed)
    store.claim('claimed')
    claimed.expiresAt = Date.now() - 1
    store.cleanup()
    expect(store.getByState('pending')).toBeNull()
    // The consumed nonce's secrets (codeVerifier, clientSecret) must not
    // outlive the flow TTL when the exchange never completed.
    expect(store.getForCancellation('claimed')).toBeNull()
    expect(store.size).toBe(0)
  } finally {
    store.dispose()
  }
})
