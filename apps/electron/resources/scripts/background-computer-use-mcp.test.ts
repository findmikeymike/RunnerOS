import { describe, expect, test } from 'bun:test';
import { computerUseStatus, countObservableEntries } from './background-computer-use-mcp';

describe('background computer use status', () => {
  test('counts the largest observable collection instead of the first array field', () => {
    expect(countObservableEntries({ notes: [], runningApps: [{ name: 'Finder' }] })).toBe(1);
  });

  test('reports ready when the runtime is reachable and applications are observable', async () => {
    const result = await computerUseStatus(async (path) => {
      if (path === '/v1/list_apps') return { notes: [], runningApps: [{ name: 'Finder' }] };
      return { ok: true };
    });

    expect(result).toMatchObject({ state: 'ready', observableApps: 1 });
  });

  test('reports degraded with a permission remedy when no applications are observable', async () => {
    const result = await computerUseStatus(async (path) => {
      if (path === '/v1/list_apps') return { runningApps: [], notes: [] };
      return { ok: true };
    });

    expect(result.state).toBe('degraded');
    expect(String(result.remedy)).toContain('Accessibility');
    expect(String(result.remedy)).toContain('Screen Recording');
  });

  test('reports unavailable with startup guidance when the runtime cannot be reached', async () => {
    const result = await computerUseStatus(async () => {
      throw new Error('connection refused');
    });

    expect(result).toMatchObject({ state: 'unavailable', detail: 'connection refused' });
    expect(String(result.remedy)).toContain('start.sh');
  });
});
