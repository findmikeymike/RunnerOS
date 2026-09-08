import type { AgentDefinitionDTO } from '../../../shared/types'

/** Plain selection for saved jobs; unlike chat cards this never starts a conversation. */
export function AgentTaskModeSelect({ agent, value, onChange }: {
  agent: Pick<AgentDefinitionDTO, 'slug' | 'metadata'>
  value?: string
  onChange: (value: string | undefined) => void
}) {
  const modes = agent.metadata.taskModes ?? []
  if (!modes.length) return null
  const optional = agent.slug === 'concierge' || modes.length < 2
  return <label className="block space-y-1.5">
    <span className="text-[11px] font-medium text-white/48">Focus{optional ? ' (optional)' : ''}</span>
    <select aria-label={`Focus for ${agent.metadata.name}`} className="h-10 w-full rounded-[8px] border border-white/[0.08] bg-[#202225] px-3 text-[13px] text-white outline-none focus:border-orange-400/35" value={value ?? ''} onChange={event => onChange(event.target.value || undefined)}>
      <option value="">{optional ? 'No preset focus' : 'Choose a focus'}</option>
      {value && !modes.some(mode => mode.id === value) && <option value={value}>Unavailable focus — choose another</option>}
      {modes.map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
    </select>
    {modes.find(mode => mode.id === value)?.description && <span className="block text-[11px] leading-4 text-white/42">{modes.find(mode => mode.id === value)?.description}</span>}
  </label>
}
