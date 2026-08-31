import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleUpdateTasks } from './session-tasks.ts';

function context(overrides: Partial<SessionToolContext>): SessionToolContext {
  return { sessionId: 'session-1', ...overrides } as SessionToolContext;
}

describe('update_tasks session tool', () => {
  it('returns the authoritative host list after mutation', async () => {
    let received: unknown;
    const authoritative = { id: 'tasks_1', revision: 2, items: [{ id: 'task_1', status: 'pending' }] };
    const result = await handleUpdateTasks(context({
      updateSessionTasks: async (input) => {
        received = input;
        return authoritative;
      },
    }), { op: 'append', content: 'Verify release assets' });

    expect(received).toEqual({ op: 'append', content: 'Verify release assets' });
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('tasks_1');
  });

  it('returns typed host rejection codes to the model', async () => {
    const error = Object.assign(new Error('Duplicate task content'), { code: 'duplicate-content' });
    const result = await handleUpdateTasks(context({
      updateSessionTasks: async () => { throw error; },
    }), { op: 'append', content: 'Duplicate' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('duplicate-content');
    expect(result.content[0]?.text).toContain('Duplicate task content');
  });

  it('fails clearly when the backend capability is unavailable', async () => {
    const result = await handleUpdateTasks(context({}), { op: 'view' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not available');
  });
});
