import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleConfigValidate } from './config-validate.ts';

function createCtx(workspacePath: string) {
  return {
    sessionId: 'test-session',
    workspacePath,
    get sourcesPath() { return join(workspacePath, 'sources'); },
    get skillsPath() { return join(workspacePath, 'skills'); },
    plansFolderPath: join(workspacePath, 'plans'),
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: {
      exists: (path: string) => existsSync(path),
      readFile: (path: string) => readFileSync(path, 'utf-8'),
      readFileBuffer: (path: string) => readFileSync(path),
      writeFile: (path: string, content: string) => writeFileSync(path, content),
      isDirectory: (path: string) => existsSync(path) && statSync(path).isDirectory(),
      readdir: (path: string) => readdirSync(path),
      stat: (path: string) => {
        const s = statSync(path);
        return { size: s.size, isDirectory: () => s.isDirectory() };
      },
    },
    validators: undefined,
    loadSourceConfig: () => null,
  } as const;
}

describe('config-validate automations target', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'config-validate-automations-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('validates automations.json when present', async () => {
    writeFileSync(join(tempDir, 'automations.json'), JSON.stringify({ version: 2, automations: {} }));

    const result = await handleConfigValidate(createCtx(tempDir), { target: 'automations' });
    expect(result.content[0]?.text).toContain('Validation passed');
  });

  it('returns no-config message when automations.json does not exist', async () => {
    const result = await handleConfigValidate(createCtx(tempDir), { target: 'automations' });
    expect(result.content[0]?.text).toContain('No automations.json');
  });
});

describe('config-validate product root isolation', () => {
  let tempDir: string;
  let originalConfigDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'config-validate-product-root-test-'));
    originalConfigDir = process.env.CRAFT_CONFIG_DIR;
  });

  afterEach(() => {
    if (originalConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
    else process.env.CRAFT_CONFIG_DIR = originalConfigDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('validates the configured Trade God root instead of sibling Runner data', async () => {
    const tradeGodRoot = join(tempDir, '.trade-god');
    const runnerRoot = join(tempDir, '.craft-agent');
    const workspaceRoot = join(tradeGodRoot, 'workspaces', 'trading');
    mkdirSync(tradeGodRoot, { recursive: true });
    mkdirSync(runnerRoot, { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(join(tradeGodRoot, 'config.json'), JSON.stringify({ workspaces: [] }));
    writeFileSync(join(runnerRoot, 'config.json'), JSON.stringify({ wrong: true }));
    process.env.CRAFT_CONFIG_DIR = tradeGodRoot;

    const result = await handleConfigValidate(createCtx(workspaceRoot), { target: 'config' });

    expect(result.content[0]?.text).toContain('Validation passed');
  });
});
