import { describe, expect, test } from 'bun:test';
import { parseWorkflowFile, serializeWorkflow } from './parser.ts';
import {
  STARTER_WORKFLOWS,
  STARTER_WORKFLOW_SLUGS,
  YOUTUBE_INTELLIGENCE_BATCH_SLUG,
} from './starter-templates.ts';

describe('STARTER_WORKFLOWS', () => {
  test('includes parseable YouTube Intelligence Batch workflow', () => {
    const workflow = STARTER_WORKFLOWS.find((entry) => entry.slug === YOUTUBE_INTELLIGENCE_BATCH_SLUG);

    expect(workflow).toBeDefined();
    expect(STARTER_WORKFLOW_SLUGS).toContain(YOUTUBE_INTELLIGENCE_BATCH_SLUG);

    const parsed = parseWorkflowFile(serializeWorkflow(workflow!.metadata, workflow!.body));
    expect(parsed).not.toBeNull();
    expect(parsed!.metadata.steps[0]!.agent).toBe('youtube-intelligence-agent');
    expect(parsed!.metadata.trigger.inputs?.map((input) => input.name)).toEqual([
      'source_list',
      'provider',
      'allow_paid',
      'max_videos',
      'channel_video_limit',
      'output_dir',
    ]);
    expect(parsed!.metadata.trigger.inputs?.[0]?.ui).toMatchObject({ multiline: true, rows: 8 });
    expect(parsed!.metadata.steps[0]!.input).toContain('batch-prepare');
    expect(parsed!.metadata.steps[0]!.input).toContain('--channel-limit');
    expect(parsed!.metadata.steps[0]!.input).toContain('--allow-paid');
  });
});
