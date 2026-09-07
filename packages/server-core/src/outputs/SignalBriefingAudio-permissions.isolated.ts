import { describe, expect, mock, test } from 'bun:test';

const permission = mock(() => { throw new Error('private team details'); });
mock.module('@craft-agent/shared/workspaces', () => ({ assertTeamPermission: permission }));
const { SignalBriefingAudio } = await import('./SignalBriefingAudio');

describe('Signals audio default paid permission', () => {
  test('uses owner-only external execution permission before reading output, paths or credentials', async () => {
    const getOutput = mock(() => null);
    const safeOutputPath = mock(async () => '/never-read');
    const loadSecret = mock(async () => null);
    const fetch = mock(async () => { throw new Error('No network allowed'); });
    const audio = new SignalBriefingAudio({
      getWorkspace: () => ({ id: 'ws', rootPath: '/workspace' }),
      getOutput, safeOutputPath, loadSecret, fetch,
    });
    await expect(audio.read('ws', 'output', 'visible text')).rejects.toThrow('Workspace owner permission');
    expect(permission).toHaveBeenCalledWith('/workspace', 'automation.external.execute');
    expect(getOutput).not.toHaveBeenCalled();
    expect(safeOutputPath).not.toHaveBeenCalled();
    expect(loadSecret).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
