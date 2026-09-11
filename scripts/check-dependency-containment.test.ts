import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDependencyContainment } from './check-dependency-containment';

function fixture(run: (base: string, root: string, pkg: (path: string, data?: object) => void) => void) {
  const base = mkdtempSync(join(tmpdir(), 'dependency-containment-'));
  const root = join(base, 'checkout');
  const pkg = (path: string, data: object = {}) => {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'fixture', main: 'index.js', ...data }));
    writeFileSync(join(path, 'index.js'), 'module.exports = {};');
  };
  pkg(root);
  try { run(base, root, pkg); } finally { rmSync(base, { recursive: true, force: true }); }
}

test('accepts local hoisting, workspace links, and absent platform optional packages', () => fixture((_base, root, pkg) => {
  pkg(root, { dependencies: { linked: '*' }, optionalDependencies: { 'not-installed-platform-package': '*' } });
  pkg(join(root, 'packages', 'linked'), { dependencies: { hoisted: '*' } });
  pkg(join(root, 'node_modules', 'hoisted'));
  symlinkSync(join(root, 'packages', 'linked'), join(root, 'node_modules', 'linked'));
  expect(checkDependencyContainment(root)).toEqual([]);
}));

test('detects undeclared parent installation used by declared manifest dependency', () => fixture((base, root, pkg) => {
  pkg(root, { dependencies: { phantom: '*' } });
  pkg(join(base, 'node_modules', 'phantom'));
  expect(checkDependencyContainment(root).some(message => message.includes('phantom'))).toBe(true);
}));

test('detects package and entry symlinks escaping checkout', () => fixture((base, root, pkg) => {
  pkg(join(base, 'external'));
  mkdirSync(join(root, 'node_modules'));
  symlinkSync(join(base, 'external'), join(root, 'node_modules', 'linked'));
  pkg(root, { dependencies: { entry: '*' } });
  pkg(join(root, 'node_modules', 'entry'), { main: 'escape.js' });
  symlinkSync(join(base, 'external', 'index.js'), join(root, 'node_modules', 'entry', 'escape.js'));
  const result = checkDependencyContainment(root);
  expect(result.some(message => message.includes('package location'))).toBe(true);
  expect(result.some(message => message.includes('runtime entry'))).toBe(true);
}));

test('detects TypeScript declaration outside root even with local runtime', () => fixture((base, root, pkg) => {
  pkg(join(root, 'node_modules', 'fixturedep'), { types: '../../../external.d.ts' });
  writeFileSync(join(base, 'external.d.ts'), 'export const value: string;');
  writeFileSync(join(root, 'source.ts'), "import { value } from 'fixturedep'; console.log(value);");
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, types: [], moduleResolution: 'node' }, files: ['source.ts'] }));
  expect(checkDependencyContainment(root, ['tsconfig.json']).some(message => message.includes('TypeScript') && message.includes('external.d.ts'))).toBe(true);
}));

test('detects parent build tooling imports absent from manifests', () => fixture((base, root, pkg) => {
  pkg(join(base, 'node_modules', 'build-plugin'));
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'scripts', 'build.ts'), "import 'build-plugin';");
  expect(checkDependencyContainment(root).some(message => message.includes('runtime build-plugin'))).toBe(true);
}));

test('ignores unused optional peer reachable only in parent installation', () => fixture((base, root, pkg) => {
  pkg(root, { dependencies: { installed: '*' } });
  pkg(join(root, 'node_modules', 'installed'), { peerDependencies: { 'optional-adapter': '*' }, peerDependenciesMeta: { 'optional-adapter': { optional: true } } });
  pkg(join(base, 'node_modules', 'optional-adapter'));
  expect(checkDependencyContainment(root)).toEqual([]);
}));

test('detects automatic ancestor type discovery and accepts explicit local type roots', () => fixture((base, root, pkg) => {
  pkg(join(base, 'node_modules', '@types', 'ambient-fixture'), { types: 'index.d.ts' });
  writeFileSync(join(base, 'node_modules', '@types', 'ambient-fixture', 'index.d.ts'), 'declare const ambientFixture: string;');
  writeFileSync(join(root, 'source.ts'), 'export const value = 1;');
  const config = { compilerOptions: { noLib: true }, files: ['source.ts'] };
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(config));
  expect(checkDependencyContainment(root, ['tsconfig.json']).some(message => message.includes('ambient-fixture'))).toBe(true);
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ ...config, compilerOptions: { ...config.compilerOptions, typeRoots: ['./node_modules/@types'] } }));
  expect(checkDependencyContainment(root, ['tsconfig.json'])).toEqual([]);
}));

test('locked SDK patches remove ancestor probes while retaining bare type imports', () => {
  for (const directory of ['node_modules/@anthropic-ai/sdk', 'node_modules/@earendil-works/pi-ai/node_modules/@anthropic-ai/sdk']) {
    for (const name of ['types.d.ts', 'types.d.mts']) {
      const source = readFileSync(join(import.meta.dir, '..', directory, 'internal', name), 'utf8');
      expect(source).not.toMatch(/import\(['"](?:\.\.\/)+node_modules\//);
      expect(source).toContain("import('undici-types')");
      expect(source).toContain("import('node-fetch')");
    }
  }
});


test('Google SDK type-only patch preserves local imports in every declaration entry', () => {
  for (const name of ['genai.d.ts', 'node/node.d.ts', 'web/web.d.ts']) {
    const source = readFileSync(join(import.meta.dir, '../node_modules/@google/genai/dist', name), 'utf8');
    expect(source).not.toMatch(/import\(['"](?:\.\.\/)+node_modules\//);
    expect(source).toContain("import('undici-types')");
    expect(source).toContain("import('node-fetch')");
  }
});
