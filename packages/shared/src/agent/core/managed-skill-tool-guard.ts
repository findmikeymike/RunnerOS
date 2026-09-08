import { RUNTIME_IDENTITY } from '../../config/runtime-identity.ts';
import bashParser from 'bash-parser';
import { existsSync, statSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { getManagedSkillsRoot, isManagedSkillPath, resolveManagedSkillPath } from '../../skills/managed.ts';
import { expandPath } from '../../utils/paths.ts';
import { isPrivateSkillRuntimePath } from './managed-skill-runtime.ts';

export const PRIVATE_SKILL_BLOCK = 'Built-in instructions are private. Use use_skill or read_skill_reference for guidance; personal instructions can customize behavior without reading or changing the built-in recipe.';
type ShellNode = { type: string; text?: string; name?: ShellNode; suffix?: ShellNode[]; prefix?: ShellNode[]; commands?: ShellNode[]; left?: ShellNode; right?: ShellNode; op?: unknown; expansion?: unknown; [key: string]: unknown };

export function checkManagedSkillToolAccess(toolName: string, input: Record<string, unknown>, cwd: string,
  classifyPinned?: (path: string) => { protected: true; helper: boolean } | null, containsPinned?: (path: string) => boolean): string | null {
  if (RUNTIME_IDENTITY.variant !== 'artist-os') return null;
  const classify = (value: string, directory = cwd) => {
    let path = resolve(directory, value.startsWith('~') ? expandPath(value) : value);
    try { if (existsSync(path)) path = realpathSync(path); } catch { /* missing targets retain lexical protection */ }
    const pinned = classifyPinned?.(path);
    return { path, protected: !!pinned || isManagedSkillPath(path) || isPrivateSkillRuntimePath(path),
      helper: pinned?.helper ?? resolveManagedSkillPath(path)?.kind === 'helper' };
  };
  const privateWord = (text: string, directory: string): boolean => {
    if (text.includes('=')) return privateWord(text.slice(text.indexOf('=') + 1), directory);
    if (!text || text.startsWith('--')) return false;
    if (!/[\/\\.]/.test(text) && !existsSync(resolve(directory, text.startsWith('~') ? expandPath(text) : text))) return false;
    return classify(text, directory).protected;
  };
  const containsPrivate = (node: unknown, directory: string): boolean => {
    if (!node || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some(item => containsPrivate(item, directory));
    const value = node as ShellNode;
    return (typeof value.text === 'string' && privateWord(value.text, directory))
      || Object.values(value).some(item => typeof item === 'object' && containsPrivate(item, directory));
  };
  const copiesPrivateParent = (node: unknown, directory: string): boolean => {
    if (!node || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some(item => copiesPrivateParent(item, directory));
    const command = node as ShellNode;
    if (command.type === 'Command' && /^(?:cp|rsync|ditto|tar|zip|find)$/.test(command.name?.text?.split('/').pop() ?? '')) {
      for (const word of command.suffix ?? []) {
        if (word.type !== 'Word' || !word.text || word.text.startsWith('-')) continue;
        const path = classify(word.text, directory).path;
        try { if (!statSync(path).isDirectory()) continue; } catch { continue; }
        const rel = relative(path, getManagedSkillsRoot());
        if (containsPinned?.(path) || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) return true;
      }
    }
    return Object.values(command).some(value => typeof value === 'object' && copiesPrivateParent(value, directory));
  };
  const simpleHelper = (node: ShellNode | undefined, directory: string): boolean => {
    if (!node || node.type !== 'Command' || node.async || node.prefix?.length) return false;
    const words = [node.name, ...(node.suffix ?? [])];
    if (words.some(word => !word || word.type !== 'Word' || word.expansion || typeof word.text !== 'string')) return false;
    const values = words.map(word => word!.text!);
    const helperIndex = /^(?:python(?:3(?:\.\d+)?)?|node|bun|bash|sh)$/.test(values[0]?.split('/').pop() ?? '') ? 1 : 0;
    if (!values[helperIndex] || !classify(values[helperIndex]!, directory).helper) return false;
    return values.every((value, index) => index === helperIndex || !privateWord(value, directory));
  };
  const name = toolName.toLowerCase();
  if (name === 'bash' || name === 'exec_command' || name === 'shell') {
    const command = String(input.command ?? input.cmd ?? '');
    try {
      const ast = bashParser(command) as ShellNode;
      if (copiesPrivateParent(ast, cwd)) return PRIVATE_SKILL_BLOCK;
      const only = ast.commands?.length === 1 ? ast.commands[0] : undefined;
      if (simpleHelper(only, cwd)) return null;
      if (only?.type === 'LogicalExpression' && only.op === 'and' && only.left?.type === 'Command') {
        const cd = only.left;
        if (cd.name?.text === 'cd' && !cd.prefix?.length && cd.suffix?.length === 1
          && cd.suffix[0]?.type === 'Word' && !cd.suffix[0].expansion && typeof cd.suffix[0].text === 'string') {
          const directory = classify(cd.suffix[0].text).path;
          if (simpleHelper(only.right, directory)) return null;
          if (containsPrivate(only.right, directory)) return PRIVATE_SKILL_BLOCK;
        }
      }
      return containsPrivate(ast, cwd) ? PRIVATE_SKILL_BLOCK : null;
    } catch {
      // Still reject obvious private paths when a shell construct cannot be parsed.
      return command.split(/[\s;|&<>"'`]+/).some(word => privateWord(word, cwd)) ? PRIVATE_SKILL_BLOCK : null;
    }
  }
  for (const key of ['file_path', 'path', 'paths', 'source', 'sourcePath', 'destination', 'destinationPath', 'target_file', 'filePath', 'directory']) {
    const value = input[key];
    const values = Array.isArray(value) ? value : [value];
    if (values.some(value => typeof value === 'string' && classify(value).protected)) return PRIVATE_SKILL_BLOCK;
  }
  return null;
}
