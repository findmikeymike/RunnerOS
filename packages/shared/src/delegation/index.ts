/**
 * @craft-agent/shared/delegation
 *
 * Canonical agent-to-agent delegation contract shared by team runs, workflow
 * steps, and (on merge) the agent-messaging `message_agent` tool. See
 * ./types.ts for the rationale on the message_agent-compatible shape.
 */

export type {
  CreateDelegationReceiptInput,
  DelegationConstraints,
  DelegationError,
  DelegationOutcome,
  DelegationPolicy,
  DelegationReceipt,
  DelegationResult,
  DelegationStatus,
  PermissionInheritance,
} from './types.ts';

export {
  clampPermissionMode,
  createDelegationReceipt,
  derivePermissionInheritance,
  failDelegationReceipt,
  isDelegationReceipt,
  isPermissionEscalation,
  succeedDelegationReceipt,
  toDelegationResult,
} from './receipt.ts';
