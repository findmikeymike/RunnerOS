/**
 * Starter workflow templates seeded into the global library on first run.
 *
 * Each entry maps to a `WORKFLOW.md` written under `~/.workflows/<slug>/`.
 * Seeding is idempotent: existing files are never overwritten, and tombstoned
 * starters stay deleted (`.deleted-workflows.json`). Most are starters only;
 * selected app-managed workflows may also be ensured explicitly at startup.
 */

import type { WorkflowMetadata } from './types.ts';

export const WEEKLY_CONTENT_PIPELINE_SLUG = 'weekly-content-pipeline';
export const EMAIL_TRIAGE_SLUG = 'email-triage';
export const YOUTUBE_INTELLIGENCE_BATCH_SLUG = 'youtube-intelligence-batch';

const weeklyContentPipeline = {
  slug: WEEKLY_CONTENT_PIPELINE_SLUG,
  metadata: {
    name: 'Weekly Content Pipeline',
    description: 'Research a topic, draft a post, critique it, revise, hand off for human approval.',
    avatar: '📝',
    trigger: {
      type: 'manual' as const,
      inputs: [
        {
          name: 'topic',
          type: 'string',
          required: true,
          description: 'What you want to write about (one sentence)',
        },
        { name: 'word_count', type: 'number', default: 600 },
        { name: 'audience', type: 'string', default: 'experienced practitioners' },
      ],
    },
    steps: [
      {
        id: 'research',
        agent: 'researcher',
        input:
          'Research "{{trigger.topic}}". Prefer primary sources. Return:\n' +
          '- 3-sentence TL;DR\n' +
          '- 4-6 key findings, each with a citation\n' +
          '- 2-3 open questions\n' +
          '- Numbered source list\n',
      },
      {
        id: 'draft',
        agent: 'writer',
        input:
          'Write a {{trigger.word_count}}-word blog post for {{trigger.audience}}.\n' +
          'Direct, specific voice. No throat-clearing.\n\n' +
          'Source material:\n' +
          '{{steps.research.output}}\n',
      },
      {
        id: 'critique',
        agent: 'critic',
        input:
          'Review this draft. Honest, not nice. Single highest-leverage change.\n\n' +
          '{{steps.draft.output}}\n',
      },
      {
        id: 'revise',
        agent: 'writer',
        input:
          'Revise the draft based on this critique. Keep the word count close to {{trigger.word_count}}.\n\n' +
          'Original draft:\n' +
          '{{steps.draft.output}}\n\n' +
          'Critique:\n' +
          '{{steps.critique.output}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# Weekly Content Pipeline\n\n' +
    'Run this when you have a half-formed topic and want a clean draft to start from.\n\n' +
    '**Tips:**\n' +
    '- Spend the most prompt budget on the topic — vague topics produce vague research.\n' +
    '- The critique step is intentionally harsh. If the revised draft still feels weak, fork this workflow and tweak the critic\'s prompt to be even more specific.\n',
};

const emailTriage = {
  slug: EMAIL_TRIAGE_SLUG,
  metadata: {
    name: 'Email Triage',
    description: 'Classify an email, decide on next action, optionally draft a reply.',
    avatar: '📥',
    trigger: {
      type: 'manual' as const,
      inputs: [
        { name: 'from', type: 'string', required: true },
        { name: 'subject', type: 'string', required: true },
        { name: 'body', type: 'string', required: true },
      ],
    },
    steps: [
      {
        id: 'classify',
        agent: 'triager',
        input:
          'Classify this email. Return:\n' +
          '- urgency: now | today | this week | later | drop\n' +
          '- category: question | sales | newsletter | bug-report | personal | other\n' +
          '- one-line summary\n' +
          '- action: reply | forward | delete | nothing\n\n' +
          'From: {{trigger.from}}\n' +
          'Subject: {{trigger.subject}}\n\n' +
          'Body:\n' +
          '{{trigger.body}}\n',
      },
      {
        id: 'draft_reply',
        agent: 'writer',
        input:
          'Draft a short, direct reply to this email. Match my voice (clear, no fluff).\n\n' +
          'Triage notes: {{steps.classify.output}}\n\n' +
          'Original:\n' +
          'From: {{trigger.from}}\n' +
          'Subject: {{trigger.subject}}\n' +
          'Body: {{trigger.body}}\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# Email Triage\n\n' +
    'Pair this with the eventual EmailReceive trigger (Phase 4 + future external trigger from `docs/future-external-triggers.md`).\n\n' +
    'Until then, paste an email manually to test the routing logic.\n',
};

const youtubeIntelligenceBatch = {
  slug: YOUTUBE_INTELLIGENCE_BATCH_SLUG,
  metadata: {
    name: 'YouTube Intelligence Batch',
    description: 'Process YouTube videos, channel targets, or transcript files into transcript packets, intel cards, a cross-video reducer pass, and a reusable dossier.',
    avatar: 'Y',
    trigger: {
      type: 'manual' as const,
      inputs: [
        {
          name: 'source_list',
          type: 'string',
          required: true,
          description: 'One target per line: video URL/ID, channel handle/URL, or video<TAB>transcript-file rows.',
          ui: {
            multiline: true,
            rows: 8,
            placeholder: 'https://www.youtube.com/watch?v=...\n@channelhandle\nhttps://youtu.be/...\t./transcript.txt',
          },
        },
        {
          name: 'provider',
          type: 'string',
          default: 'auto',
          description: 'auto, local, or supadata.',
        },
        {
          name: 'allow_paid',
          type: 'boolean',
          default: false,
          description: 'Required before Supadata transcript credits are used.',
        },
        {
          name: 'max_videos',
          type: 'number',
          default: 25,
          description: 'Maximum videos/transcripts to process in this run.',
        },
        {
          name: 'channel_video_limit',
          type: 'number',
          default: 10,
          description: 'Maximum uploads to pull from each channel target.',
        },
        {
          name: 'output_dir',
          type: 'string',
          default: 'youtube-intel/batch-run',
          description: 'Workspace-relative output directory.',
        },
      ],
    },
    outputs: {
      mode: 'final-step' as const,
      kind: 'report' as const,
      title: 'YouTube Intelligence Batch Dossier',
      summary: 'Batch transcript intelligence dossier and agent context pack.',
      primary: {
        from: 'step-output' as const,
        step: 'batch-extract',
      },
    },
    steps: [
      {
        id: 'batch-extract',
        agent: 'youtube-intelligence-agent',
        timeout: 1800,
        retries: 1,
        onFailure: 'stop' as const,
        completion: {
          requireNonEmptyOutput: true,
          minOutputChars: 500,
          requireToolUse: true,
        },
        input:
          'Run the YouTube Intelligence batch workflow.\n\n' +
          'Inputs:\n' +
          '- source_list:\n{{trigger.source_list}}\n' +
          '- provider: {{trigger.provider}}\n' +
          '- allow_paid: {{trigger.allow_paid}}\n' +
          '- max_videos: {{trigger.max_videos}}\n' +
          '- channel_video_limit: {{trigger.channel_video_limit}}\n' +
          '- output_dir: {{trigger.output_dir}}\n\n' +
          'Required execution:\n' +
          '1. Resolve the bundled `youtube-intelligence` source folder. If `tools/youtube-intelligence` exists in the workspace, that is fine; otherwise use the source local path/folder shown in the active source guide.\n' +
          '2. Write the source list to a workspace-local input file and use its absolute path in the command. The source list may contain YouTube video URLs/IDs, channel handles/URLs, or video<TAB>transcript-file rows.\n' +
          '3. Resolve `{{trigger.output_dir}}` against the workspace root if it is relative, then use that absolute output path.\n' +
          '4. From the YouTube Intelligence tool folder, run `node bin/youtube-intelligence.mjs batch-prepare --input <absolute-input-file> --out <absolute-output-dir> --provider "{{trigger.provider}}" --max-videos {{trigger.max_videos}} --channel-limit {{trigger.channel_video_limit}}`.\n' +
          '5. Add `--allow-paid` only when `allow_paid` is true. Do not use Supadata credits without that flag.\n' +
          '6. Read `run-manifest.json`, each successful video `chunks.json`, `batch-extractor-prompt.md`, and `cross-video-reducer-prompt.md`.\n' +
          '7. Produce per-video intel cards, cross-video patterns, contradictions, experiments, and a final dossier. No generic summaries.\n' +
          '8. Write `dossier.md`, `cross-video-reducer.json`, and `agent-context-pack.json` in the output directory. The context pack must be usable by another agent without rereading the whole transcripts.\n' +
          '9. Return a final report with these sections: Best Wisdom, Playbooks, Contradictions, Experiments, Agent Transfer Pack, Files Created, Source Index.\n',
      },
    ],
  } satisfies WorkflowMetadata,
  body:
    '# YouTube Intelligence Batch\n\n' +
    'Use this workflow when the user gives one video, many videos, channel handles/URLs, or transcript files and wants reusable intelligence instead of summaries.\n\n' +
    'The workflow is intentionally agent-operated: the CLI prepares transcript packets and batch prompts; the YouTube Intelligence Agent performs extraction, reducer judgment, and dossier assembly.\n\n' +
    'Rules:\n' +
    '- Default to free/local transcript acquisition.\n' +
    '- Use Supadata only when the run input explicitly allows paid credits.\n' +
    '- Preserve timestamp evidence and source indexes.\n' +
    '- Channel targets expand through youtube-research channel uploads before transcript acquisition.\n' +
    '- Treat failed rows as reportable, not invisible.\n',
};

export const STARTER_WORKFLOWS: ReadonlyArray<{
  slug: string;
  metadata: WorkflowMetadata;
  body: string;
}> = [weeklyContentPipeline, emailTriage, youtubeIntelligenceBatch];

export const STARTER_WORKFLOW_SLUGS: readonly string[] = STARTER_WORKFLOWS.map((w) => w.slug);
