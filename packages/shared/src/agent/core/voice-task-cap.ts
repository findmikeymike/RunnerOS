import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

/** Host-only origin, copied and frozen at backend construction. Never an agent grant. */
export interface VoiceTaskScope {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly attemptId: string;
  readonly workspaceId: string;
}

/** Bind once so caller mutation and later permission/provider changes cannot erase origin. */
export function bindImmutableVoiceTaskScope(target: { voiceTaskScope?: VoiceTaskScope }, scope: VoiceTaskScope | undefined): void {
  if (scope !== undefined) Object.defineProperty(target, 'voiceTaskScope', {
    value: Object.freeze({ ...scope }), writable: false, configurable: false, enumerable: true,
  });
}

export function assertVoiceTaskBackend(scope: VoiceTaskScope | undefined, provider: string): void {
  if (scope !== undefined && provider !== 'anthropic') throw new Error('Voice tasks require the enforced Claude backend; use Command.');
}

/** Narrow initial capability: inline local draft outputs and regular workspace file reads. */
export function voiceTaskToolBlockReason(ctx: {
  voiceTaskScope?: VoiceTaskScope;
  workspaceId: string;
  workspaceRootPath: string;
  toolName: string;
  input: Record<string, unknown>;
}): string | null {
  const scope = ctx.voiceTaskScope;
  if (scope === undefined) return null;
  const deny = 'Voice-origin task cannot perform this action. Continue through the existing task UI or Command with an exact action approval.';
  if (!scope || scope.schemaVersion !== 1 || typeof scope.taskId !== 'string' || !scope.taskId.trim() || typeof scope.attemptId !== 'string' || !scope.attemptId.trim() || scope.workspaceId !== ctx.workspaceId) return deny;
  if (ctx.toolName === 'Read') {
    const path = ctx.input.file_path;
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) return deny;
    try {
      const root = realpathSync(ctx.workspaceRootPath);
      const file = realpathSync(path);
      const rel = relative(root, file);
      const lexical = relative(ctx.workspaceRootPath, path);
      // Hidden config/credential paths and symlinks are outside this initial capability.
      if (!rel || isAbsolute(rel) || rel.split(sep).some(p => p.startsWith('.')) || lexical !== rel || !statSync(file).isFile()) return deny;
      return null;
    } catch { return deny; }
  }
  if (ctx.toolName === 'mcp__session__create_output') {
    // No attachment imports, URLs, claimed external receipts, promotions or agent-supplied approvals.
    const allowed = new Set(['title', 'summary', 'kind', 'content', 'contentMimeType', 'tags', 'showInCanvas', 'show_in_canvas']);
    if (Object.keys(ctx.input).some(key => !allowed.has(key))) return deny;
    if (!['document', 'report'].includes(String(ctx.input.kind))) return deny;
    if (['title', 'summary', 'content'].some(key => typeof ctx.input[key] !== 'string' || !(ctx.input[key] as string).trim())) return deny;
    if (ctx.input.contentMimeType !== undefined && !['text/plain', 'text/markdown'].includes(String(ctx.input.contentMimeType))) return deny;
    return null;
  }
  return deny;
}
