#!/usr/bin/env bun
/**
 * Generates `packages/shared/src/skills/bundled.generated.ts` by walking the
 * `packages/shared/src/skills/bundled/` directory tree and inlining every file
 * as a UTF-8 string. The output is a TypeScript module exporting
 * `BUNDLED_STARTER_SKILLS: StarterSkill[]`.
 *
 * Run when the bundled markdown changes:
 *
 *   bun run generate:bundled-skills
 *
 * (or directly: `bun packages/shared/scripts/generate-bundled-skills.ts`)
 *
 * The generated file is committed so consumers don't need to run a build step.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { TRADE_GOD_BUNDLED_SKILL_SLUGS } from '../src/product-profile.ts';

const HERE = new URL('.', import.meta.url).pathname;
const BUNDLED_DIR = join(HERE, '..', 'src', 'skills', 'bundled');
const OUTPUT_FILE = join(HERE, '..', 'src', 'skills', 'bundled.generated.ts');

function walkFiles(root: string): string[] {
  const out: string[] = [];
  function recurse(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        recurse(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  recurse(root);
  return out;
}

function escapeForTemplateLiteral(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

interface SkillEntry {
  slug: string;
  files: { path: string; content: string }[];
}

function collectSkills(): { included: SkillEntry[]; excludedSlugs: string[] } {
  const skills: SkillEntry[] = [];
  const allDirEntries = readdirSync(BUNDLED_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const includedSlugs = new Set<string>(TRADE_GOD_BUNDLED_SKILL_SLUGS);
  const dirEntries = allDirEntries.filter(entry => includedSlugs.has(entry.name));

  for (const entry of dirEntries) {
    const slug = entry.name;
    const skillDir = join(BUNDLED_DIR, slug);
    const files = walkFiles(skillDir)
      .map(abs => ({
        path: toPosix(relative(skillDir, abs)),
        content: readFileSync(abs, 'utf-8'),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
    skills.push({ slug, files });
  }
  return {
    included: skills,
    excludedSlugs: allDirEntries
      .map(entry => entry.name)
      .filter(slug => !includedSlugs.has(slug)),
  };
}

function render(skills: SkillEntry[], excludedSlugs: string[]): string {
  const lines: string[] = [];
  lines.push('// AUTO-GENERATED — do not edit by hand. Run `bun run generate:bundled-skills` to update.');
  lines.push('// Source: packages/shared/src/skills/bundled/');
  lines.push('');
  lines.push("import type { StarterSkill } from './starter-templates.ts';");
  lines.push('');
  lines.push('export const BUNDLED_STARTER_SKILLS: StarterSkill[] = [');
  for (const skill of skills) {
    lines.push('  {');
    lines.push(`    slug: ${JSON.stringify(skill.slug)},`);
    lines.push('    files: [');
    for (const file of skill.files) {
      lines.push('      {');
      lines.push(`        path: ${JSON.stringify(file.path)},`);
      lines.push(`        content: \`${escapeForTemplateLiteral(file.content)}\`,`);
      lines.push('      },');
    }
    lines.push('    ],');
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');
  lines.push('export const TRADE_GOD_EXCLUDED_BUNDLED_SKILL_SLUGS = [');
  for (const slug of excludedSlugs) {
    lines.push(`  ${JSON.stringify(slug)},`);
  }
  lines.push('] as const;');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const { included: skills, excludedSlugs } = collectSkills();
  const output = render(skills, excludedSlugs);
  writeFileSync(OUTPUT_FILE, output, 'utf-8');
  const totalFiles = skills.reduce((acc, s) => acc + s.files.length, 0);
  const totalBytes = skills.reduce(
    (acc, s) => acc + s.files.reduce((a, f) => a + Buffer.byteLength(f.content, 'utf-8'), 0),
    0,
  );
  console.log(
    `Generated ${OUTPUT_FILE}: ${skills.length} skills, ${totalFiles} files, ${totalBytes} bytes`,
  );
}

main();
