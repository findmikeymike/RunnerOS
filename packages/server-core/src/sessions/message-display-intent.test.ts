import { describe, expect, it } from 'bun:test';
import { messageToStored, storedToMessage, type Message } from '@craft-agent/core/types';

describe('message display intent', () => {
  it('persists Canvas visual review display intent', () => {
    const message: Message = {
      id: 'msg-1',
      role: 'user',
      content: '<system-reminder>hidden model prompt</system-reminder>',
      timestamp: 123,
      displayIntent: 'canvas-visual-review',
    };

    const stored = messageToStored(message);
    expect(stored.displayIntent).toBe('canvas-visual-review');
    expect(storedToMessage(stored).displayIntent).toBe('canvas-visual-review');
  });

  it('persists passive agent message display intent', () => {
    const message: Message = {
      id: 'msg-2',
      role: 'user',
      content: 'Passive agent update.',
      timestamp: 123,
      displayIntent: 'agent-message-passive',
    };

    const stored = messageToStored(message);
    expect(stored.displayIntent).toBe('agent-message-passive');
    expect(storedToMessage(stored).displayIntent).toBe('agent-message-passive');
  });
});
