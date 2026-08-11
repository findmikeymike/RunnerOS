import { createHash } from 'node:crypto'

import type { TradingConnection } from '@trade-god/contracts'

import { ExecutionAdapterError, ExecutionGatewayError } from '../errors.ts'
import type {
  TradovateCredential,
  TradovateCredentialResolver,
  TradovateFetch,
} from './tradovate-api-adapter.ts'

export type TradovateCredentialRotator = (input: {
  credentialRef: string
  expectedTokenFingerprint: string
  credential: TradovateCredential
}) => Promise<void>

export interface TradovateSessionManagerOptions {
  resolveCredential: TradovateCredentialResolver
  rotateCredential?: TradovateCredentialRotator
  fetch?: TradovateFetch
  now?: () => string
  renewalLeadMs?: number
  timeoutMs?: number
}

interface TradovateRenewalResponse {
  accessToken?: string
  expirationTime?: string
  errorText?: string
}

/** Owns one renewable Tradovate token stream per encrypted credential reference. */
export class TradovateSessionManager {
  private readonly fetchImpl: TradovateFetch
  private readonly now: () => string
  private readonly renewalLeadMs: number
  private readonly timeoutMs: number
  private readonly renewals = new Map<string, Promise<TradovateCredential>>()
  private readonly renewalBlockedUntil = new Map<string, number>()
  private readonly controllers = new Set<AbortController>()
  private stopped = false

