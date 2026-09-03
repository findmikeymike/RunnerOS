import { describe, expect, test } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleScheduleWork, type ScheduleWorkResult, type ScheduleWorkToolInput } from './schedule-work.ts';

function context(scheduleWork?: (input: ScheduleWorkToolInput) => Promise<ScheduleWorkResult>): SessionToolContext {
  return { scheduleWork } as SessionToolContext;
}

const calendarInput: ScheduleWorkToolInput = {
  idempotencyKey: 'weekly-channel-report-2026-07-15',
  destination: 'calendar',
  title: 'Weekly channel report',
  explanation: 'The user explicitly asked HNIC to schedule it.',
  startAt: '2026-07-15T14:00:00.000Z',
  timezone: 'America/Chicago',
  execution: {
    type: 'agent-task',
    agentSlug: 'youtube-research-agent',
    brief: 'Create the weekly YouTube intelligence report.',
    expectedOutput: { requirement: 'required', kind: 'report' },
  },
};

describe('schedule_work', () => {
  test('is unavailable without the HNIC backend capability', async () => {
    const result = await handleScheduleWork(context(), calendarInput);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('only available to HNIC');
  });

  test('blocks ambiguous work before persistence', async () => {
    let called = false;
    const result = await handleScheduleWork(context(async () => {
      called = true;
      return { ok: true };
    }), { ...calendarInput, requiresUserConfirmation: true });
    expect(result.isError).toBe(true);
    expect(called).toBe(false);
  });

  test('passes confirmed Calendar work to the typed backend', async () => {
    let captured: ScheduleWorkToolInput | undefined;
    const result = await handleScheduleWork(context(async (input) => {
      captured = input;
      return { ok: true, destination: 'calendar', id: 'hq-work-1', title: input.title };
    }), calendarInput);
    expect(result.isError).toBe(false);
    expect(captured?.execution.type).toBe('agent-task');
    expect((result.content[0] as { text: string }).text).toContain('Work scheduled');
  });

  test('accepts exact Release Kit inputs and rejects malformed checksums', async () => {
    let captured: ScheduleWorkToolInput | undefined;
    const valid = await handleScheduleWork(context(async (value) => {
      captured = value;
      return { ok: true, destination: 'calendar' };
    }), { ...calendarInput, inputRefs: [{ kind: 'release-kit', itemId: 'kit-1', sha256: 'a'.repeat(64) }] });
    expect(valid.isError).toBe(false);
    expect(captured?.inputRefs?.[0]?.itemId).toBe('kit-1');

    const invalid = await handleScheduleWork(context(async () => ({ ok: true })), {
      ...calendarInput,
      inputRefs: [{ kind: 'release-kit', itemId: 'kit-1', sha256: 'not-a-hash' }],
    });
    expect(invalid.isError).toBe(true);
  });

  test('requires a trigger for Automation work', async () => {
    const result = await handleScheduleWork(context(async () => ({ ok: true })), {
      ...calendarInput,
      destination: 'automation',
      startAt: undefined,
      timezone: undefined,
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('requires a trigger');
  });

  test('accepts automatic cadence and rejects ambiguous schedule definitions', async () => {
    let captured: ScheduleWorkToolInput | undefined;
    const automatic = await handleScheduleWork(context(async (value) => {
      captured = value;
      return { ok: true, destination: 'automation', nextFireAt: '2026-09-07T14:00:00.000Z' };
    }), {
      ...calendarInput,
      destination: 'automation',
      startAt: undefined,
      execution: { type: 'workflow-run', workflowSlug: 'weekly-report', inputBindings: { topic: { mode: 'ask' } } },
      trigger: { type: 'schedule', cadence: 'weekly', timezone: 'America/Chicago' },
    });
    expect(automatic.isError).toBe(false);
    expect(captured?.trigger).toMatchObject({ cadence: 'weekly' });
    expect((automatic.content[0] as { text: string }).text).toBe('Every Monday at 9:00 AM, Weekly channel report will wait under Needs you for topic, then run using Weekly Report.')

    const monthly = await handleScheduleWork(context(async (value) => {
      captured = value;
      return { ok: true, destination: 'automation', nextFireAt: '2026-10-01T14:00:00.000Z' };
    }), {
      ...calendarInput,
      destination: 'automation',
      startAt: undefined,
      execution: { type: 'workflow-run', workflowSlug: 'monthly-report', inputBindings: { topic: { mode: 'ask' } } },
      trigger: { type: 'schedule', cadence: 'monthly', timezone: 'America/Chicago' },
    });
    expect(monthly.isError).toBe(false);
    expect(captured?.trigger).toMatchObject({ cadence: 'monthly' });
    expect((monthly.content[0] as { text: string }).text).toBe('Monthly on day 1 at 9:00 AM, Weekly channel report will wait under Needs you for topic, then run using Monthly Report.')

    const custom = await handleScheduleWork(context(async () => ({
      ok: true, destination: 'automation', nextFireAt: '2026-09-08T15:30:00.000Z',
    })), {
      ...calendarInput,
      destination: 'automation',
      startAt: undefined,
      execution: { type: 'workflow-run', workflowSlug: 'weekly-report', inputBindings: {} },
      trigger: { type: 'schedule', cron: '30 10 * * 2', timezone: 'America/Chicago' },
    });
    expect(custom.isError).toBe(false);
    expect((custom.content[0] as { text: string }).text).toBe('Next run Tuesday, Sep 8 at 10:30 AM, Weekly channel report will run using Weekly Report.')

    for (const trigger of [
      { type: 'schedule' as const, timezone: 'America/Chicago' },
      { type: 'schedule' as const, cron: '0 9 * * 1', cadence: 'weekly' as const, timezone: 'America/Chicago' },
    ]) {
      const invalid = await handleScheduleWork(context(async () => ({ ok: true })), {
        ...calendarInput,
        destination: 'automation',
        startAt: undefined,
        trigger,
      });
      expect(invalid.isError).toBe(true);
      expect((invalid.content[0] as { text: string }).text).toContain('exactly one');
    }
  });

  test('rejects per-run bindings on one-shot Calendar work', async () => {
    const result = await handleScheduleWork(context(async () => ({ ok: true })), {
      ...calendarInput,
      execution: {
        type: 'workflow-run',
        workflowSlug: 'weekly-report',
        inputBindings: { topic: { mode: 'ask' } },
      },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('only for Automation');
  });

  test('requires a bounded required-Output Calendar agent task for continuation', async () => {
    const result = await handleScheduleWork(context(async () => ({ ok: true })), {
      ...calendarInput,
      execution: {
        type: 'agent-task',
        agentSlug: 'youtube-research-agent',
        brief: 'Create the weekly YouTube intelligence report.',
        expectedOutput: { requirement: 'optional' },
      },
      continuation: { goalSlug: 'launch-goal', objective: 'Finish the launch plan.', maxRounds: 3 },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('required expectedOutput');
  });
});
