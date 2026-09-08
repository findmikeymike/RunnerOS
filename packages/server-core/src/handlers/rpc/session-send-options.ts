import type { SendMessageOptions } from '@craft-agent/shared/protocol';

/** Renderer input is always a new human choice, never a host migration replay marker. */
export function humanSendMessageOptions(options?: SendMessageOptions): SendMessageOptions {
  return { ...options, inputOrigin: 'human', legacySkillReferences: [] };
}
