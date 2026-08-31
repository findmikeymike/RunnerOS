interface AgentCapabilityDisplay {
  title: string
  items: string[]
}

const LEGENDARY_MIND_LENSES = [
  { skill: 'creative-oracle', labels: ['Kurt Cobain', 'David Bowie', 'Kanye West'] },
  { skill: 'tom-ford', labels: ['Tom Ford'] },
  { skill: 'steve-jobs-perspective', labels: ['Steve Jobs'] },
  { skill: 'mrbeast-perspective', labels: ['MrBeast'] },
] as const

export function getAgentCapabilityDisplay(
  agentSlug: string,
  skillSlugs: readonly string[],
): AgentCapabilityDisplay {
  if (agentSlug !== 'persona-agent') {
    return { title: 'Skills', items: [...skillSlugs] }
  }

  const attached = new Set(skillSlugs)
  return {
    title: 'Persona lenses',
    items: LEGENDARY_MIND_LENSES.flatMap(({ skill, labels }) =>
      attached.has(skill) ? [...labels] : [],
    ),
  }
}
