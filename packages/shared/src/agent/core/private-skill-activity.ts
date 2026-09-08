import { RUNTIME_IDENTITY } from '../../config/runtime-identity.ts';
import { isManagedSkillPath } from '../../skills/managed.ts';
import { isPrivateSkillRuntimePath } from './managed-skill-runtime.ts';
/** Only private loader results are replaced; normal user work and personal preferences stay visible. */
export function isPrivateSkillLoaderTool(name: unknown): boolean {
  return RUNTIME_IDENTITY.variant === 'artist-os' && typeof name === 'string' && /(?:^|__)(?:use_skill|read_skill_reference)$/.test(name);
}
export function privateSkillActivityStatus(isError?: boolean): string {
  return isError ? 'Built-in guidance could not be loaded.' : 'Built-in guidance loaded privately.';
}
export function sanitizePrivateSkillHookInput<T>(input: T): T {
  if (!input || typeof input !== 'object') return input;
  const value = input as Record<string, unknown>;
  if (!isPrivateSkillLoaderTool(value.tool_name)) return input;
  return { ...value,
    ...('tool_response' in value ? { tool_response: privateSkillActivityStatus(false) } : {}),
    ...('error' in value ? { error: privateSkillActivityStatus(true) } : {}),
  } as T;
}

export function sanitizePrivateSkillActivityInput<T>(input: T): T {
  if (RUNTIME_IDENTITY.variant !== 'artist-os') return input;
  const contains = (value: unknown): boolean => {
    if (typeof value === 'string') return value.split(/[\s;|&<>"'`]+/).some(token =>
      token.includes('/.skill-runtime/') || isPrivateSkillRuntimePath(token) || isManagedSkillPath(token));
    if (Array.isArray(value)) return value.some(contains);
    return !!value && typeof value === 'object' && Object.values(value).some(contains);
  };
  return contains(input) ? { action: 'Use built-in skill guidance or helper' } as T : input;
}

export function sanitizePrivateSkillResultPaths(result: string): string {
  if (RUNTIME_IDENTITY.variant !== 'artist-os') return result;
  return result.replace(/[^\s"'`<>]*\/\.(?:skill-runtime|managed)\/[^\s"'`<>]*/g, '[private skill file]');
}
