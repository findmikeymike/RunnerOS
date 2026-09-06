import grayMatter from 'gray-matter';
import { dump, load } from 'js-yaml';

/**
 * Frontmatter parsing, with gray-matter's bundled YAML engine replaced.
 *
 * This is a copy of `packages/shared/src/config/frontmatter.ts`, and has to be:
 * `shared` depends on `session-tools-core`, so the import cannot run the other
 * way, and neither package exports a subpath the other could reach. Change both
 * together. The full reasoning lives in that file; the short version is that
 * gray-matter pins js-yaml 3, has no release that unpins it, and that parser
 * burns CPU quadratically on hostile merge keys and `!!omap` — reachable here
 * because agents write frontmatter from content they read.
 */
const OPTIONS = {
  engines: {
    yaml: {
      parse: (input: string): object => (load(input) ?? {}) as object,
      stringify: (data: object): string => dump(data),
    },
  },
} as const;

export type GrayMatterFile<I extends grayMatter.Input> = grayMatter.GrayMatterFile<I>;

/** Drop-in for `gray-matter`'s default export, minus the vulnerable engine. */
export function matter<I extends string>(input: I | { content: I }): GrayMatterFile<I> {
  return grayMatter(input, OPTIONS);
}

/** Drop-in for `matter.stringify`. */
export function stringifyFrontmatter(body: string, data: object): string {
  return grayMatter.stringify(body, data, OPTIONS);
}
