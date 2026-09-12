/** Developer/CI check, not a runtime gate. Covers TS programs, installed package
 * locations, manifest dependency/entry resolution, and literal build-tool imports.
 * Missing entries belong to install/typecheck/build checks. Computed imports and
 * every platform/export condition are deliberately NOT claimed as covered. */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import ts from 'typescript';

export function checkDependencyContainment(rootInput: string, configs: string[] = []): string[] {
  const root = realpathSync(rootInput);
  const failures = new Set<string>();
  const check = (path: string, context: string): boolean => {
    const actual = realpathSync(path);
    const rel = relative(root, actual);
    const inside = rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel);
    if (!inside) failures.add(`${context}: ${path} -> ${actual}`);
    return inside;
  };
  const packageAt = (name: string, from: string): string | undefined => {
    let directory = from;
    while (true) {
      const path = join(directory, 'node_modules', name);
      if (existsSync(join(path, 'package.json'))) return path;
      const parent = dirname(directory);
      if (parent === directory) return undefined;
      directory = parent;
    }
  };
  const visited = new Set<string>();
  const runtime = (name: string, from: string) => {
    let entry: string;
    try { entry = Bun.resolveSync(name, from); } catch { return; }
    if (isAbsolute(entry) && existsSync(entry)) check(entry, `runtime ${name} from ${relative(root, from)}`);
  };
  const inspectPackage = (directory: string) => {
    if (!check(directory, 'package location')) return;
    const actual = realpathSync(directory);
    if (visited.has(actual)) return;
    visited.add(actual);
    const manifestPath = join(directory, 'package.json');
    if (!existsSync(manifestPath)) return;
    check(manifestPath, 'package manifest');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const name of Object.keys({ ...manifest.dependencies, ...(relative(root, actual).split(/[\\/]/).includes('node_modules') ? {} : manifest.devDependencies), ...manifest.optionalDependencies, ...manifest.peerDependencies })) {
      // Unused optional peers are not part of the installed runtime contract.
      // Actual TS/tool imports are still checked independently below.
      if (manifest.peerDependenciesMeta?.[name]?.optional && !manifest.dependencies?.[name] && !manifest.optionalDependencies?.[name]) continue;
      const target = packageAt(name, directory);
      if (target) inspectPackage(target);
      runtime(name, directory);
    }
    scanModules(join(directory, 'node_modules'));
  };
  const scanned = new Set<string>();
  const scanModules = (directory: string) => {
    if (!existsSync(directory) || !check(directory, 'node_modules location')) return;
    const actual = realpathSync(directory);
    if (scanned.has(actual)) return;
    scanned.add(actual);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.name.startsWith('@')) {
        if (!check(path, 'package scope')) continue;
        for (const child of readdirSync(path)) inspectPackage(join(path, child));
      } else if (entry.isDirectory() || entry.isSymbolicLink()) inspectPackage(path);
    }
  };
  inspectPackage(root);
  for (const group of ['packages', 'apps']) {
    if (!existsSync(join(root, group))) continue;
    for (const entry of readdirSync(join(root, group))) {
      const directory = join(root, group, entry);
      if (existsSync(join(directory, 'package.json')) && entry !== 'online-docs') inspectPackage(directory);
    }
  }
  for (const config of configs) {
    const path = resolve(root, config);
    check(path, 'TypeScript config');
    const read = ts.readConfigFile(path, ts.sys.readFile);
    if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(path), undefined, path);
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    for (const source of program.getSourceFiles()) check(source.fileName, `TypeScript ${config}`);
  }
  // Scripts and Vite config are not necessarily included in workspace tsconfigs.
  const tooling = existsSync(join(root, 'scripts')) ? readdirSync(join(root, 'scripts')).filter(name => /\.[cm]?[jt]s$/.test(name)).map(name => join(root, 'scripts', name)) : [];
  for (const name of ['vite.config.ts', 'electron.vite.config.ts']) {
    const path = join(root, 'apps/electron', name);
    if (existsSync(path)) tooling.push(path);
  }
  for (const path of tooling) {
    check(path, 'build tooling');
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) runtime(node.moduleSpecifier.text, dirname(path));
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) runtime(node.arguments[0].text, dirname(path));
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...failures].sort();
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  const configs = ['packages/core', 'packages/shared', 'packages/entitlement-service', 'packages/server-core', 'packages/server', 'packages/session-tools-core', 'packages/pi-agent-server', 'packages/ui', 'apps/electron'].map(path => `${path}/tsconfig.json`);
  const failures = checkDependencyContainment(root, configs);
  if (failures.length) { console.error(`Dependencies escape this checkout:\n${failures.join('\n')}`); process.exitCode = 1; }
  else console.log('Dependency containment passed (TypeScript, installed manifests, runtime entries, literal build-tool imports). Computed imports/platform variants are outside this check.');
}
