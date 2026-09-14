/** Keep the original body for compare-and-swap while an external update conflicts. */
export function reconcileDocumentDraft<T>(
  baselineBody: string | null,
  incomingBody: string | null,
  draft: T,
  baseline: T,
  incoming: T,
): 'unchanged' | 'accept' | 'conflict' {
  if (baselineBody === incomingBody) return 'unchanged'
  const current = JSON.stringify(draft)
  return current !== JSON.stringify(baseline) && current !== JSON.stringify(incoming)
    ? 'conflict'
    : 'accept'
}
