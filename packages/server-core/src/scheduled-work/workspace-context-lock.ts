const workspaceMutexes = new Map<string, Promise<void>>()

export function withWorkspaceContextLock<T>(workspaceRootPath: string, fn: () => Promise<T>): Promise<T> {
  const previous = workspaceMutexes.get(workspaceRootPath) ?? Promise.resolve()
  const next = previous.then(fn, fn)
  workspaceMutexes.set(workspaceRootPath, next.then(() => {}, () => {}))
  return next
}
