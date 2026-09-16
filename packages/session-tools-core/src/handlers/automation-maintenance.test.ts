import { describe, expect, test } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleListAutomations } from './list-automations.ts';
import { handleGetAutomation } from './get-automation.ts';
import { handleUpdateAutomation } from './update-automation.ts';
import { GetAutomationSchema, ListAutomationsSchema, UpdateAutomationSchema, ScheduleWorkSchema, getSessionToolDefs } from '../tool-defs.ts';
import type { AutomationMaintenanceDetail, UpdateAutomationInput } from './automation-maintenance-types.ts';

const automation: AutomationMaintenanceDetail = { automationId: 'weekly-report', eventName: 'SchedulerTick', name: 'Weekly report', enabled: true, protected: false, revision: 'revision-1', triggerSummary: 'Fridays', executionTarget: 'reporter' };
const update: UpdateAutomationInput = { automationId: automation.automationId, expectedRevision: automation.revision, intent: 'Pause the weekly report', patch: { enabled: false } };
const ctx = (callbacks: Partial<SessionToolContext>) => callbacks as SessionToolContext;

describe('Builder automation maintenance tools', () => {
  test('cannot run without their host capabilities', async () => {
    expect((await handleListAutomations(ctx({}), {})).isError).toBe(true);
    expect((await handleGetAutomation(ctx({}), { automationId: 'weekly-report' })).isError).toBe(true);
    expect((await handleUpdateAutomation(ctx({}), update)).isError).toBe(true);
  });
  test('list is bounded and uses only the current workspace', async () => {
    let limit = 0;
    const context = ctx({ listAutomations: async input => { limit = input.limit!; return { ok: true, automations: [automation], hasMore: false }; } });
    const result = await handleListAutomations(context, {});
    expect(result.isError).toBe(false);
    expect(limit).toBe(20);
    expect((await handleListAutomations(context, { limit: 51 })).isError).toBe(true);
    expect((await handleListAutomations(context, { workspaceId: 'other' } as never)).isError).toBe(true);
    expect(limit).toBe(20);
  });
  test('get returns the revision and only host-redacted editable view', async () => {
    let id = '';
    const result = await handleGetAutomation(ctx({ getAutomation: async input => { id = input.automationId; return { ok: true, automation }; } }), { automationId: automation.automationId });
    expect(result.isError).toBe(false);
    expect(id).toBe(automation.automationId);
    expect(JSON.parse((result.content[0] as { text: string }).text).automation.revision).toBe('revision-1');
  });
  test('passes one exact update and exposes queued versus running effects', async () => {
    let received: UpdateAutomationInput | undefined;
    const result = await handleUpdateAutomation(ctx({ updateAutomation: async input => { received = input; return { ok: true, automation: { ...automation, enabled: false }, changed: true, canceledQueuedWork: 2, runningWork: 1 }; } }), update);
    expect(received).toEqual(update);
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ canceledQueuedWork: 2, runningWork: 1 });
  });
  test('stale conflict is surfaced without retrying or creating a definition', async () => {
    let calls = 0;
    const result = await handleUpdateAutomation(ctx({ updateAutomation: async () => { calls++; throw new Error('Revision conflict. Re-read this automation.'); } }), update);
    expect(result.isError).toBe(true);
    expect(calls).toBe(1);
    expect((result.content[0] as { text: string }).text).toContain('Revision conflict');
  });
  test('rejects raw matcher/actions, workspace override, and absent change intent before host', async () => {
    let calls = 0;
    const context = ctx({ updateAutomation: async () => { calls++; return { ok: false, error: 'unexpected' }; } });
    for (const input of [{ ...update, patch: { actions: [] } }, { ...update, workspaceId: 'other' }, { ...update, intent: '' }, { ...update, expectedRevision: '' }, { ...update, patch: {} }]) {
      expect((await handleUpdateAutomation(context, input as never)).isError).toBe(true);
    }
    expect(calls).toBe(0);
  });
  test('schemas accept typed schedule execution and reject invalid modes or raw patches', () => {
    expect(UpdateAutomationSchema.safeParse({ ...update, patch: { trigger: { type: 'schedule', cron: '0 9 * * 5', timezone: 'America/Chicago' }, execution: { type: 'workflow-run', workflowSlug: 'weekly-report', inputBindings: { topic: { mode: 'ask' } } } } }).success).toBe(true);
    expect(UpdateAutomationSchema.safeParse({ ...update, patch: { execution: { type: 'agent-task', agentSlug: 'reporter', brief: 'Report', permissionMode: 'admin' } } }).success).toBe(false);
    for (const permissionMode of ['safe', 'ask', 'allow-all']) {
      for (const execution of [
        { type: 'agent-task', agentSlug: 'reporter', brief: 'Report', permissionMode },
        { type: 'workflow-run', workflowSlug: 'weekly-report', permissionMode },
      ]) expect(UpdateAutomationSchema.safeParse({ ...update, patch: { execution } }).success).toBe(true);
    }
    expect(UpdateAutomationSchema.safeParse({ ...update, patch: { actions: [] } }).success).toBe(false);
    expect(ListAutomationsSchema.safeParse({ limit: 1000 }).success).toBe(false);
    expect(GetAutomationSchema.safeParse({ automationId: 'id', workspaceId: 'other' }).success).toBe(false);
  });
  test('maintenance visibility is opt-in; read tools are read-only and update requires write permission', () => {
    expect(getSessionToolDefs().some(tool => tool.name === 'update_automation')).toBe(false);
    const tools = getSessionToolDefs({ includeAutomationMaintenance: true });
    expect(tools.find(tool => tool.name === 'list_automations')?.readOnly).toBe(true);
    expect(tools.find(tool => tool.name === 'get_automation')?.readOnly).toBe(true);
    expect(tools.find(tool => tool.name === 'update_automation')?.safeMode).toBe('block');
  });
  test('maintenance schemas match host description and explicit schedule requirements without changing creation', () => {
    for (const description of ['', '   ', 'x'.repeat(2001)]) {
      expect(UpdateAutomationSchema.safeParse({ ...update, patch: { description } }).success).toBe(false);
    }
    expect(UpdateAutomationSchema.safeParse({ ...update, patch: { description: 'x'.repeat(2000) } }).success).toBe(true);
    for (const trigger of [
      { type: 'schedule', cadence: 'weekly' },
      { type: 'schedule', cron: ' ' },
      { type: 'schedule', cron: '0 9 * * 5', cadence: 'weekly' },
    ]) {
      expect(UpdateAutomationSchema.safeParse({ ...update, patch: { trigger } }).success).toBe(false);
    }
    expect(ScheduleWorkSchema.safeParse({
      idempotencyKey: 'new-weekly-report', destination: 'automation', title: 'Weekly report', explanation: 'Requested report',
      execution: { type: 'agent-task', agentSlug: 'reporter', brief: 'Prepare report' },
      trigger: { type: 'schedule', cadence: 'weekly' },
    }).success).toBe(true);
  });
});
