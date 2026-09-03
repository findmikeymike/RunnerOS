import { describe, it, expect } from 'bun:test';
import {
  SESSION_TOOL_DEFS,
  getSessionToolDefs,
  getSessionToolNames,
  getSessionToolRegistry,
  getSessionSafeAllowedToolNames,
  getSessionSafeBlockedToolNames,
  getToolDefsAsJsonSchema,
  CreateAutomationSchema,
  CreateWorkflowSchema,
} from './tool-defs.ts';

describe('session tool filtering helpers', () => {
  it('excludes developer feedback tool when includeDeveloperFeedback is false', () => {
    const defs = getSessionToolDefs({ includeDeveloperFeedback: false });
    const names = defs.map(d => d.name);

    expect(names.includes('send_developer_feedback')).toBe(false);
  });

  it('includes developer feedback tool when includeDeveloperFeedback is true', () => {
    const defs = getSessionToolDefs({ includeDeveloperFeedback: true });
    const names = defs.map(d => d.name);

    expect(names.includes('send_developer_feedback')).toBe(true);
  });

  it('name set and registry stay aligned for filtered output', () => {
    const names = getSessionToolNames({ includeDeveloperFeedback: false });
    const registry = getSessionToolRegistry({ includeDeveloperFeedback: false });

    expect(registry.has('send_developer_feedback')).toBe(false);
    expect(names.has('send_developer_feedback')).toBe(false);

    for (const name of names) {
      expect(registry.has(name)).toBe(true);
    }
  });

  it('json schema conversion respects includeDeveloperFeedback filter', () => {
    const defs = getToolDefsAsJsonSchema({ includeDeveloperFeedback: false });
    const names = defs.map(d => d.name);

    expect(names.includes('send_developer_feedback')).toBe(false);
  });

  it('can hide schedule_work from non-HNIC sessions', () => {
    expect(getSessionToolNames().has('schedule_work')).toBe(false);
    expect(getSessionToolNames({ includeScheduleWork: false }).has('schedule_work')).toBe(false);
    expect(getSessionToolNames({ includeScheduleWork: true }).has('schedule_work')).toBe(true);
  });

  it('registers update_tasks only when the non-Anthropic task surface is enabled', () => {
    expect(getSessionToolNames().has('update_tasks')).toBe(false);
    expect(getSessionToolNames({ includeSessionTasks: false }).has('update_tasks')).toBe(false);
    expect(getSessionToolNames({ includeSessionTasks: true }).has('update_tasks')).toBe(true);
    expect(getToolDefsAsJsonSchema({ includeSessionTasks: true }).some(def => def.name === 'update_tasks')).toBe(true);
    const taskTool = SESSION_TOOL_DEFS.find(def => def.name === 'update_tasks');
    expect(taskTool?.description).toContain('at least three distinct steps');
    expect(taskTool?.description).toContain('Exactly one item may be in progress');
    expect(taskTool?.safeMode).toBe('allow');
  });

  it('teaches the saved-agent delegation boundary at tool-call time', () => {
    const messageAgent = SESSION_TOOL_DEFS.find(def => def.name === 'message_agent');
    const spawnSession = SESSION_TOOL_DEFS.find(def => def.name === 'spawn_session');

    expect(messageAgent?.description).toContain('Keep background=false when the current answer or next decision needs the result');
    expect(messageAgent?.description).toContain('Starting the child is not completion');
    expect(spawnSession?.description).toContain('separate user-visible session');
    expect(spawnSession?.description).toContain('use message_agent instead');
  });

  it('exposes semantic Manager tools only to HNIC while keeping authorized context reads generic', () => {
    const ordinary = getSessionToolNames();
    expect(ordinary.has('get_manager_brief')).toBe(false);
    expect(ordinary.has('get_artist_context')).toBe(false);
    expect(ordinary.has('get_campaign_context')).toBe(false);
    expect(ordinary.has('get_campaign_brief')).toBe(false);
    expect(ordinary.has('list_workspace_context')).toBe(true);
    expect(ordinary.has('get_workspace_context')).toBe(true);
    expect(ordinary.has('search_artist_network')).toBe(true);

    const manager = getSessionToolNames({ includeManagerTools: true });
    expect(manager.has('get_manager_brief')).toBe(true);
    expect(manager.has('get_artist_context')).toBe(true);
    expect(manager.has('get_campaign_context')).toBe(true);
    expect(manager.has('get_campaign_brief')).toBe(false);
    expect(getSessionToolNames({ includeManagerTools: true, includeCampaignManagerTools: true }).has('get_campaign_brief')).toBe(true);
  });

  it('marks all Manager and context retrieval tools read-only and safe-mode allowed', () => {
    for (const name of [
      'get_manager_brief',
      'get_campaign_brief',
      'get_artist_context',
      'get_campaign_context',
      'list_workspace_context',
      'get_workspace_context',
      'search_artist_network',
    ]) {
      const def = SESSION_TOOL_DEFS.find((candidate) => candidate.name === name);
      expect(def?.readOnly).toBe(true);
      expect(def?.safeMode).toBe('allow');
    }
  });

  it('keeps Artist Network lookup bounded and discoverable without prompt injection', () => {
    const def = SESSION_TOOL_DEFS.find((candidate) => candidate.name === 'search_artist_network');
    expect(def?.description).toContain('full contact list is never injected');
    expect(def?.inputSchema.safeParse({ query: '' }).success).toBe(false);
    expect(def?.inputSchema.safeParse({ query: 'automotive sync', limit: 5 }).success).toBe(true);
  });

  it('exposes X Editorial history as a read-only safe tool', () => {
    const history = SESSION_TOOL_DEFS.find((candidate) => candidate.name === 'list_x_editorial_history');
    expect(history?.readOnly).toBe(true);
    expect(history?.safeMode).toBe('allow');
    expect(history?.description).toContain('prevent repetition');
  });

  it('exposes Creative Lab tools only when explicitly enabled', () => {
    expect(getSessionToolNames().has('create_lab_song')).toBe(false);
    expect(getSessionToolNames().has('save_lab_lyrics')).toBe(false);
    expect(getSessionToolNames().has('list_lab_songs')).toBe(false);
    const labNames = getSessionToolNames({ includeLabTools: true });
    expect(labNames.has('create_lab_song')).toBe(true);
    expect(labNames.has('save_lab_lyrics')).toBe(true);
    expect(labNames.has('list_lab_songs')).toBe(true);
  });

  it('exposes durable social variant tools only to the Raw Video Editor surface', () => {
    expect(getSessionToolNames().has('get_social_variant_set')).toBe(false);
    expect(getSessionToolNames().has('record_social_variant_result')).toBe(false);
    const names = getSessionToolNames({ includeSocialVariantTools: true });
    expect(names.has('get_social_variant_set')).toBe(true);
    expect(names.has('record_social_variant_result')).toBe(true);
    expect(SESSION_TOOL_DEFS.find((def) => def.name === 'get_social_variant_set')?.readOnly).toBe(true);
    expect(SESSION_TOOL_DEFS.find((def) => def.name === 'record_social_variant_result')?.safeMode).toBe('block');
  });

  it('all canonical session tools declare safeMode metadata', () => {
    for (const def of SESSION_TOOL_DEFS) {
      expect(def.safeMode === 'allow' || def.safeMode === 'block').toBe(true);
    }
  });

  it('teaches output tools Canvas publishing format rules', () => {
    const createOutput = SESSION_TOOL_DEFS.find((def) => def.name === 'create_output');
    const artworkCompose = SESSION_TOOL_DEFS.find((def) => def.name === 'artwork_compose');
    const mediaProviderRequest = SESSION_TOOL_DEFS.find((def) => def.name === 'media_provider_request');
    const visualSurface = SESSION_TOOL_DEFS.find((def) => def.name === 'visual_surface');

    expect(createOutput?.description).toContain('Set `showInCanvas: true` when the user asks to see, preview, compare, review, present, open, or iterate');
    expect(createOutput?.description).toContain('Canvas preview format rules');
    expect(createOutput?.description).toContain('Local/generated web: attach the HTML file as the primary file');
    expect(createOutput?.description).toContain('The Output system infers the Canvas web preview');
    expect(createOutput?.description).toContain('Workflow diagrams: `.workflow.json`');
    expect(createOutput?.description).toContain('If an Output already exists, use visual_surface_state and visual_surface');
    expect(artworkCompose?.description).toContain('editable SVG source');
    expect(artworkCompose?.description).toContain('PNG preview export');
    expect(artworkCompose?.description).toContain('showInCanvas: true');
    expect(mediaProviderRequest?.description).toContain('Fal');
    expect(mediaProviderRequest?.description).toContain('Replicate');
    expect(mediaProviderRequest?.description).toContain('WaveSpeed');
    expect(mediaProviderRequest?.safeMode).toBe('block');
    expect(visualSurface?.description).toContain('avoid duplicate cards and just reference what is already on Canvas');
  });

  it('safe-mode helper sets classify expected tools', () => {
    const allowed = getSessionSafeAllowedToolNames();
    const blocked = getSessionSafeBlockedToolNames();

    expect(allowed.has('send_developer_feedback')).toBe(true);
    expect(allowed.has('call_llm')).toBe(true);
    expect(allowed.has('browser_tool')).toBe(true);
    expect(allowed.has('script_sandbox')).toBe(true);
    expect(allowed.has('recall_memory')).toBe(true);
    expect(allowed.has('list_deep_research_runs')).toBe(true);
    expect(allowed.has('get_deep_research_run')).toBe(true);
    expect(allowed.has('message_agent')).toBe(true);
    expect(getSessionSafeAllowedToolNames({ includeSessionTasks: true }).has('update_tasks')).toBe(true);

    expect(blocked.has('source_oauth_trigger')).toBe(true);
    expect(blocked.has('source_credential_prompt')).toBe(true);
    expect(blocked.has('spawn_session')).toBe(true);
    expect(blocked.has('save_memory')).toBe(true);
    expect(blocked.has('update_memory')).toBe(true);
    expect(blocked.has('forget_memory')).toBe(true);
    expect(blocked.has('media_provider_request')).toBe(true);
    expect(blocked.has('start_deep_research')).toBe(true);
    expect(blocked.has('approve_deep_research_plan')).toBe(true);
    expect(blocked.has('revise_deep_research_plan')).toBe(true);
    expect(blocked.has('cancel_deep_research_run')).toBe(true);
  });

  it('safe-mode helpers support MCP prefixing', () => {
    const allowedPrefixed = getSessionSafeAllowedToolNames({ prefix: 'mcp__session__' });
    const blockedPrefixed = getSessionSafeBlockedToolNames({ prefix: 'mcp__session__' });

    expect(allowedPrefixed.has('mcp__session__send_developer_feedback')).toBe(true);
    expect(allowedPrefixed.has('mcp__session__call_llm')).toBe(true);
    expect(allowedPrefixed.has('mcp__session__script_sandbox')).toBe(true);
    expect(allowedPrefixed.has('mcp__session__message_agent')).toBe(true);
    expect(blockedPrefixed.has('mcp__session__source_oauth_trigger')).toBe(true);
    expect(blockedPrefixed.has('mcp__session__spawn_session')).toBe(true);
  });

  it('create_automation schema matches runtime thinkingLevel and webhook auth fields', () => {
    const valid = CreateAutomationSchema.safeParse({
      eventName: 'WebhookReceive',
      matcher: {
        slug: 'incoming-hook',
        secretEnv: 'CRAFT_WH_INCOMING_HOOK_SECRET',
        allowUnauthenticated: false,
        allowedMethods: ['POST'],
        actions: [{
          type: 'prompt',
          prompt: 'Handle $CRAFT_BODY',
          thinkingLevel: 'xhigh',
        }],
      },
    });
    expect(valid.success).toBe(true);

    const invalidThinking = CreateAutomationSchema.safeParse({
      eventName: 'SchedulerTick',
      matcher: {
        cron: '* * * * *',
        actions: [{ type: 'prompt', prompt: 'run', thinkingLevel: 'disabled' }],
      },
    });
    expect(invalidThinking.success).toBe(false);
  });

  it('create_workflow preserves bounded trigger inputs and delegation limits', () => {
    const parsed = CreateWorkflowSchema.parse({
      slug: 'bounded-flow',
      metadata: {
        name: 'Bounded flow',
        description: 'Bounded workflow',
        trigger: {
          type: 'manual',
          inputs: [{
            name: 'count',
            type: 'number',
            min: 1,
            max: 25,
            integer: true,
            maxFrom: 'ceiling',
          }],
        },
        steps: [{
          id: 'one',
          agent: 'worker',
          input: 'Do it',
          completion: { maxAgentMessages: 2 },
        }],
      },
    });

    expect(parsed.metadata.trigger.inputs?.[0]).toMatchObject({
      min: 1,
      max: 25,
      integer: true,
      maxFrom: 'ceiling',
    });
    expect(parsed.metadata.steps[0]?.completion?.maxAgentMessages).toBe(2);
  });
});
