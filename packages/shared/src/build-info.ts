/** Build-time identity of a loaded component. Never inferred from the checkout. */
export interface BuildInfo {
  component: 'main' | 'preload' | 'renderer'
  commit: string | null
  sourceHash: string
  dirty: boolean
  builtAt: string
  product: string
}

declare const __ARTIST_OS_BUILD_INFO__: BuildInfo | undefined

export function getEmbeddedBuildInfo(): BuildInfo | null {
  return typeof __ARTIST_OS_BUILD_INFO__ === 'undefined' ? null : __ARTIST_OS_BUILD_INFO__ ?? null
}

export interface DesktopBuildInfo {
  main: BuildInfo | null
  preload: BuildInfo | null
  isPackaged: boolean | null
}

export function describeBuildAgreement(components: Array<BuildInfo | null>): string {
  const known = components.filter((value): value is BuildInfo => value !== null)
  if (new Set(known.map(value => `${value.product}:${value.commit}:${value.sourceHash}:${value.dirty}`)).size > 1) {
    return 'Loaded components have different source identities.'
  }
  if (known.length !== components.length || known.length === 0) return 'Some component build details are unavailable.'
  return 'Loaded components share the same source identity.'
}
