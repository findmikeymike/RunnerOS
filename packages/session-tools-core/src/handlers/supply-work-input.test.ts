import { describe, expect, test } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleSupplyWorkInput, type SupplyWorkInputToolInput } from './supply-work-input.ts';

const input: SupplyWorkInputToolInput = {
  orderId: 'work-1',
  requestId: 'work-1:input',
  expectedUpdatedAt: '2026-09-02T00:00:00.000Z',
  values: { topic: 'Night drive' },
};

describe('supply_work_input', () => {
  test('is unavailable without the Artist Manager host capability', async () => {
    const result = await handleSupplyWorkInput({} as SessionToolContext, input);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('Artist Manager');
  });

  test('passes only the exact request and artist-provided values to the host', async () => {
    let captured: SupplyWorkInputToolInput | undefined;
    const result = await handleSupplyWorkInput({
      supplyWorkInput: async (value: SupplyWorkInputToolInput) => {
        captured = value;
        return {
          updated: true,
          work: { version: 1, workspaceId: 'workspace-1', items: [], updatedAt: '2026-09-02T00:00:00.000Z' },
          order: { title: 'Weekly report', status: 'scheduled' } as never,
        };
      },
    } as unknown as SessionToolContext, input);

    expect(result.isError).toBe(false);
    expect(captured).toEqual(input);
    expect((result.content[0] as { text: string }).text).toContain('now scheduled');
  });

  test('rejects malformed values before calling the host', async () => {
    let called = false;
    const result = await handleSupplyWorkInput({
      supplyWorkInput: async () => {
        called = true;
        throw new Error('should not run');
      },
    } as unknown as SessionToolContext, { ...input, values: [] as never });
    expect(result.isError).toBe(true);
    expect(called).toBe(false);
  });
});
