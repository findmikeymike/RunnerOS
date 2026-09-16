import type { AgentTaskModeDefinition } from '../types.ts'

const creators = ['agent-creator', 'workflow-creator', 'automation-creator', 'skill-creator', 'builder-intel-review']
const supporting = [
  { slug: 'skill-recipe', when: 'Choose existing skill bundles for the requested reusable capability.', expansion: 'same-session' as const },
  { slug: 'skill-scout', when: 'A confirmed capability gap requires focused discovery of existing skills.', expansion: 'same-session' as const },
  { slug: 'source-recipe', when: 'Inspect the connections needed by this arrangement; secure setup stays with Assistant.', expansion: 'same-session' as const },
]
const focus = (id: string, label: string, description: string, primary: string[]): AgentTaskModeDefinition => ({
  id, label, description, icon: 'blocks', kind: primary.length > 1 ? 'bundle' : 'focus',
  primarySkillSlugs: primary,
  adjacentSkills: [
    ...creators.filter(slug => !primary.includes(slug)).map(slug => ({ slug, when: 'The requested arrangement requires this additional kind of saved definition.', expansion: 'same-session' as const })),
    ...supporting,
  ],
  context: {
    preloadTopics: [], maxPreloadChars: 4_000,
    retrieveOnDemandTopics: ['Current task and HQ/Campaign destination; relevant live capability summaries', 'Exact existing definitions, source readiness and known references before revision', 'Only task-relevant artist/campaign facts, Outputs or dated Signals evidence'],
  },
})

/** General is optional; the current request chooses the needed recipe on demand. */
export const BUILDER_TASK_MODES: AgentTaskModeDefinition[] = [
  focus('general', 'General', 'Describe what you want to make reusable; find the smallest useful arrangement.', []),
  focus('skills', 'Skills', 'Create or improve a useful custom skill for a worker.', ['skill-creator']),
  focus('intel-review', 'Intel', 'Find useful capabilities in recent intel, or decide nothing needs building.', ['builder-intel-review']),
  focus('agents', 'Agents', 'Create or revise a worker around a clear repeatable job.', ['agent-creator']),
  focus('workflows', 'Workflows', 'Create or revise a sequential workflow using existing workers.', ['workflow-creator']),
  focus('automations', 'Automations', 'Set up supported recurring or triggered work; inspect current tools before offering maintenance.', ['automation-creator']),
]
