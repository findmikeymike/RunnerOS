import * as React from 'react'
import { cn } from '@/lib/utils'

const DEFAULT_COLLECTION = 'Loose Singles'
const NEW_COLLECTION_VALUE = '__new_collection__'

interface LabCollectionPickerProps {
  value: string
  collections: string[]
  onChange: (value: string) => void
  compact?: boolean
  className?: string
}

export function LabCollectionPicker({
  value,
  collections,
  onChange,
  compact = false,
  className,
}: LabCollectionPickerProps) {
  const [creatingNew, setCreatingNew] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const options = React.useMemo(() => {
    const seen = new Set<string>()
    return [DEFAULT_COLLECTION, ...collections, value]
      .map((collection) => collection.trim())
      .filter((collection) => {
        if (!collection) return false
        const key = collection.toLocaleLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }, [collections, value])
  const selectedValue = options.find(
    (collection) => collection.toLocaleLowerCase() === value.trim().toLocaleLowerCase(),
  ) || DEFAULT_COLLECTION

  const finishNewCollection = React.useCallback(() => {
    const next = draft.trim()
    const existing = options.find((collection) => collection.toLocaleLowerCase() === next.toLocaleLowerCase())
    onChange(existing || next || DEFAULT_COLLECTION)
    setCreatingNew(false)
  }, [draft, onChange, options])

  if (creatingNew) {
    return (
      <input
        autoFocus
        aria-label="New collection name"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={finishNewCollection}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            finishNewCollection()
          }
        }}
        placeholder="Name collection"
        className={cn(
          compact
            ? 'h-7 w-28 border-0 bg-transparent text-xs text-white/68 outline-none placeholder:text-white/28'
            : 'h-10 w-full rounded-lg border border-[#fb923c]/30 bg-white/[0.045] px-3 text-sm text-white/86 outline-none placeholder:text-white/28',
          className,
        )}
      />
    )
  }

  return (
    <select
      aria-label="Collection"
      value={selectedValue}
      onChange={(event) => {
        if (event.target.value === NEW_COLLECTION_VALUE) {
          setDraft('')
          setCreatingNew(true)
          return
        }
        onChange(event.target.value)
      }}
      className={cn(
        compact
          ? 'h-7 w-28 border-0 bg-transparent text-xs text-white/62 outline-none'
          : 'h-10 w-full rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 text-sm text-white/78 outline-none focus:border-[#fb923c]/40',
        className,
      )}
    >
      {options.map((collection) => (
        <option key={collection} value={collection}>{collection}</option>
      ))}
      <option value={NEW_COLLECTION_VALUE}>New collection...</option>
    </select>
  )
}
