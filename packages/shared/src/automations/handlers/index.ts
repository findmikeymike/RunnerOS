/**
 * Automation Handlers - Re-exports for convenience
 */

export type {
  AutomationHandler,
  PromptHandlerOptions,
  QueueWorkHandlerOptions,
  EventLogHandlerOptions,
  PromptProcessingResult,
  AutomationsConfigProvider,
} from './types.ts';

export { PromptHandler } from './prompt-handler.ts';
export { QueueWorkHandler } from './queue-work-handler.ts';
export { EventLogHandler } from './event-log-handler.ts';
export { WebhookHandler, type WebhookHandlerOptions } from './webhook-handler.ts';
export {
  ShellHookHandler,
  buildHookEvent,
  type ShellHookAction,
  type ShellHookHandlerOptions,
  type ShellHookOutcome,
} from './shell-hook-handler.ts';
export {
  AcpSpawnHandler,
  type AcpSpawnAction,
  type AcpSpawnHandlerOptions,
} from './acp-spawn-handler.ts';