  constructor(private readonly options: TradovateSessionManagerOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.now = options.now ?? (() => new Date().toISOString())
    this.renewalLeadMs = Math.max(60_000, options.renewalLeadMs ?? 15 * 60_000)
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? 15_000)
  }

  async credential(connection: TradingConnection): Promise<TradovateCredential> {
    if (this.stopped) {
      throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', 'Tradovate session manager is stopped.')
    }
    if (!connection.credential_ref) {
      throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', 'Tradovate credential reference is missing.')
    }
    const credential = await this.options.resolveCredential(connection.credential_ref)
    if (this.stopped) {
      throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', 'Tradovate session manager is stopped.')
    }
    if (!credential?.access_token.trim()) {
      throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', 'Tradovate credential is unavailable.')
    }
    const expiry = credential.expires_at ? Date.parse(credential.expires_at) : Number.NaN
    if (!Number.isFinite(expiry)) {
      throw new ExecutionGatewayError(
        'CONNECTION_UNAVAILABLE',
        'Tradovate credential is missing a valid expiration time.',
      )
    }

    const now = Date.parse(this.now())
    if (expiry <= now) {
      throw new ExecutionGatewayError('CONNECTION_UNAVAILABLE', 'Tradovate access token has expired and cannot be renewed.')
    }
    if (expiry - now > this.renewalLeadMs) return credential
    const blockedUntil = this.renewalBlockedUntil.get(connection.credential_ref) ?? 0
    if (blockedUntil > now) {
      throw new ExecutionGatewayError(
        'CONNECTION_UNAVAILABLE',
        `Tradovate token renewal is paused until ${new Date(blockedUntil).toISOString()}.`,
      )
    }
    if (!this.options.rotateCredential) {
      throw new ExecutionGatewayError(
        'CONNECTION_UNAVAILABLE',
        'Tradovate access token requires renewal, but secure token rotation is unavailable.',
      )
    }
    return this.renew(connection.credential_ref, credential)
  }

  stop(): void {
    this.stopped = true
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }

  private renew(
    credentialRef: string,
    credential: TradovateCredential,
  ): Promise<TradovateCredential> {
    const existing = this.renewals.get(credentialRef)
    if (existing) return existing
    const renewal = this.performRenewal(credentialRef, credential)
      .finally(() => this.renewals.delete(credentialRef))
    this.renewals.set(credentialRef, renewal)
    return renewal
  }

  private async performRenewal(
    credentialRef: string,
    credential: TradovateCredential,
  ): Promise<TradovateCredential> {
    const controller = new AbortController()
    this.controllers.add(controller)
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(
        'https://demo.tradovateapi.com/v1/auth/renewaccesstoken',
        {
          method: 'GET',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${credential.access_token}`,
          },
        },
      )
      if (!response.ok) {
        this.renewalBlockedUntil.set(
          credentialRef,
          Date.parse(this.now()) + (response.status === 429 ? 60 * 60_000 : 15_000),
        )
        throw new ExecutionAdapterError(
          response.status === 429 ? 'TRADOVATE_RATE_LIMITED' : 'TRADOVATE_TOKEN_RENEWAL_FAILED',
          `Tradovate token renewal returned HTTP ${response.status}.`,
          false,
        )
      }
      const body = await response.json() as TradovateRenewalResponse
      const penalty = renewalPenalty(body)
      if (penalty) {
        this.renewalBlockedUntil.set(
          credentialRef,
          Date.parse(this.now()) + (penalty.captcha ? 60 * 60_000 : penalty.waitSeconds * 1_000),
        )
        throw new ExecutionAdapterError(
          penalty.captcha ? 'TRADOVATE_CAPTCHA_REQUIRED' : 'TRADOVATE_PENALTY_TICKET',
          penalty.captcha
            ? 'Tradovate requires user intervention before token renewal can resume.'
            : `Tradovate deferred token renewal for ${penalty.waitSeconds} seconds.`,
          false,
        )
      }
      const accessToken = body.accessToken?.trim()
      const expiresAt = body.expirationTime
      if (
        body.errorText
        || !accessToken
        || accessToken === credential.access_token
        || !expiresAt
        || !Number.isFinite(Date.parse(expiresAt))
        || Date.parse(expiresAt) <= Date.parse(this.now())
        || Date.parse(expiresAt) <= Date.parse(credential.expires_at!)
      ) {
        throw new ExecutionAdapterError(
          'TRADOVATE_TOKEN_RENEWAL_FAILED',
          'Tradovate token renewal returned invalid or rejected credentials.',
          false,
        )
      }
      const rotated: TradovateCredential = {
        ...credential,
        access_token: accessToken,
        expires_at: new Date(expiresAt).toISOString(),
      }
      if (this.stopped) {
        throw new ExecutionAdapterError(
          'TRADOVATE_TOKEN_RENEWAL_STOPPED',
          'Tradovate token renewal stopped before credential rotation.',
          false,
        )
      }
      await this.options.rotateCredential!({
        credentialRef,
        expectedTokenFingerprint: tokenFingerprint(credential.access_token),
        credential: rotated,
      })
      if (this.stopped) {
        throw new ExecutionAdapterError(
          'TRADOVATE_TOKEN_RENEWAL_STOPPED',
          'Tradovate token renewal stopped before credential distribution.',
          false,
        )
      }
      return rotated
    } catch (error) {
      if (!this.renewalBlockedUntil.has(credentialRef)) {
        this.renewalBlockedUntil.set(credentialRef, Date.parse(this.now()) + 15_000)
      }
      if (error instanceof ExecutionAdapterError) throw error
      throw new ExecutionAdapterError(
        'TRADOVATE_TOKEN_RENEWAL_FAILED',
        error instanceof Error ? error.message : 'Tradovate token renewal failed.',
        false,
      )
    } finally {
      clearTimeout(timeout)
      this.controllers.delete(controller)
    }
  }
}

const renewalPenalty = (body: unknown): { captcha: boolean; waitSeconds: number } | null => {
  if (!body || typeof body !== 'object') return null
  const value = body as Record<string, unknown>
  if (typeof value['p-ticket'] !== 'string' || !value['p-ticket']) return null
  return {
    captcha: value['p-captcha'] === true,
    waitSeconds: typeof value['p-time'] === 'number' && Number.isFinite(value['p-time'])
      ? Math.max(0, value['p-time'])
      : 15,
  }
}

export const tokenFingerprint = (token: string): string => (
  createHash('sha256').update(token).digest('hex')
)
