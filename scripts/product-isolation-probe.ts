import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUNTIME_IDENTITY } from '../packages/shared/src/config/runtime-identity.ts';
import { saveConfig } from '../packages/shared/src/config/storage.ts';
import { ensureDefaultWorkspacesDir } from '../packages/shared/src/workspaces/storage.ts';
import { GLOBAL_AGENTS_DIR } from '../packages/shared/src/agent-definitions/storage.ts';
import { GLOBAL_AGENT_SKILLS_DIR } from '../packages/shared/src/skills/storage.ts';
import { GLOBAL_AGENT_SOURCES_DIR } from '../packages/shared/src/sources/storage.ts';
import { GLOBAL_WORKFLOWS_DIR } from '../packages/shared/src/workflows/storage.ts';
import { SecureStorageBackend } from '../packages/shared/src/credentials/backends/secure-storage.ts';

if (RUNTIME_IDENTITY.variant !== 'artist-os') {
  throw new Error('Isolation probe must run with CRAFT_PRODUCT_VARIANT=artist-os');
}

saveConfig({
  workspaces: [],
  activeWorkspaceId: null,
  activeSessionId: null,
});
ensureDefaultWorkspacesDir();

for (const [directory, filename] of [
  [GLOBAL_AGENTS_DIR, 'probe-agent.txt'],
  [GLOBAL_AGENT_SKILLS_DIR, 'probe-skill.txt'],
  [GLOBAL_AGENT_SOURCES_DIR, 'probe-source.txt'],
  [GLOBAL_WORKFLOWS_DIR, 'probe-workflow.txt'],
  [RUNTIME_IDENTITY.logsRoot, 'probe-log.txt'],
  [RUNTIME_IDENTITY.browserDataRoot, 'probe-browser.txt'],
  [RUNTIME_IDENTITY.integrationCacheRoot, 'probe-integration-cache.txt'],
  [RUNTIME_IDENTITY.socialDataRoot, 'probe-social-data.txt'],
] as const) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, filename), 'artist-os-isolation-probe\n', 'utf8');
}

const credentials = new SecureStorageBackend();
await credentials.set(
  { type: 'user_secret', name: 'ARTIST_OS_ISOLATION_PROBE' },
  { value: 'probe-only', createdAt: Date.now(), updatedAt: Date.now() },
);

console.log(JSON.stringify({
  identity: RUNTIME_IDENTITY,
  paths: {
    config: join(RUNTIME_IDENTITY.dataRoot, 'config.json'),
    workspaces: RUNTIME_IDENTITY.workspacesRoot,
    credentials: RUNTIME_IDENTITY.credentialsFile,
    agents: GLOBAL_AGENTS_DIR,
    skills: GLOBAL_AGENT_SKILLS_DIR,
    sources: GLOBAL_AGENT_SOURCES_DIR,
    workflows: GLOBAL_WORKFLOWS_DIR,
    logs: join(RUNTIME_IDENTITY.logsRoot, 'probe-log.txt'),
    browser: join(RUNTIME_IDENTITY.browserDataRoot, 'probe-browser.txt'),
    integrationCache: join(RUNTIME_IDENTITY.integrationCacheRoot, 'probe-integration-cache.txt'),
    socialData: join(RUNTIME_IDENTITY.socialDataRoot, 'probe-social-data.txt'),
  },
}));
