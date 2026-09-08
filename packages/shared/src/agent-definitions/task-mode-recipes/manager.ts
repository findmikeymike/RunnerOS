import type { AgentTaskModeDefinition } from '../types.ts'

const managerContext = ['hq-state-of-play', 'campaign-state-of-play']
const focus = (id: string, label: string, description: string, topics: string[], helpText: string, adjacentSkills: AgentTaskModeDefinition['adjacentSkills'] = []): AgentTaskModeDefinition => ({
  id, label, description, helpText, icon: 'compass', kind: 'focus',
  primarySkillSlugs: ['artist-manager-operating-system'],
  ...(adjacentSkills.length ? { adjacentSkills } : {}),
  context: { preloadTopics: managerContext, retrieveOnDemandTopics: topics, maxPreloadChars: 8_000 },
})

/** Optional management lenses. Specialist execution stays with the owning worker. */
export const MANAGER_TASK_MODES: AgentTaskModeDefinition[] = [
  focus('this-week', 'Today & This Week', 'Choose what matters next and make the week manageable.', ['Current priorities, open work and deadlines'], 'Use the current Manager Brief to choose the next useful move and resolve competing priorities.'),
  focus('current-release', 'Current Release', 'Keep your release ready, realistic, and moving forward.', ['Current campaign, Release Kit essentials, readiness and release timing'], 'Check the actual release essentials, identify blockers, and coordinate the right specialists.'),
  focus('brand', 'Build My Brand', 'Find the identity work that will make the biggest difference.', ['Artist identity summary, approved branding and audience fit'], 'Clarify the need, then hand off to the right Branding or Art focus with useful context.'),
  focus('content', 'Create Content', 'Turn your current goals into the right content work.', ['Current release intent, artist voice, ready assets and content gaps'], 'Choose the concept, writing, production, or publishing worker that owns the next step.'),
  focus('audience', 'Grow My Audience', 'Choose a practical way to reach and connect with more listeners.', ['Dated audience evidence, community, channel performance and campaign goals'], 'Separate evidence from assumptions, then coordinate research, content, outreach, or ads.'),
  focus('business', 'Business & Rights', 'Get clarity on the business work behind your music.', ['Relevant obligations, rights, credits, budget and decision evidence'], 'Organize the decision and route detailed rights, release, finance, or contract work to its owner.'),
  focus('build-automate', 'Build & Automate', 'Set up a worker, workflow, or recurring job around your needs.', ['Exact capability goal, current workers and existing tracked work'], 'Choose whether you need an agent, a multi-step workflow, or scheduled and triggered work.', [
    { slug: 'agent-creator', when: 'Create or revise a saved worker after the role is clear.', expansion: 'same-session' },
    { slug: 'workflow-creator', when: 'Build tracked work with distinct steps and owners.', expansion: 'same-session' },
    { slug: 'automation-creator', when: 'Schedule work or connect it to an explicit trigger.', expansion: 'same-session' },
    { slug: 'source-recipe', when: 'Choose a small connection bundle for the requested job.', expansion: 'same-session' },
  ]),
  focus('just-talk', 'Just Talk', 'Talk through what is on your mind and find a useful next step.', ['Only the context needed for the current question'], 'You can start here without choosing a project or knowing which worker you need.', [
    { slug: 'artist-os-guide', when: 'Explain where a feature lives or how to use it.', expansion: 'same-session' },
    { slug: 'agent-creator', when: 'The artist asks to create or revise a saved worker.', expansion: 'same-session' },
    { slug: 'workflow-creator', when: 'The artist asks for tracked work with distinct steps and owners.', expansion: 'same-session' },
    { slug: 'automation-creator', when: 'The artist asks to schedule work or connect an explicit trigger.', expansion: 'same-session' },
    { slug: 'skill-scout', when: 'An explicit capability gap needs a focused skill search.', expansion: 'same-session' },
    { slug: 'source-recipe', when: 'The requested job needs a small connection bundle.', expansion: 'same-session' },
    { slug: 'runneros-self-edit', when: 'The artist explicitly asks to change the app itself.', expansion: 'same-session' },
  ]),
]
