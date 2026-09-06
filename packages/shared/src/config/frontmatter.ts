import grayMatter from 'gray-matter';
import { dump, load } from 'js-yaml';

/**
 * Frontmatter parsing, with gray-matter's bundled YAML engine replaced.
 *
 * gray-matter pins `js-yaml` at `^3.13.1` and has never updated it. 4.0.3 is
 * its latest release, so there is no version to upgrade to. That v3 parser is
 * affected by GHSA-5p4m-2wfm-xmqj and GHSA-52cp-r559-cp3m: quadratic CPU
 * consumption on `!!omap` resolution and on YAML merge-key chains. Neither fix
 * was backported to the v3 line.
 *
 * That matters here because frontmatter is not developer-authored config. It
 * fronts agent memory, session logs, skills, workflows, agent definitions and
 * workspace context — files agents write from things they read, including web
 * pages. A few hundred bytes of adversarial YAML landing in a memory file would
 * hang the app on every subsequent read of it.
 *
 * A dependency override cannot fix this. Bun's overrides are flat, so forcing
 * js-yaml to a patched v3 would drag our own v4 usage back to an API that no
 * longer exists. Instead gray-matter gets an explicit engine backed by the
 * js-yaml 4 we already depend on. The vulnerable copy stays installed, because
 * gray-matter requires it at module load, but nothing routes through it.
 * `bun audit` will therefore keep listing js-yaml; that is expected.
 *
 * Equivalence was measured before switching rather than assumed. All 224
 * frontmatter blocks in this repo parse identically under both engines. So do
 * unquoted dates, RFC 3339 timestamps, anchors and aliases, merge keys, every
 * null and boolean spelling, octal and hex and exponent numbers, and block
 * scalars — and both reject duplicate keys. Serialisation is byte-identical on
 * the shapes we write, including Dates and embedded colons.
 *
 * `packages/session-tools-core/src/frontmatter.ts` is a copy of this. It has to
 * be: `shared` depends on `session-tools-core`, so the dependency cannot run the
 * other way, and neither package exports a subpath the other could import.
 * Change both together.
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
