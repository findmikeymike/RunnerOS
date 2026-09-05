import type { EntitlementClaimsV2 } from "./voicecore-entitlement.mjs";

export type OperatorIdentity = Readonly<{ subject: string; workspace_id?: string; app_id?: string }>;
export type GatewayUsage = Readonly<{ prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }>;
export type GatewayContext = Readonly<{
  request_id: string; token_id: string; subject: string; workspace_id: string | null;
  license_id: string; customer_id: string; provider: string; model: string;
  request_bytes: number; requested_max_tokens: number | null;
  requested_token_field: "max_tokens" | "max_completion_tokens" | null;
  requested_choices: number; requested_best_of: number | null;
  estimated_max_output_tokens: number | null;
}>;

export function createVoiceCoreOperatorGateway(options: {
  gatewayApiBase: string;
  credentialPath?: string;
  credentialSecrets: readonly string[];
  credentialTtlSeconds?: number;
  sdkReleaseUnix: number;
  allowInsecureLoopback?: boolean;
  providers: Record<string, {
    apiBase: string;
    authorizeModel(input: { identity: Readonly<{ subject: string; workspace_id?: string | null }>; model: string }): boolean | Promise<boolean>;
    getCredential(context: GatewayContext): string | null | Promise<string | null>;
    allowUnauthenticated?: boolean;
  }>;
  authenticate(request: Request): OperatorIdentity | null | Promise<OperatorIdentity | null>;
  loadEntitlement(identity: OperatorIdentity): { claims: EntitlementClaimsV2; revoked: boolean } | Promise<{ claims: EntitlementClaimsV2; revoked: boolean }>;
  isCredentialRevoked(identity: Readonly<{ token_id: string; license_id: string; customer_id: string; subject: string; workspace_id: string | null }>): boolean | Promise<boolean>;
  admit(context: GatewayContext): true | Promise<true>;
  /** Idempotently and atomically tombstone/release this request ID, including before a late admit result. Retries of the same ID must have one accounting effect. */
  cancelAdmission(result: Readonly<{ request_id: string; reason: string }>): unknown | Promise<unknown>;
  /** Idempotently settle usage/outcome by request ID. Retries of the same ID must have one accounting effect. */
  completeAdmission(result: Readonly<{ request_id: string; outcome: string; usage: GatewayUsage | null; subject: string; workspace_id: string | null; license_id: string; customer_id: string; provider: string; model: string }>): unknown | Promise<unknown>;
  /** Completion events carry a stable event_id; the sink must deduplicate retries of that ID. */
  audit(event: Readonly<Record<string, unknown>>): unknown | Promise<unknown>;
  fetchImpl?: typeof fetch;
  nowSeconds?: () => number;
  randomId?: () => string;
  limits?: { maxRequestBodyBytes?: number; maxResponseBytes?: number; maxSseEventBytes?: number; requestTimeoutMs?: number; hookTimeoutMs?: number; /** @deprecated use requestTimeoutMs */ upstreamTimeoutMs?: number; maxConcurrent?: number; maxCredentialConcurrent?: number; maxRejectionAuditConcurrent?: number };
}): Readonly<{ handle(request: Request): Promise<Response> }>;
