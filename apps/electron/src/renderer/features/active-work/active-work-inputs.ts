export interface SupplyInputDefinition {
  name: string
  type: 'string' | 'number' | 'boolean'
}

export function coerceSupplyValues(
  inputNames: string[],
  definitions: SupplyInputDefinition[],
  rawValues: Record<string, string>,
): { values: Record<string, unknown> } | { error: string } {
  const definitionsByName = new Map(definitions.map((definition) => [definition.name, definition]))
  const values: Record<string, unknown> = {}
  for (const name of inputNames) {
    const raw = rawValues[name] ?? ''
    const type = definitionsByName.get(name)?.type ?? 'string'
    const label = name.replace(/_/g, ' ')
    if (!raw.trim()) return { error: `Add ${label}.` }
    if (type === 'number') {
      const value = Number(raw)
      if (!Number.isFinite(value)) return { error: `${label} must be a number.` }
      values[name] = value
    } else if (type === 'boolean') {
      if (raw !== 'true' && raw !== 'false') return { error: `Choose yes or no for ${label}.` }
      values[name] = raw === 'true'
    } else {
      values[name] = raw
    }
  }
  return { values }
}
