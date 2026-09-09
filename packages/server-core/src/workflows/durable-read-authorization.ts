import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { digest } from '../../../shared/src/durable-execution/index.ts';
import { getAppPermissionsDir, getWorkspacePermissionsPath, PermissionsConfigSchema, permissionsConfigCache } from '../../../shared/src/agent/permissions-config.ts';
import { shouldAllowToolInMode } from '../../../shared/src/agent/mode-manager.ts';
import type { DurableReadRunnerOptions } from './durable-read-runner.ts';

/** Hash validated source policy, not cached compiled RegExp objects. */
export function readDurablePolicyRevision(configRoot: string, workspaceRoot: string): string {
  if (resolve(configRoot, 'permissions') !== resolve(getAppPermissionsDir())) throw new Error('durable-permission-policy-source-mismatch');
  const read = (path: string) => {
    let raw: string;
    try { raw = readFileSync(path, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('durable-permission-policy-invalid'); }
    if (!PermissionsConfigSchema.safeParse(parsed).success) throw new Error('durable-permission-policy-invalid');
    return parsed;
  };
  return digest({ version: 'desktop-read-approval-1', mode: 'safe', defaults: read(join(configRoot, 'permissions/default.json')), workspace: read(getWorkspacePermissionsPath(workspaceRoot)) });
}

export function createDurableReadAuthorization(options: {
  configRoot: string;
  resolveBinding: DurableReadRunnerOptions['resolveBinding'];
  assertRunPrincipal(workspaceId: string, principalId: string): void;
  now?: () => number;
}): NonNullable<DurableReadRunnerOptions['authorizeTool']> {
  return async (request, context) => {
    options.assertRunPrincipal(context.workspaceId, context.approvalPrincipalId);
    const binding = await options.resolveBinding(context.workspaceId, context.connectionSlug, context.model);
    options.assertRunPrincipal(context.workspaceId, context.approvalPrincipalId);
    if (binding.workspace.id !== context.workspaceId || binding.workspace.remoteServer || binding.credentialIdentity !== context.credentialIdentity || binding.context.connection?.slug !== context.connectionSlug || binding.context.resolvedModel !== context.model) throw new Error('durable-authorization-binding-changed');
    const revision = readDurablePolicyRevision(options.configRoot, binding.workspace.rootPath);
    permissionsConfigCache.invalidateDefaults();
    permissionsConfigCache.invalidateWorkspace(binding.workspace.rootPath);
    const tool = { read: 'Read', grep: 'Grep', find: 'Glob', ls: 'Glob' }[request.tool];
    const now = (options.now ?? Date.now)();
    const allowed = !!tool && now < context.deadlineAt && shouldAllowToolInMode(tool, request.input, 'safe', { permissionsContext: { workspaceRootPath: binding.workspace.rootPath, activeSourceSlugs: [] } }).allowed;
    return { principalId: context.approvalPrincipalId, credentialIdentity: binding.credentialIdentity, policyRevision: revision,
      allowed, requiresApproval: true, approvalExpiresAt: Math.min(context.deadlineAt, now + 15 * 60_000) };
  };
}
