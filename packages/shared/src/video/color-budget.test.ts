import { expect, test } from 'bun:test';
import { createRunnerVideoProject } from './storage';
import { validateRunnerVideoProject } from './validation';

test('shared save validation rejects oversized embedded LUT documents', () => {
  const project = createRunnerVideoProject({ title: 'Budget', workspaceId: 'budget-test' });
  project.timeline.tracks = [{ id: 'images', type: 'image', label: 'Images', clips: [{
    id: 'image', type: 'image', startMs: 0, durationMs: 1000,
    adjustments: { pipeline: 'rgb-v1', lut: { name: 'Identity', size: 2, values: [0,0,0, 1,0,0, 0,1,0, 1,1,0, 0,0,1, 1,0,1, 0,1,1, 1,1,1] } },
  }] }];
  expect(validateRunnerVideoProject(project).ok).toBe(true);
  project.title = 'x'.repeat(16 * 1024 * 1024);
  expect(validateRunnerVideoProject(project).errors.some(issue => issue.message.includes('16 MB'))).toBe(true);
});
