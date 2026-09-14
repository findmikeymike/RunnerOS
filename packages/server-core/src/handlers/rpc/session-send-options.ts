import type { SendMessageOptions } from '@craft-agent/shared/protocol';

/** Renderer input is always a new human choice, never a host migration replay marker. */
export function humanSendMessageOptions(options?: SendMessageOptions): SendMessageOptions {
  const { steerNext: _hostPriority, ...humanOptions } = options ?? {};
  return { ...humanOptions, inputOrigin: 'human', legacySkillReferences: [] };
}
