import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as definitions from '@craft-agent/shared/agent-definitions';

// Exercise the actual startup selection against an already-seeded library,
// without initializing sessions, contacting providers, or launching Electron.
function requiredStartupAgents(): typeof definitions.STARTER_AGENTS {
  const source = readFileSync(new URL('./SessionManager.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const required = STARTER_AGENTS.filter(');
  const end = source.indexOf('const { ensured } = ensureRequiredAgents(required)', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const names = ['STARTER_AGENTS', 'ORCHESTRATOR_SLUG', 'CONCIERGE_SLUG',
    'SETUP_CONCIERGE_SLUG', 'SOCIAL_PUBLISHER_SLUG', 'SONG_DIRECTOR_SLUG',
    'ANYTHING_AGENT_SLUG', 'RELEASE_MANAGER_AGENT_SLUG'] as const;
  return new Function(...names, source.slice(start, end) + '\nreturn required;')(
    ...names.map(name => definitions[name]),
  );
}

test('startup adds Website Agent to an existing library and preserves customization and deletion', () => {
  const root = mkdtempSync(join(tmpdir(), 'website-agent-startup-'));
  const options = { globalAgentsDir: join(root, 'agents') };
  const website = definitions.STARTER_AGENTS.find(agent => agent.slug === 'website-agent')!;
  try {
    definitions.seedGlobalLibraryIfEmpty(
      definitions.STARTER_AGENTS.filter(agent => agent.slug !== website.slug), options,
    );
    expect(definitions.seedGlobalLibraryIfEmpty(definitions.STARTER_AGENTS, options).seeded).toBe(0);
    expect(definitions.loadGlobalAgent(website.slug, options)).toBeNull();

    const required = requiredStartupAgents();
    definitions.ensureRequiredAgents(required, options);
    expect(definitions.loadGlobalAgent(website.slug, options)?.metadata.name).toBe('Website Agent');

    definitions.writeGlobalAgent({ ...website, systemPrompt: 'Keep my custom site instructions.' }, options);
    const file = join(options.globalAgentsDir, website.slug, 'AGENT.md');
    const custom = readFileSync(file, 'utf8');
    definitions.ensureRequiredAgents(required, options);
    expect(readFileSync(file, 'utf8')).toBe(custom);

    definitions.deleteGlobalAgent(website.slug, [], options);
    definitions.ensureRequiredAgents(required, options);
    expect(definitions.loadGlobalAgent(website.slug, options)).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
