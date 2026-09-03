let automaticSchedulePlacementMutex: Promise<void> = Promise.resolve()

/** Serializes automatic slot selection and persistence across every creation door. */
export function withAutomaticSchedulePlacementLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = automaticSchedulePlacementMutex.then(fn, fn)
  automaticSchedulePlacementMutex = next.then(() => {}, () => {})
  return next
}
