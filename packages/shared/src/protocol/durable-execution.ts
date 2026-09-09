/** Host-owned v2 read-only execution contract. Never accept callbacks/authority from renderer DTOs. */
export type DurableJson = null | boolean | number | string | DurableJson[] | { [key: string]: DurableJson };
export interface DurableRuntimeManifest {
  piAgentCore: string; piAi: string; piCodingAgent: string; adapterRevision: string;
}
/** Bump adapterRevision whenever replay/normalization/authorization semantics change. */
export const DURABLE_RUNTIME_MANIFEST: Readonly<DurableRuntimeManifest> = Object.freeze({
  piAgentCore: '0.84.3', piAi: '0.84.3', piCodingAgent: '0.84.3', adapterRevision: 'pi-readonly-4',
});
export type DurableRunStatus = 'running' | 'paused' | 'waiting-approval' | 'succeeded' | 'cancelled' | 'failed';
export interface DurableToolAuthorization {
  principalId: string;
  policyRevision: string;
  credentialIdentity: string;
  allowed: boolean;
  requiresApproval: boolean;
  approvalExpiresAt: number;
}
export interface DurableApproval {
  id: string;
  operationId: string;
  turn: number;
  callId: string;
  tool: string;
  inputDigest: string;
  principalId: string;
  policyRevision: string;
  credentialIdentity: string;
  expiresAt: number;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed' | 'superseded';
  decisionPrincipalId?: string;
}
export interface DurableDecisionCommand {
  runId: string;
  workspaceId: string;
  commandId: string;
  expectedVersion: number;
  action: 'approve' | 'deny';
  approvalId: string;
  inputDigest: string;
  principalId: string;
  policyRevision: string;
  credentialIdentity: string;
}
export interface DurableDecisionReceipt extends Omit<DurableControlReceipt, 'action'> {
  action: DurableDecisionCommand['action'];
  approvalId: string;
}
/** Ordered host-authorized update. The receipt acknowledges persistence, not application. */
export interface DurableSteeringCommand {
  runId: string;
  workspaceId: string;
  commandId: string;
  expectedVersion: number;
  action: 'steer';
  text: string;
}
export interface DurableSteeringEntry {
  commandId: string;
  sequence: number;
  text: string;
  /** Revision equals the ordered sequence; assigned to a safe boundary before model dispatch. */
  appliedAfterTurn?: number;
}
export interface DurableSteeringReceipt extends Omit<DurableControlReceipt, 'action'> {
  action: 'steer';
  sequence: number;
}
export interface DurableControlCommand {
  runId: string;
  workspaceId: string;
  commandId: string;
  expectedVersion: number;
  action: 'pause' | 'resume' | 'cancel';
}
/** The immutable receipt describes when this command was applied, not the current projection. */
export interface DurableControlReceipt {
  runId: string;
  workspaceId: string;
  commandId: string;
  action: DurableControlCommand['action'];
  version: number;
  status: DurableRunStatus;
  controlRevision: number;
}
/** Exact API-key/bearer transport identity. Rotation requires a new admitted run. */
export async function durableCredentialIdentity(transport: { provider: string; credential: { type: 'api_key'; key: string } }): Promise<string> {
  if (!transport.provider || transport.credential.type !== 'api_key' || !transport.credential.key) throw new Error('durable-credential-unsupported');
  const bytes = new TextEncoder().encode(JSON.stringify({ credential: { key: transport.credential.key, type: 'api_key' }, provider: transport.provider }));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export interface DurableExecutionDescriptor {
  credentialIdentity: string;
  runtimeManifest: DurableRuntimeManifest;
  engine: 'sqlite-v2-readonly-1';
  runId: string;
  workspaceId: string;
  createdAt: number;
  /** P-02 supports only explicitly certified local Pi read tools. No MCP/proxy effects. */
  allowedTools: Array<'read' | 'grep' | 'find' | 'ls'>;
  model: string;
  maxOutputTokens: number;
}
export type DurableCheckpoint =
  | { kind: 'model-start'; turn: number; context: DurableJson }
  | { kind: 'model-result'; turn: number; message: DurableJson }
  | { kind: 'tool-disposition'; turn: number; callId: string; tool: string }
  | { kind: 'tool-start'; turn: number; callId: string; tool: string; input: DurableJson }
  | { kind: 'tool-result'; turn: number; callId: string; result: DurableJson }
  | { kind: 'turn-boundary'; turn: number }
  | { kind: 'complete' };
export interface DurableCheckpointReply {
  cached?: DurableJson;
  steering?: DurableSteeringEntry[];
  /** Durable non-execution disposition; SDK emits an honest skipped tool error. */
  skipped?: boolean;
}
export interface DurableExecutionBridge {
  descriptor: DurableExecutionDescriptor;
  checkpoint(request: DurableCheckpoint): Promise<DurableCheckpointReply>;
  /** Persist control intent before aborting the SDK. Errors must prevent successor dispatch. */
  cancel(): Promise<void>;
  fail(reason: string): Promise<void>;
}
