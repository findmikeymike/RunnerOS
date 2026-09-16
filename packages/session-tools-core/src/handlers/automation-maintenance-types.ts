import type { ScheduleWorkExecutionInput, ScheduleWorkTriggerInput } from './schedule-work.ts';

export interface AutomationMaintenanceSummary {
  automationId: string;
  eventName: string;
  name: string;
  enabled: boolean;
  protected: boolean;
  revision: string;
  triggerSummary: string;
  executionTarget: string;
  lastOutcome?: unknown;
}
export interface AutomationMaintenanceDetail extends AutomationMaintenanceSummary {
  description?: string;
  trigger?: ScheduleWorkTriggerInput;
  execution?: ScheduleWorkExecutionInput;
}
export interface ListAutomationsInput { limit?: number }
export interface GetAutomationInput { automationId: string }
export interface UpdateAutomationInput {
  automationId: string;
  expectedRevision: string;
  intent: string;
  patch: {
    name?: string;
    description?: string;
    enabled?: boolean;
    trigger?: ScheduleWorkTriggerInput;
    execution?: ScheduleWorkExecutionInput;
  };
}
export type ListAutomationsResult = { ok: true; automations: AutomationMaintenanceSummary[]; hasMore: boolean } | { ok: false; error: string };
export type GetAutomationResult = { ok: true; automation: AutomationMaintenanceDetail } | { ok: false; error: string };
export type UpdateAutomationResult = { ok: true; automation: AutomationMaintenanceDetail; changed: boolean; canceledQueuedWork: number; runningWork: number } | { ok: false; error: string };
