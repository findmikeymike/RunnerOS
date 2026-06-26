/**
 * Tests for WorkflowHandler
 */

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { WorkspaceEventBus } from '../event-bus.ts';
import type { AutomationEvent, AutomationMatcher, PendingWorkflow } from '../index.ts';
import type { AutomationsConfigProvider, WorkflowHandlerOptions } from './types.ts';
import { WorkflowHandler } from './workflow-handler.ts';

function createMockConfigProvider(matchersByEvent: Partial<Record<AutomationEvent, AutomationMatcher[]>> = {}): AutomationsConfigProvider {
  return {
    getConfig: () => ({ automations: matchersByEvent }),
    getMatchersForEvent: (event: AutomationEvent) => matchersByEvent[event] ?? [],
  };
}

function createOptions(overrides: Partial<WorkflowHandlerOptions> = {}): WorkflowHandlerOptions {
  return {
    workspaceId: 'test-workspace',
    workspaceRootPath: '/tmp/test-workspace',
    ...overrides,
  };
}

describe('WorkflowHandler', () => {
  let bus: WorkspaceEventBus;

  beforeEach(() => {
    bus = new WorkspaceEventBus('test-workspace');
  });

  afterEach(() => {
    bus.dispose();
  });

  it('queues matching workflow actions with expanded trigger inputs', async () => {
    const onWorkflowsReady = jest.fn();
    const configProvider = createMockConfigProvider({
      FileWatch: [{
        id: 'wf1234',
        actions: [{
          type: 'workflow',
          workflowSlug: 'campaign-health-check',
          triggerInputs: {
            campaign_data: 'File changed: $CRAFT_RELATIVE_PATH',
            payload: '$CRAFT_EVENT_DATA',
          },
        }],
      }],
    });

    const handler = new WorkflowHandler(createOptions({ onWorkflowsReady }), configProvider);
    handler.subscribe(bus);

    await bus.emit('FileWatch', {
      workspaceId: 'test-workspace',
      matcherId: 'wf1234',
      timestamp: Date.now(),
      watchPath: '/tmp/test-workspace/inbox',
      relativePath: 'reports/ad-report.csv',
      absolutePath: '/tmp/test-workspace/inbox/reports/ad-report.csv',
      changeType: 'add',
    });

    expect(onWorkflowsReady).toHaveBeenCalledTimes(1);
    const workflows: PendingWorkflow[] = onWorkflowsReady.mock.calls[0]![0];
    expect(workflows).toHaveLength(1);
    expect(workflows[0]).toMatchObject({
      workflowSlug: 'campaign-health-check',
      triggerInputs: {
        campaign_data: 'File changed: reports/ad-report.csv',
      },
    });
    expect(String(workflows[0]!.triggerInputs.payload)).toContain('ad-report.csv');

    handler.dispose();
  });

  it('does not queue workflows for non-matching events', async () => {
    const onWorkflowsReady = jest.fn();
    const configProvider = createMockConfigProvider({
      LabelAdd: [{
        matcher: 'urgent',
        actions: [{ type: 'workflow', workflowSlug: 'support-triage' }],
      }],
    });

    const handler = new WorkflowHandler(createOptions({ onWorkflowsReady }), configProvider);
    handler.subscribe(bus);

    await bus.emit('LabelAdd', {
      workspaceId: 'test-workspace',
      timestamp: Date.now(),
      label: 'normal',
    });

    expect(onWorkflowsReady).not.toHaveBeenCalled();

    handler.dispose();
  });
});
