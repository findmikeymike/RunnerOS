export type ExecutionGatewayErrorCode =
  | 'INTENT_CHECKSUM_MISMATCH'
  | 'INTENT_EXPIRED'
  | 'INTENT_EXISTS'
  | 'INTENT_NOT_FOUND'
  | 'RECORD_INTEGRITY_FAILURE'
  | 'INVALID_STATE'
  | 'RISK_DENIED'
  | 'STALE_RISK_DECISION'
  | 'AUTHORIZATION_MISMATCH'
  | 'AUTHORIZATION_EXPIRED'
  | 'CONNECTION_UNAVAILABLE'
  | 'ENVIRONMENT_MISMATCH'
  | 'CERTIFICATION_REQUIRED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'KILL_SWITCH_ENABLED'
  | 'ACCOUNT_MISMATCH'
  | 'ACCOUNT_SNAPSHOT_STALE'
  | 'SUBMIT_UNKNOWN'
  | 'ORDER_REJECTED'
  | 'RECONCILIATION_DIVERGENCE'
  | 'EXECUTION_BUSY'

export class ExecutionGatewayError extends Error {
  constructor(
    readonly code: ExecutionGatewayErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'ExecutionGatewayError'
  }
}

export class ExecutionAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly submissionMayHaveOccurred: boolean,
  ) {
    super(message)
    this.name = 'ExecutionAdapterError'
  }
}
