import { describe, expect, test } from 'bun:test';
import { launchVideoStudioAgent } from './video-studio-agent';

function fixture(send: (...args: any[]) => Promise<void>) {
  let saved: any = null;
  const calls: any[] = [];
  const manager = {
    resolveAgentSessionOptions: async (...args: any[]) => { calls.push(args); return { permissionMode: 'ask' as const, model: 'saved-model', customSystemPrompt: 'saved persona', enabledSourceSlugs: ['video-studio'] }; },
    createSession: async (_workspace: string, options: any) => { calls.push(options); return { id: 'session-1' } as any; },
    sendMessage: send,
  };
  const drafts = { get: () => saved, set: (_id: string, draft: any) => { saved = draft; } };
  const input = { workspaceId: 'workspace', outputId: 'output', projectPath: '/tmp/output/project.runner-video.json', prompt: '  Add captions  ' };
  return { manager, drafts, input, calls };
}

describe('Video Studio saved-agent launch', () => {
  test('preserves resolved policy and returns at ACK without waiting for model completion', async () => {
    const f = fixture(async (...args) => { expect(args[4].inputOrigin).toBe('human'); args[7]('message-1'); await new Promise(() => {}); });
    const result = await launchVideoStudioAgent(f.manager, f.input, f.drafts, 100);
    expect(result.status).toBe('started');
    expect(f.calls[0]).toEqual(['workspace', 'video-editor-agent', { referenceMode: 'strict', taskModeSelectionSource: 'handoff' }]);
    expect(f.calls[1]).toMatchObject({ permissionMode: 'ask', model: 'saved-model', customSystemPrompt: 'saved persona', workingDirectory: '/tmp/output', enabledSourceSlugs: ['video-studio'] });
    expect(f.drafts.get()).toEqual({ text: '' });
  });
  test('pre-ACK failure keeps session and full editable draft', async () => {
    const f = fixture(async () => { throw new Error('Provider unavailable'); });
    const result = await launchVideoStudioAgent(f.manager, f.input, f.drafts);
    expect(result.status).toBe('draft');
    expect(result.sessionId).toBe('session-1');
    expect(result.draftInput).toContain(f.input.projectPath);
    expect(result.draftInput).toContain('Add captions');
    expect(f.drafts.get().text).toBe(result.draftInput);
  });
  test('missing ACK on completion yields draft, not false success', async () => {
    const f = fixture(async () => {});
    expect((await launchVideoStudioAgent(f.manager, f.input, f.drafts)).status).toBe('draft');
  });
  test('bounded pending result allows late ACK without erasing a newer user draft', async () => {
    let acknowledge!: () => void;
    const f = fixture(async (...args) => { acknowledge = () => args[7]('late'); await new Promise(() => {}); });
    const result = await launchVideoStudioAgent(f.manager, f.input, f.drafts, 5);
    expect(result.status).toBe('pending');
    expect(result.draftInput).toBeUndefined();
    f.drafts.set('session-1', { text: 'New user draft' });
    acknowledge();
    expect(f.drafts.get().text).toBe('New user draft');
  });
  test('late ACK clears unchanged draft after pending result', async () => {
    let acknowledge!: () => void;
    const f = fixture(async (...args) => { acknowledge = () => args[7]('late'); await new Promise(() => {}); });
    await launchVideoStudioAgent(f.manager, f.input, f.drafts, 5);
    acknowledge();
    expect(f.drafts.get().text).toBe('');
  });
  test('resolver policy failure never creates session or sends', async () => {
    const f = fixture(async () => { throw new Error('must not send'); });
    f.manager.resolveAgentSessionOptions = async () => { throw new Error('Agent is not available'); };
    await expect(launchVideoStudioAgent(f.manager, f.input, f.drafts)).rejects.toThrow('not available');
    expect(f.calls).toHaveLength(0);
    expect(f.drafts.get()).toBeNull();
  });
  test('draft storage failure returns session and request without sending', async () => {
    let sent = false;
    const f = fixture(async () => { sent = true; });
    f.drafts.set = () => { throw new Error('Disk full'); };
    const result = await launchVideoStudioAgent(f.manager, f.input, f.drafts);
    expect(result.status).toBe('draft');
    expect(result.sessionId).toBe('session-1');
    expect(result.draftInput).toContain('Add captions');
    expect(sent).toBe(false);
  });
  test('late failure after pending is consumed and preserves request', async () => {
    let rejectSend!: (error: Error) => void;
    const f = fixture(() => new Promise((_resolve, reject) => { rejectSend = reject; }));
    const result = await launchVideoStudioAgent(f.manager, f.input, f.drafts, 5);
    expect(result.status).toBe('pending');
    rejectSend(new Error('Late provider error'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.drafts.get().text).toContain('Add captions');
  });
  test('post-ACK failure does not turn acceptance into a retryable draft', async () => {
    const f = fixture(async (...args) => { args[7]('accepted'); throw new Error('Provider failed'); });
    const result = await launchVideoStudioAgent(f.manager, f.input, f.drafts);
    expect(result.status).toBe('started');
    expect(result.draftInput).toBeUndefined();
  });

});
