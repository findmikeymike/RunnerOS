/**
 * ACP (Agent Client Protocol) adapter — public surface.
 *
 * Ported from Hermes hermes_acp/ (MIT). See THIRD_PARTY_NOTICES.md.
 */

export * from './types.ts';
export {
  getToolKind,
  buildToolTitle,
  buildToolStart,
  buildToolComplete,
  makeToolCallId,
  jsonLoadsMaybe,
} from './tools.ts';
export {
  buildPermissionOptions,
  makeApprovalCallback,
  isSensitivePath,
  shouldAutoApproveEdit,
  makeAcpEditApprovalRequester,
  editApprovalStorage,
  getEditApprovalRequester,
  setEditApprovalRequester,
} from './permissions.ts';
export type {
  PermissionOutcome,
  RequestPermissionFn,
  EditApprovalRequester,
} from './permissions.ts';
export {
  safeScheduleAcross,
  createToolCallTracker,
  makeToolProgressCb,
  makeStepCb,
  makeThinkingCb,
  makeMessageCb,
  buildPlanUpdateFromTodoResult,
} from './events.ts';
export type { SessionUpdateSender, ToolCallTracker } from './events.ts';
export { SessionManager, translateAcpCwd } from './session.ts';
export type { AcpSessionState } from './session.ts';
export { RunnerOSACPAgent, acpStderrPrint } from './server.ts';
export type { RunnerOSACPAgentOptions, PromptHandler } from './server.ts';
export { ACPClient } from './client.ts';
export type { ACPClientOptions } from './client.ts';
