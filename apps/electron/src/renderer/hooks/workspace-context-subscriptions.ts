type Refresher = (ensureFresh?: boolean) => Promise<void>

/** Freshness expires when nobody is observing the workspace's change events. */
export class WorkspaceContextSubscriptions {
  private readonly loaded = new Set<string>()
  private readonly refreshers = new Map<string, Set<Refresher>>()

  hasLoaded(key: string): boolean { return this.loaded.has(key) }
  markLoaded(key: string): void {
    // An in-flight read may finish after its final consumer has left.
    if (this.refreshers.has(key)) this.loaded.add(key)
  }
  subscribe(key: string, refresh: Refresher): () => void {
    const entries = this.refreshers.get(key) ?? new Set<Refresher>()
    const firstConsumer = entries.size === 0
    entries.add(refresh)
    this.refreshers.set(key, entries)
    // A prior subscription's request may still be in flight. Force invalidation
    // so it cannot publish stale data into this newly observed epoch.
    if (firstConsumer) void refresh(true)
    return () => {
      entries.delete(refresh)
      if (entries.size === 0) {
        this.refreshers.delete(key)
        this.loaded.delete(key)
      }
    }
  }
  refreshChanged(key: string): void {
    const refresh = this.refreshers.get(key)?.values().next().value
    if (refresh) void refresh(true)
    else this.loaded.delete(key)
  }
}
