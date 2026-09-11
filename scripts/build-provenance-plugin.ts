import { readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { transform, type Plugin } from 'esbuild'
import { createBuildProvenance } from './build-provenance'

/** Recompute on every watch rebuild, rather than freezing the watcher startup stamp. */
export function buildProvenancePlugin(rootDir: string, component: 'main' | 'preload'): Plugin {
  const modulePath = realpathSync(resolve(rootDir, 'packages/shared/src/build-info.ts'))
  return {
    name: 'loaded-build-provenance',
    setup(build) {
      build.onLoad({ filter: /[\\/]build-info\.ts$/ }, async ({ path }) => {
        if (realpathSync(path) !== modulePath) return
        const source = await readFile(path, 'utf8')
        const compiled = await transform(source, { loader: 'ts', format: 'esm' })
        const info = createBuildProvenance({ rootDir, component })
        return { contents: `const __ARTIST_OS_BUILD_INFO__ = ${JSON.stringify(info)};\n${compiled.code}`, loader: 'js', watchFiles: [path] }
      })
    },
  }
}
