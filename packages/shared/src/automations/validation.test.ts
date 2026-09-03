/**
 * Tests for validation.ts
 */

import { describe, it, expect } from 'bun:test';
import { validateAutomationsConfig, validateAutomationsContent } from './validation.ts';
import { AutomationsConfigSchema, PromptActionSchema } from './schemas.ts';

describe('validation', () => {
describe('validateAutomationsConfig', () => {
    it('should accept a valid config', () => {
      const config = {
        automations: {
          SessionStatusChange: [{
            matcher: 'done',
            actions: [{ type: 'prompt', prompt: 'echo done' }],
          }],
        },
      };
      const result = validateAutomationsConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.config).not.toBeNull();
    });

    it('should accept an empty automations object', () => {
      const result = validateAutomationsConfig({ automations: {} });
      expect(result.valid).toBe(true);
    });

    it('should reject non-object input', () => {
      const result = validateAutomationsConfig('not an object');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should accept config without automations key (defaults to empty)', () => {
      // The schema provides a default empty automations object
      const result = validateAutomationsConfig({});
      expect(result.valid).toBe(true);
      expect(result.config?.automations).toEqual({});
    });

    it('should accept config with prompt actions', () => {
      const config = {
        automations: {
          SchedulerTick: [{
            cron: '0 9 * * *',
            actions: [{ type: 'prompt', prompt: 'Good morning!' }],
          }],
        },
      };
      const result = validateAutomationsConfig(config);
      expect(result.valid).toBe(true);
    });

    it('accepts a same-day varied schedule window and rejects an overnight one', () => {
      const base = {
        cron: '* * * * *',
        actions: [{ type: 'prompt', prompt: 'Reply to comments' }],
      };
      expect(validateAutomationsConfig({
        automations: { SchedulerTick: [{ ...base, dailyWindow: { start: '15:00', end: '17:00' } }] },
      }).valid).toBe(true);
      expect(validateAutomationsConfig({
        automations: { SchedulerTick: [{ ...base, dailyWindow: { start: '17:00', end: '15:00' } }] },
      }).valid).toBe(false);
      expect(validateAutomationsConfig({
        automations: { SchedulerTick: [{ actions: base.actions, dailyWindow: { start: '15:00', end: '17:00' } }] },
      }).valid).toBe(false);
      expect(validateAutomationsConfig({
        automations: { LabelAdd: [{ ...base, dailyWindow: { start: '15:00', end: '17:00' } }] },
      }).valid).toBe(false);
      expect(validateAutomationsConfig({
        automations: { SchedulerTick: [{ ...base, cron: '0 9 * * *', dailyWindow: { start: '15:00', end: '17:00' } }] },
      }).valid).toBe(false);
    });

    it('should reject unsupported agent lifecycle triggers instead of accepting a no-op', () => {
      const result = validateAutomationsConfig({
        automations: {
          PreToolUse: [{
            matcher: '^Bash$',
            actions: [{ type: 'prompt', prompt: 'check this' }],
          }],
        },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('Agent lifecycle trigger "PreToolUse" is not supported');
    });

    it('should accept config with disabled matchers', () => {
      const config = {
        automations: {
          LabelAdd: [{
            enabled: false,
            matcher: 'bug',
            actions: [{ type: 'prompt', prompt: 'echo disabled' }],
          }],
        },
      };
      const result = validateAutomationsConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept config with optional name field', () => {
      const config = {
        automations: {
          SchedulerTick: [{
            name: 'Daily Weather Report',
            cron: '0 8 * * *',
            actions: [{ type: 'prompt', prompt: 'Check the weather' }],
          }],
        },
      };
      const result = validateAutomationsConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should reject a blank matcher name', () => {
      const result = validateAutomationsConfig({
        automations: {
          SchedulerTick: [{
            name: '   ',
            cron: '0 8 * * *',
            actions: [{ type: 'prompt', prompt: 'Check the weather' }],
          }],
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('Automation name cannot be blank');
    });

    it('should accept thinkingLevel on prompt actions', () => {
      const config = {
        automations: {
          LabelAdd: [{
            matcher: 'review',
            actions: [{ type: 'prompt', prompt: 'Audit changes', thinkingLevel: 'high' }],
          }],
        },
      };
      const result = validateAutomationsConfig(config);
      expect(result.valid).toBe(true);
      const action = result.config?.automations.LabelAdd?.[0]?.actions[0];
      expect(action).toMatchObject({ thinkingLevel: 'high' });
    });

    it('PromptActionSchema rejects invalid thinkingLevel values', () => {
      const result = PromptActionSchema.safeParse({
        type: 'prompt', prompt: 'echo', thinkingLevel: 'extreme',
      });
      expect(result.success).toBe(false);
    });

    it('rejects malformed known actions through the full config schema', () => {
      const result = validateAutomationsConfig({
        automations: {
          SchedulerTick: [{
            cron: '0 9 * * *',
            actions: [{ type: 'queue-work', ownerScope: 'campaign', title: 'Missing execution' }],
          }],
        },
      });
      expect(result.valid).toBe(false);
    });

    it('accepts a typed queue-work action', () => {
      const result = validateAutomationsConfig({
        automations: {
          SchedulerTick: [{
            id: 'abc123',
            cron: '0 9 * * *',
            actions: [{
              type: 'queue-work',
              ownerScope: 'campaign',
              calendarVisibility: 'hidden',
              title: 'Draft the campaign post',
              execution: {
                type: 'agent-task',
                agentSlug: 'content-agent',
                brief: 'Draft one campaign post.',
                permissionMode: 'safe',
                expectedOutput: { requirement: 'required', kind: 'social-post' },
                postProcess: 'youtube-intelligence',
              },
            }],
          }],
        },
      });
      expect(result.valid).toBe(true);
      const action = result.config?.automations.SchedulerTick?.[0]?.actions[0];
      expect(action).toMatchObject({ title: 'Draft the campaign post' });
    });

    it('trims queue-work titles and rejects whitespace-only titles', () => {
      const action = {
        type: 'queue-work' as const,
        ownerScope: 'campaign' as const,
        title: '  Process campaign file  ',
        execution: {
          type: 'workflow-run' as const,
          workflowSlug: 'process-file',
          workflowDigest: 'digest',
          triggerInputs: {},
        },
      };
      const trimmed = validateAutomationsConfig({
        automations: { SchedulerTick: [{ cron: '0 9 * * *', actions: [action] }] },
      });
      expect(trimmed.valid).toBe(true);
      expect(trimmed.config?.automations.SchedulerTick?.[0]?.actions[0]).toMatchObject({
        title: 'Process campaign file',
      });

      const blank = validateAutomationsConfig({
        automations: {
          SchedulerTick: [{ cron: '0 9 * * *', actions: [{ ...action, title: ' \t\n ' }] }],
        },
      });
      expect(blank.valid).toBe(false);
    });

    it('accepts workflow input bindings and rejects them on agent work', () => {
      const workflow = validateAutomationsConfig({
        automations: {
          FileWatch: [{
            id: 'workflow-file', watchPath: 'inbox',
            actions: [{
              type: 'queue-work', ownerScope: 'campaign', title: 'Process file',
              execution: { type: 'workflow-run', workflowSlug: 'process-file', workflowDigest: 'digest', triggerInputs: {} },
              inputBindings: {
                file: { mode: 'trigger', from: 'file.path' },
                brief: { mode: 'fixed', value: 'Launch' },
                notes: { mode: 'ask' },
              },
            }],
          }],
        },
      });
      expect(workflow.valid).toBe(true);

      const agent = validateAutomationsConfig({
        automations: {
          SchedulerTick: [{
            id: 'agent-schedule', cron: '0 9 * * 1',
            actions: [{
              type: 'queue-work', ownerScope: 'campaign', title: 'Agent work',
              execution: {
                type: 'agent-task', agentSlug: 'writer', brief: 'Write.', permissionMode: 'safe',
                expectedOutput: { requirement: 'none' },
              },
              inputBindings: { topic: { mode: 'ask' } },
            }],
          }],
        },
      });
      expect(agent.valid).toBe(false);
    });

    it('rejects hidden tracked work that needs a visible approval surface', () => {
      const result = validateAutomationsConfig({
        automations: {
          SchedulerTick: [{
            cron: '0 9 * * *',
            actions: [{
              type: 'queue-work',
              ownerScope: 'campaign',
              calendarVisibility: 'hidden',
              title: 'Hidden review',
              execution: { type: 'review', reviewerType: 'user' },
              inputRefs: [{ kind: 'output', outputId: 'output-1' }],
            }],
          }],
        },
      });
      expect(result.valid).toBe(false);
    });

    it('rejects unsupported tracked-work topology before runtime', () => {
      const result = validateAutomationsConfig({
        automations: {
          SchedulerTick: [{
            cron: '0 9 * * *',
            actions: [{
              type: 'queue-work',
              ownerScope: 'hq',
              title: 'Invalid review',
              execution: { type: 'review', reviewerType: 'user' },
              inputRefs: [{ kind: 'output', outputId: 'output-1' }],
            }],
          }],
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should migrate legacy thinkingLevel "think" to "medium"', () => {
      // Mirrors the workspace-default migration in config/validators.ts so persisted
      // 'think' values from old configs don't break automation parsing.
      const config = {
        automations: {
          LabelAdd: [{
            matcher: 'review',
            actions: [{ type: 'prompt', prompt: 'echo', thinkingLevel: 'think' }],
          }],
        },
      };
      const result = validateAutomationsConfig(config);
      expect(result.valid).toBe(true);
      const action = result.config?.automations.LabelAdd?.[0]?.actions[0];
      expect(action).toMatchObject({ thinkingLevel: 'medium' });
    });

    it('should accept prompt actions without thinkingLevel (backward compat)', () => {
      const config = {
        automations: {
          LabelAdd: [{
            matcher: 'review',
            actions: [{ type: 'prompt', prompt: 'echo' }],
          }],
        },
      };
      const result = validateAutomationsConfig(config);
      expect(result.valid).toBe(true);
      const action = result.config?.automations.LabelAdd?.[0]?.actions[0];
      expect(action).toEqual({ type: 'prompt', prompt: 'echo' });
    });

    it('should reject state conditions with no operator', () => {
      const config = {
        automations: {
          LabelAdd: [{
            conditions: [{ condition: 'state', field: 'mode' }],
            actions: [{ type: 'prompt', prompt: 'test' }],
          }],
        },
      };
      const result = validateAutomationsConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('at least one operator'))).toBe(true);
    });

    it('should reject state conditions with conflicting operator groups', () => {
      const config = {
        automations: {
          LabelAdd: [{
            conditions: [{ condition: 'state', field: 'mode', value: 'ask', not_value: 'safe' }],
            actions: [{ type: 'prompt', prompt: 'test' }],
          }],
        },
      };
      const result = validateAutomationsConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('exactly one operator group'))).toBe(true);
    });

    it('should reject semantically invalid time values in object validation path', () => {
      const config = {
        automations: {
          LabelAdd: [{
            conditions: [{ condition: 'time', after: '25:61' }],
            actions: [{ type: 'prompt', prompt: 'test' }],
          }],
        },
      };
      const result = validateAutomationsConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid time value'))).toBe(true);
    });

    it('should reject condition nesting beyond maximum depth', () => {
      let nested: unknown = { condition: 'state', field: 'mode', value: 'ask' };
      for (let i = 0; i < 9; i++) {
        nested = { condition: 'and', conditions: [nested] };
      }

      const config = {
        automations: {
          LabelAdd: [{
            conditions: [nested],
            actions: [{ type: 'prompt', prompt: 'test' }],
          }],
        },
      };
      const result = validateAutomationsConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('exceeds maximum depth'))).toBe(true);
    });

    it('should reject external FileWatch paths without explicit opt-in', () => {
      const config = {
        automations: {
          FileWatch: [{
            watchPath: '/tmp',
            actions: [{ type: 'prompt', prompt: 'test' }],
          }],
        },
      };
      const result = validateAutomationsConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('External FileWatch paths require explicit opt-in'))).toBe(true);
    });

    it('should accept external FileWatch paths with explicit opt-in', () => {
      const config = {
        automations: {
          FileWatch: [{
            watchPath: '/tmp',
            allowExternalWatchPath: true,
            actions: [{ type: 'prompt', prompt: 'test' }],
          }],
        },
      };
      const result = validateAutomationsConfig(config);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateAutomationsContent', () => {
    it('should accept valid JSON config', () => {
      const json = JSON.stringify({
        automations: {
          LabelAdd: [{
            matcher: 'bug',
            actions: [{ type: 'prompt', prompt: 'echo bug' }],
          }],
        },
      });
      const result = validateAutomationsContent(json);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid JSON', () => {
      const result = validateAutomationsContent('not json{');
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.message).toContain('Invalid JSON');
    });

    it('should reject ReDoS patterns (nested quantifiers)', () => {
      const json = JSON.stringify({
        automations: {
          LabelAdd: [{
            matcher: '(a+)+',
            actions: [{ type: 'prompt', prompt: 'echo test' }],
          }],
        },
      });
      const result = validateAutomationsContent(json);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('ReDoS'))).toBe(true);
    });

    it('should reject ReDoS patterns (repeated alternation)', () => {
      const json = JSON.stringify({
        automations: {
          LabelAdd: [{
            matcher: '(a|b)+',
            actions: [{ type: 'prompt', prompt: 'echo test' }],
          }],
        },
      });
      const result = validateAutomationsContent(json);
      expect(result.valid).toBe(false);
    });

    it('should reject ReDoS patterns (repeated greedy quantifiers)', () => {
      const json = JSON.stringify({
        automations: {
          LabelAdd: [{
            matcher: '.*.*',
            actions: [{ type: 'prompt', prompt: 'echo test' }],
          }],
        },
      });
      const result = validateAutomationsContent(json);
      expect(result.valid).toBe(false);
    });

    it('should reject invalid regex syntax', () => {
      const json = JSON.stringify({
        automations: {
          LabelAdd: [{
            matcher: '[invalid',
            actions: [{ type: 'prompt', prompt: 'echo test' }],
          }],
        },
      });
      const result = validateAutomationsContent(json);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Invalid regex'))).toBe(true);
    });

    it('should reject regex patterns that are too long', () => {
      const json = JSON.stringify({
        automations: {
          LabelAdd: [{
            matcher: 'a'.repeat(501),
            actions: [{ type: 'prompt', prompt: 'echo test' }],
          }],
        },
      });
      const result = validateAutomationsContent(json);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('too long'))).toBe(true);
    });

    it('should reject invalid cron expressions', () => {
      const json = JSON.stringify({
        automations: {
          SchedulerTick: [{
            cron: 'not a cron',
            actions: [{ type: 'prompt', prompt: 'echo tick' }],
          }],
        },
      });
      const result = validateAutomationsContent(json);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Invalid cron'))).toBe(true);
    });

    it('should reject invalid timezone', () => {
      const json = JSON.stringify({
        automations: {
          SchedulerTick: [{
            cron: '0 9 * * *',
            timezone: 'Not/A/Timezone',
            actions: [{ type: 'prompt', prompt: 'echo tick' }],
          }],
        },
      });
      const result = validateAutomationsContent(json);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Invalid timezone'))).toBe(true);
    });

    it('should warn about allow-all permission mode', () => {
      const json = JSON.stringify({
        automations: {
          LabelAdd: [{
            permissionMode: 'allow-all',
            actions: [{ type: 'prompt', prompt: 'echo danger' }],
          }],
        },
      });
      const result = validateAutomationsContent(json);
      expect(result.valid).toBe(true); // Warning, not error
      expect(result.warnings.some(w => w.message.includes('allow-all'))).toBe(true);
    });

    it('should warn about empty automations config', () => {
      const json = JSON.stringify({ automations: {} });
      const result = validateAutomationsContent(json);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.message.includes('No automations configured'))).toBe(true);
    });

    it('should warn when cron is used on non-SchedulerTick event', () => {
      const json = JSON.stringify({
        automations: {
          LabelAdd: [{
            cron: '0 9 * * *',
            actions: [{ type: 'prompt', prompt: 'echo test' }],
          }],
        },
      });
      const result = validateAutomationsContent(json);
      expect(result.warnings.some(w => w.message.includes('SchedulerTick'))).toBe(true);
    });

    it('should accept valid simple regex patterns', () => {
      const json = JSON.stringify({
        automations: {
          LabelAdd: [{
            matcher: 'bug|feature|fix',
            actions: [{ type: 'prompt', prompt: 'echo matched' }],
          }],
        },
      });
      const result = validateAutomationsContent(json);
      expect(result.valid).toBe(true);
    });

    it('should accept valid cron with timezone', () => {
      const json = JSON.stringify({
        automations: {
          SchedulerTick: [{
            cron: '15 16 * * *',
            timezone: 'Europe/Budapest',
            actions: [{ type: 'prompt', prompt: 'Schedule check' }],
          }],
        },
      });
      const result = validateAutomationsContent(json);
      expect(result.valid).toBe(true);
    });
  });

  describe('deprecated event aliases', () => {
    it('should accept TodoStateChange as deprecated alias', () => {
      const config = JSON.stringify({
        automations: {
          TodoStateChange: [{
            actions: [{ type: 'prompt', prompt: 'echo test' }],
          }],
        },
      });
      const result = validateAutomationsContent(config);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          path: 'automations.TodoStateChange',
          severity: 'warning',
          suggestion: expect.stringContaining('SessionStatusChange'),
        })
      );
    });

    it('should rewrite TodoStateChange to SessionStatusChange in schema transform', () => {
      const raw = {
        automations: {
          TodoStateChange: [{
            actions: [{ type: 'prompt', prompt: 'echo test' }],
          }],
        },
      };
      const result = AutomationsConfigSchema.safeParse(raw);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.automations['SessionStatusChange']).toBeDefined();
        expect(result.data.automations['TodoStateChange']).toBeUndefined();
      }
    });
  });
});
