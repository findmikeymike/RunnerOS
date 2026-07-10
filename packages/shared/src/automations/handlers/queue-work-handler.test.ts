import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { WorkspaceEventBus } from '../event-bus.ts';
import type { AutomationEvent, AutomationMatcher, PendingQueuedWork } from '../types.ts';
import { QueueWorkHandler } from './queue-work-handler.ts';
import type { AutomationsConfigProvider } from './types.ts';

function provider(matchers: Partial<Record<AutomationEvent, AutomationMatcher[]>>): AutomationsConfigProvider {
  return {
    getConfig: () => ({ automations: matchers }),
    getMatchersForEvent: (event) => matchers[event] ?? [],
  };
}

describe('QueueWorkHandler', () => {
  let bus: WorkspaceEventBus;

  beforeEach(() => {
    bus = new WorkspaceEventBus('workspace-1');
  });

  afterEach(() => {
    bus.dispose();
  });

  it('expands trigger data into a typed tracked agent task', async () => {
    const onWorkReady = jest.fn();
    const handler = new QueueWorkHandler({ workspaceId: 'workspace-1', workspaceRootPath: '/workspace', onWorkReady }, provider({
      FileWatch: [{
        id: 'file-agent',
        name: 'Process new brief',
        watchPath: 'inbox',
        actions: [{
          type: 'queue-work',
          ownerScope: 'campaign',
          title: 'Process $CRAFT_RELATIVE_PATH',
          execution: {
            type: 'agent-task',
            agentSlug: 'content-agent',
            brief: 'Read $CRAFT_PATH and create a campaign brief.',
            permissionMode: 'safe',
            expectedOutput: { requirement: 'required', kind: 'document' },
          },
        }],
      }],
    }));
    handler.subscribe(bus);

    await bus.emit('FileWatch', {
      workspaceId: 'workspace-1',
      timestamp: 1234,
      matcherId: 'file-agent',
      path: '/workspace/inbox/brief.md',
      relativePath: 'brief.md',
      changeType: 'add',
      size: 50,
      isDirectory: false,
    });

    const queued = onWorkReady.mock.calls[0]![0] as PendingQueuedWork[];
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      matcherId: 'file-agent',
      automationName: 'Process new brief',
      event: 'FileWatch',
      eventTimestamp: 1234,
      eventKey: 'FileWatch:1234',
      action: {
        title: 'Process brief.md',
        execution: { brief: 'Read /workspace/inbox/brief.md and create a campaign brief.' },
      },
    });
    handler.dispose();
  });

  it('does not queue work from a matcher without a durable id', async () => {
    const onWorkReady = jest.fn();
    const handler = new QueueWorkHandler({ workspaceId: 'workspace-1', workspaceRootPath: '/workspace', onWorkReady }, provider({
      SchedulerTick: [{
        cron: '* * * * *',
        actions: [{
          type: 'queue-work',
          ownerScope: 'campaign',
          title: 'Tracked task',
          execution: {
            type: 'agent-task',
            agentSlug: 'content-agent',
            brief: 'Work.',
            permissionMode: 'safe',
            expectedOutput: { requirement: 'none' },
          },
        }],
      }],
    }));
    handler.subscribe(bus);

    await bus.emit('SchedulerTick', {
      workspaceId: 'workspace-1',
      timestamp: Date.now(),
      localTime: '10:00',
      utcTime: new Date().toISOString(),
    });

    expect(onWorkReady).not.toHaveBeenCalled();
    handler.dispose();
  });

  it('preserves stable message identity across redelivery timestamps', async () => {
    const onWorkReady = jest.fn();
    const handler = new QueueWorkHandler({ workspaceId: 'workspace-1', workspaceRootPath: '/workspace', onWorkReady }, provider({
      MessageReceive: [{
        id: 'message-agent',
        actions: [{
          type: 'queue-work',
          ownerScope: 'campaign',
          title: 'Handle message',
          execution: {
            type: 'agent-task',
            agentSlug: 'content-agent',
            brief: 'Handle the inbound message.',
            permissionMode: 'safe',
            expectedOutput: { requirement: 'none' },
          },
        }],
      }],
    }));
    handler.subscribe(bus);

    const message = {
      workspaceId: 'workspace-1',
      platform: 'telegram',
      channelId: 'channel-1',
      messageId: 'message-42',
      senderId: 'user-1',
      senderName: 'User',
      text: 'Go',
      bound: false,
      wasBound: false,
      boundAfterRoute: false,
      attachmentCount: 0,
      hasAttachment: false,
      sentAt: 1000,
    };
    await bus.emit('MessageReceive', { ...message, timestamp: 1100 });
    await bus.emit('MessageReceive', { ...message, timestamp: 2200 });

    const first = (onWorkReady.mock.calls[0]![0] as PendingQueuedWork[])[0]!;
    const second = (onWorkReady.mock.calls[1]![0] as PendingQueuedWork[])[0]!;
    expect(first.eventKey).toBe('message:telegram:channel-1:message-42');
    expect(second.eventKey).toBe(first.eventKey);
    expect(second.eventTimestamp).not.toBe(first.eventTimestamp);
    handler.dispose();
  });
});
