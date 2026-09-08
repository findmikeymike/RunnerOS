import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Fresh processes keep product identity deterministic; no real profile is loaded or seeded.
test('Runner retains ordinary tools, paths, output and run storage while Artist OS enables private guidance', () => {
  const root = mkdtempSync(join(tmpdir(), 'skill-product-boundary-'));
  try {
    const script = `
      import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
      import { join } from 'node:path';
      import { importResources } from '../../resources/resource-bundle.ts';
      import { handleSkillValidate } from '../../../../session-tools-core/src/handlers/skill-validate.ts';
      import { shouldAllowToolInMode } from '../mode-manager.ts';
      import { checkManagedSkillToolAccess } from './managed-skill-tool-guard.ts';
      import { sanitizePrivateSkillHookInput, sanitizePrivateSkillResultPaths } from './private-skill-activity.ts';
      import { getSessionToolProxyDefs } from '../backend/pi/session-tool-defs.ts';
      import { TestAgent, createMockBackendConfig, createMockWorkspace, createMockSession, collectEvents } from '../__tests__/test-utils.ts';
      class PlainAgent extends TestAgent { protected extractSkillPaths(message: string) { return { skillPaths: new Map(), cleanMessage: message, missingSkills: [] }; } }
      const root = process.env.CRAFT_CONFIG_DIR!;
      const session = createMockSession({ id: 'product-boundary' });
      const sessionRoot = join(root, 'sessions', session.id);
      mkdirSync(sessionRoot, { recursive: true });
      const agent = new PlainAgent(createMockBackendConfig({ workspace: createMockWorkspace({ rootPath: root }), session }));
      await collectEvents(agent.chat('hello'));
      const path = join(sessionRoot, '.skill-runtime', 'recipe.md');
      const ownBody = ${JSON.stringify('---\nname: Monid\ndescription: My user skill\n---\nMy own instructions.')};
      const imported = await importResources(root, { version: 1, exportedAt: Date.now(), resources: { skills: [{ slug: 'monid', files: [{ relativePath: 'SKILL.md', contentBase64: Buffer.from(ownBody).toString('base64'), size: Buffer.byteLength(ownBody) }] }] } }, 'skip', {} as any);
      mkdirSync(join(root, 'skills/monid'), { recursive: true });
      writeFileSync(join(root, 'skills/monid/SKILL.md'), ownBody);
      let bodyReads = 0;
      const validated = await handleSkillValidate({ workspacePath: root, sessionId: session.id, workingDirectory: root,
        fs: { exists: existsSync, readFile: (path: string) => { bodyReads++; return readFileSync(path, 'utf8'); } }
      } as any, { skillSlug: 'monid' });
      mkdirSync(join(root, 'skills/my-notes'), { recursive: true });
      writeFileSync(join(root, 'skills/my-notes/SKILL.md'), ownBody);
      const ownValidation = await handleSkillValidate({ workspacePath: root, sessionId: session.id, workingDirectory: root, fs: { exists: existsSync, readFile: (path: string) => readFileSync(path, 'utf8') } } as any, { skillSlug: 'my-notes' });
      const disabled = await handleSkillValidate({ workspacePath: root, sessionId: session.id, workingDirectory: root, fs: { exists: existsSync, readFile: (path: string) => readFileSync(path, 'utf8') } } as any, { skillSlug: 'zero' });
      const hook = { tool_name: 'use_skill', tool_response: 'ordinary response' };
      console.log(JSON.stringify({
        materialized: existsSync(join(root, 'libraries/agents/skills/.managed')),
        imported: imported.skills.imported, importErrors: imported.skills.failed, validation: validated, bodyReads, disabled, ownValidation,
        safeReads: ['use_skill', 'read_skill_reference', 'get_skill_personal_instructions'].map(name => shouldAllowToolInMode('mcp__session__' + name, {}, 'safe').allowed),
        safeWrites: ['save_skill_personal_instructions', 'delete_skill_personal_instructions'].map(name => shouldAllowToolInMode('mcp__session__' + name, {}, 'safe').allowed),
        privateTool: getSessionToolProxyDefs().some(tool => tool.name.endsWith('__use_skill')),
        blocked: checkManagedSkillToolAccess('Read', { file_path: path }, root) !== null,
        result: sanitizePrivateSkillResultPaths(path),
        hook: sanitizePrivateSkillHookInput(hook).tool_response,
        snapshot: existsSync(join(sessionRoot, '.skill-runtime', 'current.json'))
      }));
    `;
    const artistIntegration = spawnSync(process.execPath, ['test', './managed-skill-agent.test.ts', './managed-skill-runtime.test.ts', './private-skill-activity.test.ts', '../__tests__/base-agent.test.ts'], {
      cwd: import.meta.dir,
      env: { ...process.env, CRAFT_PRODUCT_VARIANT: 'artist-os', CRAFT_CONFIG_DIR: join(root, 'artist-integration') },
      encoding: 'utf8', timeout: 30000,
    });
    expect(artistIntegration.status, artistIntegration.stdout + artistIntegration.stderr).toBe(0);
    expect(artistIntegration.stderr).not.toMatch(/\d+ skip/);
    for (const variant of ['runner', 'artist-os']) {
      const result = spawnSync(process.execPath, ['-e', script], {
        cwd: import.meta.dir,
        env: { ...process.env, CRAFT_PRODUCT_VARIANT: variant, CRAFT_CONFIG_DIR: join(root, variant) },
        encoding: 'utf8', timeout: 30000,
      });
      expect(result.status, result.stderr).toBe(0);
      const actual = JSON.parse(result.stdout.trim().split('\n').at(-1)!);
      const artist = variant === 'artist-os';
      expect(actual.materialized).toBe(false);
      expect(actual.imported).toEqual(artist ? [] : ['monid']);
      expect(actual.importErrors.length).toBe(artist ? 1 : 0);
      expect(actual.validation.isError).toBe(false);
      expect(actual.ownValidation.isError).toBe(false);
      expect(JSON.stringify(actual.ownValidation)).toContain('Validated from workspace tier');
      expect(actual.bodyReads).toBe(artist ? 0 : 1);
      if (artist) {
        expect(actual.disabled.isError).toBe(false);
        expect(JSON.stringify(actual.disabled)).toContain('not enabled');
        expect(JSON.stringify(actual.disabled)).not.toContain('Create it');
        expect(JSON.stringify(actual.validation)).toContain('installed and available');
        expect(JSON.stringify(actual.validation)).not.toContain('.managed');
        expect(JSON.stringify(actual.validation)).not.toContain('My own instructions');
      }
      expect(actual.safeReads).toEqual([artist, artist, artist]);
      expect(actual.safeWrites).toEqual([false, false]);
      expect(actual.privateTool).toBe(artist);
      expect(actual.blocked).toBe(artist);
      expect(actual.snapshot).toBe(artist);
      expect(actual.hook).toBe(artist ? 'Built-in guidance loaded privately.' : 'ordinary response');
      expect(actual.result).toBe(artist ? '[private skill file]' : join(root, variant, 'sessions/product-boundary/.skill-runtime/recipe.md'));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
