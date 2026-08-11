import { describe, expect, test } from 'bun:test'

import type { TradingConnection } from '@trade-god/contracts'

import {
  TradovateSessionManager,
  tokenFingerprint,
  type TradovateCredential,
} from '../src/index.ts'

const NOW = '2026-08-10T15:00:00.000Z'
const connection = {
  environment: 'paper',
  credential_ref: 'credential-one',
} as TradingConnection

describe('Tradovate session manager', () => {
  test('coalesces renewal and persists rotation before returning the new token', async () => {
    const current: TradovateCredential = {
      access_token: 'old-token',
      account_id: 123,
      account_spec: 'DEMO-123',
      expires_at: '2026-08-10T15:10:00.000Z',
    }
    let renewalCalls = 0
    let rotationCalls = 0
    const manager = new TradovateSessionManager({
      resolveCredential: async () => current,
      rotateCredential: async (input) => {
        rotationCalls += 1
        expect(input.expectedTokenFingerprint).toBe(tokenFingerprint('old-token'))
        expect(input.credential.access_token).toBe('new-token')
      },
      fetch: async () => {
        renewalCalls += 1
        return Response.json({
          accessToken: 'new-token',
          expirationTime: '2026-08-10T16:30:00.000Z',
        })
      },
      now: () => NOW,
    })

    const [one, two] = await Promise.all([
      manager.credential(connection),
      manager.credential(connection),
    ])

    expect(one.access_token).toBe('new-token')
    expect(two.access_token).toBe('new-token')
    expect(renewalCalls).toBe(1)
    expect(rotationCalls).toBe(1)
  })

  test('does not renew a healthy token and refuses expired or unpersistable rotation', async () => {
    let renewalCalls = 0
    const healthy = new TradovateSessionManager({
      resolveCredential: async () => ({
        access_token: 'healthy',
        account_id: 123,
        account_spec: 'DEMO-123',
        expires_at: '2026-08-10T16:00:01.000Z',
      }),
      fetch: async () => { renewalCalls += 1; return Response.json({}) },
      now: () => NOW,
    })
    expect((await healthy.credential(connection)).access_token).toBe('healthy')
    expect(renewalCalls).toBe(0)

    const expired = new TradovateSessionManager({
      resolveCredential: async () => ({
        access_token: 'expired',
        account_id: 123,
        account_spec: 'DEMO-123',
        expires_at: '2026-08-10T14:59:59.000Z',
      }),
      now: () => NOW,
    })
    await expect(expired.credential(connection)).rejects.toMatchObject({
      code: 'CONNECTION_UNAVAILABLE',
    })

    const noRotation = new TradovateSessionManager({
      resolveCredential: async () => ({
        access_token: 'near-expiry',
        account_id: 123,
        account_spec: 'DEMO-123',
        expires_at: '2026-08-10T15:10:00.000Z',
      }),
      now: () => NOW,
    })
    await expect(noRotation.credential(connection)).rejects.toThrow('secure token rotation is unavailable')
  })

  test('stop prevents later credential distribution', async () => {
    const manager = new TradovateSessionManager({
      resolveCredential: async () => ({
        access_token: 'token',
        account_id: 123,
        account_spec: 'DEMO-123',
      }),
    })
    manager.stop()
    await expect(manager.credential(connection)).rejects.toThrow('session manager is stopped')
  })

  test('honors renewal penalty cooldown without another auth request', async () => {
    let renewalCalls = 0
    const manager = new TradovateSessionManager({
      resolveCredential: async () => ({
        access_token: 'near-expiry',
        account_id: 123,
        account_spec: 'DEMO-123',
        expires_at: '2026-08-10T15:10:00.000Z',
      }),
      rotateCredential: async () => undefined,
      fetch: async () => {
        renewalCalls += 1
        return Response.json({ 'p-ticket': 'wait-one', 'p-time': 15 })
      },
      now: () => NOW,
    })

    await expect(manager.credential(connection)).rejects.toMatchObject({
      code: 'TRADOVATE_PENALTY_TICKET',
    })
    await expect(manager.credential(connection)).rejects.toThrow('renewal is paused')
    expect(renewalCalls).toBe(1)
  })

  test('does not rotate or distribute a renewal that finishes after stop', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    let rotations = 0
    const manager = new TradovateSessionManager({
      resolveCredential: async () => ({
        access_token: 'near-expiry',
        account_id: 123,
        account_spec: 'DEMO-123',
        expires_at: '2026-08-10T15:10:00.000Z',
      }),
      rotateCredential: async () => { rotations += 1 },
      fetch: async () => {
        markStarted()
        await blocked
        return Response.json({
          accessToken: 'new-token',
          expirationTime: '2026-08-10T16:30:00.000Z',
        })
      },
      now: () => NOW,
    })

    const renewal = manager.credential(connection)
    await started
    manager.stop()
    release()

    await expect(renewal).rejects.toMatchObject({ code: 'TRADOVATE_TOKEN_RENEWAL_STOPPED' })
    expect(rotations).toBe(0)
  })
})
