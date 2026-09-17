import { basename, join, resolve } from 'node:path';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { getWorkspaces } from '../../../shared/src/config/storage';
import { getSourceCredentialManager } from '../../../shared/src/sources/credential-manager';
import { loadSource } from '../../../shared/src/sources/storage';
import { isApiOAuthProvider, type LoadedSource } from '../../../shared/src/sources/types';
import type { StoredCredential } from '../../../shared/src/credentials/types';
import { canonical, digest } from '../../../shared/src/durable-execution';
import { durableCredentialIdentity, isDurableWebReadUrls } from '../../../shared/src/protocol/durable-execution';

/** Host-private preparatory contract. NOT a journal descriptor or a model tool grant. */
export interface DurableConnectedReadBinding {
  revision: 'workspace-bearer-read-1';
  workspaceId: string;
  sourceSlug: string;
  sourceIdentity: string;
  credentialIdentity: string;
  urls: string[];
}
const failure = () => new Error('durable-connected-read-binding-unavailable');
const defaults = {
  getWorkspaces,
  loadSource,
  loadCredential: async (source: LoadedSource): Promise<StoredCredential | null> => {
    const manager = getSourceCredentialManager();
    const id = manager.getCredentialId(source);
    // First slice deliberately requires this workspace's own static bearer record.
    if (id.type !== 'source_bearer' || id.workspaceId !== source.workspaceId || id.sourceId !== source.config.slug) throw failure();
    return manager.load(source);
  },
  now: () => Date.now(),
};

function plainFile(path: string, optional = false): void {
  try { if (!lstatSync(path).isFile()) throw failure(); }
  catch (error) { if (!optional || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw failure(); }
}
function validToken(credential: StoredCredential | null, now: number): string {
  const token = credential?.value;
  if (typeof token !== 'string' || !token || token.length > 8192 || !/^[A-Za-z0-9\-._~+/]+=*$/.test(token)
    || credential?.refreshToken || credential?.expiresAt !== undefined && (!Number.isFinite(credential.expiresAt) || credential.expiresAt <= now)) throw failure();
  return token;
}

/**
 * Freeze/recheck connection identity before a future certified transport dispatch.
 * This does not certify arbitrary GET endpoints as read-only, resolve DNS, authorize
 * the caller or execute network requests. Those remain mandatory adapter/host gates.
 */
export function createDurableConnectedReadBindingResolver(deps = defaults) {
  function current(workspaceId: string, sourceSlug: string, urls: string[]) {
    if (typeof workspaceId !== 'string' || !workspaceId.trim()
      || typeof sourceSlug !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(sourceSlug)
      || !isDurableWebReadUrls(urls)) throw failure();
    const workspace = deps.getWorkspaces().find(item => item.id === workspaceId);
    if (!workspace || workspace.remoteServer) throw failure();
    const root = realpathSync(workspace.rootPath), stat = statSync(root);
    if (!stat.isDirectory()) throw failure();
    const directory = join(root, 'sources', sourceSlug);
    if (!lstatSync(join(root, 'sources')).isDirectory() || !lstatSync(directory).isDirectory()) throw failure();
    plainFile(join(directory, 'config.json')); plainFile(join(directory, 'guide.md'), true);
    // The ordinary source loader treats unreadable guides as absent. Binding must
    // distinguish missing from unreadable so recovery cannot silently drop context.
    let guide: string | null = null;
    try { guide = readFileSync(join(directory, 'guide.md'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw failure(); }
    const loaded = deps.loadSource(workspace.rootPath, sourceSlug);
    if (!loaded || loaded.tier !== 'workspace' || loaded.isBuiltin || loaded.config.slug !== sourceSlug
      || loaded.workspaceId !== basename(workspace.rootPath) || resolve(loaded.workspaceRootPath) !== resolve(workspace.rootPath)
      || realpathSync(loaded.folderPath) !== directory) throw failure();
    // Break references to mutable source objects supplied by loaders/test seams.
    const source = structuredClone(loaded), config = source.config, api = config.api;
    if (config.type !== 'api' || config.enabled !== true || config.isAuthenticated !== true
      || config.connectionStatus === 'needs_auth' || config.connectionStatus === 'failed'
      || config.mcp || config.local || isApiOAuthProvider(config.provider)
      || !api || api.authType !== 'bearer'
      || Object.keys(api).some(key => !['baseUrl', 'authType', 'authScheme', 'testEndpoint'].includes(key))
      || api.authScheme !== undefined && api.authScheme !== 'Bearer') throw failure();
    if (!isDurableWebReadUrls([api.baseUrl])) throw failure();
    const base = new URL(api.baseUrl);
    if (base.search) throw failure();
    const prefix = base.pathname.endsWith('/') ? base.pathname : base.pathname + '/';
    for (const raw of urls) {
      const url = new URL(raw);
      if (url.origin !== base.origin || url.search || /%(?:2f|5c|00)/i.test(url.pathname)
        || url.pathname !== base.pathname && !url.pathname.startsWith(prefix)) throw failure();
    }
    return { source, sourceIdentity: digest({ workspaceId, credentialNamespace: source.workspaceId,
      root, dev: stat.dev, ino: stat.ino, config, guide }) };
  }
  async function resolveBinding(workspaceId: string, sourceSlug: string, urls: string[]) {
    // Copy before the first await so caller mutations cannot widen a saved grant.
    urls = structuredClone(urls);
    const before = current(workspaceId, sourceSlug, urls);
    const credential = await deps.loadCredential(before.source);
    const token = validToken(credential, deps.now());
    const credentialIdentity = await durableCredentialIdentity({
      provider: `connected-source:${before.sourceIdentity}`, credential: { type: 'api_key', key: token },
    });
    if (current(workspaceId, sourceSlug, urls).sourceIdentity !== before.sourceIdentity) throw failure();
    // A second lookup fences rotation/removal while the first lookup/hash was pending.
    const latest = await deps.loadCredential(current(workspaceId, sourceSlug, urls).source);
    if (validToken(latest, deps.now()) !== token
      || current(workspaceId, sourceSlug, urls).sourceIdentity !== before.sourceIdentity) throw failure();
    const binding: DurableConnectedReadBinding = { revision: 'workspace-bearer-read-1', workspaceId, sourceSlug,
      sourceIdentity: before.sourceIdentity, credentialIdentity, urls };
    return { binding, token };
  }
  return {
    async capture(workspaceId: string, sourceSlug: string, urls: string[]): Promise<DurableConnectedReadBinding> {
      try { return (await resolveBinding(workspaceId, sourceSlug, urls)).binding; } catch { throw failure(); }
    },
    /** Host transport only. Invoke synchronously after revalidation; never serialize the token. */
    async withCurrentCredential<T>(binding: DurableConnectedReadBinding, dispatch: (token: string) => T): Promise<T> {
      let resolved: Awaited<ReturnType<typeof resolveBinding>>;
      try {
        const pinned = structuredClone(binding);
        resolved = await resolveBinding(pinned.workspaceId, pinned.sourceSlug, pinned.urls);
        if (canonical(resolved.binding) !== canonical(pinned)) throw failure();
      } catch { throw failure(); }
      return dispatch(resolved.token);
    },
    /** Recheck a persisted host-owned binding. Never accept a renderer-supplied binding. */
    async assertCurrent(binding: DurableConnectedReadBinding): Promise<void> {
      try {
        const pinned = structuredClone(binding);
        const current = await resolveBinding(pinned.workspaceId, pinned.sourceSlug, pinned.urls);
        if (canonical(current.binding) !== canonical(pinned)) throw failure();
      } catch { throw failure(); }
    },
  };
}
