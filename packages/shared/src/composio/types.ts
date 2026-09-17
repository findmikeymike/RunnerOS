/** Public Composio contracts. API keys, auth tokens, and session IDs stay in the host. */
export interface ComposioStatus {
  configured: boolean
  state: 'not_configured' | 'not_connected' | 'pending' | 'connected' | 'expired' | 'error'
  accountLabel?: string
  /** Opaque selected account, included in write approval and checked again by the host. */
  accountId?: string
  /** Read from the selected Gmail profile; never inferred from a label or provided by the model. */
  accountEmail?: string
  error?: string
}

export interface ComposioSearchInput {
  query: string
  maxResults?: number
  pageToken?: string
}

export interface ComposioReadInput { messageId: string }

export interface ComposioEmailInput {
  accountId: string
  accountEmail: string
  to: string
  subject: string
  body: string
  cc?: string[]
  bcc?: string[]
}

export type ComposioOperation = 'search' | 'read' | 'draft' | 'send'
export type ComposioInput = ComposioSearchInput | ComposioReadInput | ComposioEmailInput
export interface ComposioToolResult {
  ok: boolean
  data?: unknown
  error?: string
  /** A write may have completed remotely. Do not automatically retry. */
  uncertain?: boolean
}
