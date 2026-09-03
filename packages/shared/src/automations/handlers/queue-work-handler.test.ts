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
      actionIndex: 0,
      automationName: 'Process new brief',
      event: 'FileWatch',
      eventTimestamp: 1234,
      eventKey: 'FileWatch:1234:7ea9df96f738236f1395',
      triggerData: {
        'file.path': '/workspace/inbox/brief.md',
        'file.name': 'brief.md',
      },
      action: {
        title: 'Process brief.md',
        execution: { brief: 'Read /workspace/inbox/brief.md and create a campaign brief.' },
      },
      configuredAction: {
        title: 'Process $CRAFT_RELATIVE_PATH',
        execution: { brief: 'Read $CRAFT_PATH and create a campaign brief.' },
      },
    });
    handler.dispose();
  });

  it('assigns distinct stable indexes to sibling tracked-work actions', async () => {
    const onWorkReady = jest.fn();
    const actions = [
      {
        type: 'queue-work' as const, ownerScope: 'campaign' as const, title: 'First',
        execution: { type: 'agent-task' as const, agentSlug: 'content-agent', brief: 'First.', permissionMode: 'safe' as const, expectedOutput: { requirement: 'none' as const } },
      },
      { type: 'prompt' as const, prompt: 'Untracked action.' },
      {
        type: 'queue-work' as const, ownerScope: 'campaign' as const, title: 'Second',
        execution: { type: 'agent-task' as const, agentSlug: 'content-agent', brief: 'Second.', permissionMode: 'safe' as const, expectedOutput: { requirement: 'none' as const } },
      },
    ];
    const handler = new QueueWorkHandler({ workspaceId: 'workspace-1', workspaceRootPath: '/workspace', onWorkReady }, provider({
      SchedulerTick: [{ id: 'siblings', cron: '* * * * *', actions }],
    }));
    handler.subscribe(bus);

    await bus.emit('SchedulerTick', {
      workspaceId: 'workspace-1', timestamp: 1234, localTime: '09:00', utcTime: new Date(1234).toISOString(),
    });

    const queued = onWorkReady.mock.calls[0]![0] as PendingQueuedWork[];
    expect(queued.map((item) => [item.actionIndex, item.action.title])).toEqual([[0, 'First'], [1, 'Second']]);
    handler.dispose();
  });

  it('gives same-millisecond file changes distinct stable identities', async () => {
    const onWorkReady = jest.fn();
    const handler = new QueueWorkHandler({ workspaceId: 'workspace-1', workspaceRootPath: '/workspace', onWorkReady }, provider({
      FileWatch: [{
        id: 'file-agent', watchPath: 'inbox', actions: [{
          type: 'queue-work', ownerScope: 'campaign', title: 'Process file',
          execution: { type: 'agent-task', agentSlug: 'content-agent', brief: 'Process.', permissionMode: 'safe', expectedOutput: { requirement: 'none' } },
        }],
      }],
    }));
    handler.subscribe(bus);
    const base = {
      workspaceId: 'workspace-1', timestamp: 1234, matcherId: 'file-agent',
      changeType: 'add' as const, size: 50, isDirectory: false,
    };

    await bus.emit('FileWatch', { ...base, eventId: 'event-a', path: '/workspace/inbox/a.md', relativePath: 'a.md' });
    await bus.emit('FileWatch', { ...base, eventId: 'event-b', path: '/workspace/inbox/a.md', relativePath: 'a.md' });
    await bus.emit('FileWatch', { ...base, eventId: 'event-a', path: '/workspace/inbox/a.md', relativePath: 'a.md' });

    const first = (onWorkReady.mock.calls[0]![0] as PendingQueuedWork[])[0]!.eventKey;
    const second = (onWorkReady.mock.calls[1]![0] as PendingQueuedWork[])[0]!.eventKey;
    const redelivery = (onWorkReady.mock.calls[2]![0] as PendingQueuedWork[])[0]!.eventKey;
    expect(first).not.toBe(second);
    expect(redelivery).toBe(first);
    handler.dispose();
  });

  it('keeps fixed workflow input values literal while expanding action text', async () => {
    const onWorkReady = jest.fn();
    const handler = new QueueWorkHandler({ workspaceId: 'workspace-1', workspaceRootPath: '/workspace', onWorkReady }, provider({
      FileWatch: [{
        id: 'file-workflow',
        watchPath: 'inbox',
        actions: [{
          type: 'queue-work',
          ownerScope: 'campaign',
          title: 'Process $CRAFT_RELATIVE_PATH',
          execution: { type: 'workflow-run', workflowSlug: 'demo', workflowDigest: 'digest', triggerInputs: {} },
          inputBindings: { output_path: { mode: 'fixed', value: '$HOME/report' } },
        }],
      }],
    }));
    handler.subscribe(bus);

    await bus.emit('FileWatch', {
      workspaceId: 'workspace-1', timestamp: 1234, matcherId: 'file-workflow', path: '/workspace/inbox/brief.md',
      relativePath: 'brief.md', changeType: 'add', size: 50, isDirectory: false,
    });

    const queued = (onWorkReady.mock.calls[0]![0] as PendingQueuedWork[])[0]!;
    expect(queued.action.title).toBe('Process brief.md');
    expect(queued.action.inputBindings).toEqual({ output_path: { mode: 'fixed', value: '$HOME/report' } });
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

  it('keeps catch-up work identity stable across restart redelivery', async () => {
    const onWorkReady = jest.fn();
    const handler = new QueueWorkHandler({ workspaceId: 'workspace-1', workspaceRootPath: '/workspace', onWorkReady }, provider({
      SchedulerTick: [{
        id: 'daily-agent',
        cron: '* * * * *',
        actions: [{
          type: 'queue-work',
          ownerScope: 'hq',
          title: 'Daily task',
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

    const catchUpFromMs = Date.now() - 5 * 60_000;
    await bus.emit('SchedulerTick', {
      workspaceId: 'workspace-1', timestamp: Date.now(), localTime: '10:00',
      utcTime: new Date().toISOString(), catchUp: true, catchUpFromMs,
    });
    await bus.emit('SchedulerTick', {
      workspaceId: 'workspace-1', timestamp: Date.now() + 1_000, localTime: '10:00',
      utcTime: new Date(Date.now() + 1_000).toISOString(), catchUp: true, catchUpFromMs,
    });

    const first = (onWorkReady.mock.calls[0]![0] as PendingQueuedWork[])[0]!;
    const second = (onWorkReady.mock.calls[1]![0] as PendingQueuedWork[])[0]!;
    expect(first.eventKey).toBe(`SchedulerTick:catch-up:${catchUpFromMs}`);
    expect(second.eventKey).toBe(first.eventKey);
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
    expect(second.triggerData).toEqual({ 'message.text': 'Go' });
    handler.dispose();
  });

  it('carries raw webhook and URL content for string workflow bindings', async () => {
    const onWorkReady = jest.fn();
    const handler = new QueueWorkHandler({ workspaceId: 'workspace-1', workspaceRootPath: '/workspace', onWorkReady }, provider({
      WebhookReceive: [{
        id: 'webhook-workflow',
        slug: 'demo',
        actions: [{
          type: 'queue-work',
          ownerScope: 'campaign',
          title: 'Handle webhook',
          execution: { type: 'workflow-run', workflowSlug: 'demo', workflowDigest: 'digest', triggerInputs: {} },
          inputBindings: { payload: { mode: 'trigger', from: 'webhook.body' } },
        }],
      }],
      PollUrl: [{
        id: 'url-workflow',
        actions: [{
          type: 'queue-work',
          ownerScope: 'campaign',
          title: 'Handle page',
          execution: { type: 'workflow-run', workflowSlug: 'demo', workflowDigest: 'digest', triggerInputs: {} },
          inputBindings: { content: { mode: 'trigger', from: 'url.content' } },
        }],
      }],
    }));
    handler.subscribe(bus);

    await bus.emit('WebhookReceive', {
      workspaceId: 'workspace-1', timestamp: 100, slug: 'demo', method: 'POST', headers: {}, query: {},
      body: { topic: 'launch' }, bodyRaw: '{"topic":"launch"}', remoteIp: '127.0.0.1',
    });
    await bus.emit('PollUrl', {
      workspaceId: 'workspace-1', timestamp: 200, matcherId: 'url-workflow', url: 'https://example.com/feed',
      status: 200, fingerprintKind: 'body', fingerprint: 'new', previousFingerprint: 'old', body: 'Latest page', headers: {},
    });

    expect((onWorkReady.mock.calls[0]![0] as PendingQueuedWork[])[0]?.triggerData)
      .toEqual({ 'webhook.body': '{"topic":"launch"}' });
    expect((onWorkReady.mock.calls[1]![0] as PendingQueuedWork[])[0]?.triggerData)
      .toEqual({ 'url.content': 'Latest page' });
    handler.dispose();
  });

  it('reports refused unauthenticated webhook work with matcher details', async () => {
    const onWorkReady = jest.fn();
    const onWorkRejected = jest.fn();
    const onError = jest.fn();
    const handler = new QueueWorkHandler({
      workspaceId: 'workspace-1', workspaceRootPath: '/workspace', onWorkReady, onWorkRejected, onError,
    }, provider({
      WebhookReceive: [{
        id: 'unsigned-hook', slug: 'unsigned', allowUnauthenticated: true,
        actions: [{
          type: 'queue-work', ownerScope: 'campaign', title: 'Use webhook body',
          execution: { type: 'workflow-run', workflowSlug: 'demo', workflowDigest: 'digest', triggerInputs: {} },
          inputBindings: { payload: { mode: 'trigger', from: 'webhook.body' } },
        }],
      }],
    }));
    handler.subscribe(bus);

    await bus.emit('WebhookReceive', {
      workspaceId: 'workspace-1', timestamp: 100, slug: 'unsigned', method: 'POST', headers: {}, query: {},
      body: { topic: 'launch' }, bodyRaw: '{"topic":"launch"}', remoteIp: '127.0.0.1',
    });

    expect(onWorkReady).not.toHaveBeenCalled();
    expect(onWorkRejected).toHaveBeenCalledTimes(1);
    expect(onWorkRejected.mock.calls[0]![0]).toMatchObject({
      event: 'WebhookReceive', matcherId: 'unsigned-hook', workTitle: 'Use webhook body',
      error: { message: 'Unauthenticated webhooks cannot supply workflow input values.' },
    });
    expect(onError).toHaveBeenCalledTimes(1);
    handler.dispose();
  });
});
