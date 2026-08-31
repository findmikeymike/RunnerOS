export type ArtistGuideTabId = 'general' | 'hq' | 'campaigns'

export type ArtistGuideWorkspaceKind = 'general' | 'hq' | 'campaign' | 'lab'

export type ArtistGuideActionId =
  | 'settings.ai'
  | 'settings.connections'
  | 'settings.social-accounts'
  | 'settings.spotify'
  | 'settings.ad-accounts'
  | 'settings.permissions'
  | 'hq.home'
  | 'hq.people'
  | 'hq.profile'
  | 'hq.voice'
  | 'hq.research'
  | 'hq.branding'
  | 'hq.vault'
  | 'campaign.home'
  | 'campaign.plan'
  | 'campaign.essentials'
  | 'campaign.release-kit'
  | 'workspace.workers'
  | 'workspace.workflows'
  | 'workspace.automations'
  | 'workspace.command'
  | 'app.outputs'
  | 'lab.home'

export type ArtistGuideIconId =
  | 'ai'
  | 'connection'
  | 'accounts'
  | 'safety'
  | 'brain'
  | 'command'
  | 'workers'
  | 'workflow'
  | 'automation'
  | 'outputs'
  | 'lab'
  | 'hq'
  | 'people'
  | 'campaign'
  | 'calendar'
  | 'essentials'
  | 'release-kit'

export type ArtistGuideAction = {
  id: ArtistGuideActionId
  label: string
}

export type ArtistGuideItem = {
  id: string
  title: string
  body: string
  icon?: ArtistGuideIconId
  actions?: ArtistGuideAction[]
  readiness?: 'ai'
}

export type ArtistGuideTabContent = {
  id: ArtistGuideTabId
  label: string
  intro: string
  start: ArtistGuideItem[]
  destinations: ArtistGuideItem[]
  concepts: ArtistGuideItem[]
  conceptsLabel: string
}

export type ArtistGuideAiReadiness = 'ready' | 'needs-setup' | 'check-setup'

export function defaultArtistGuideTab(kind: ArtistGuideWorkspaceKind): ArtistGuideTabId {
  if (kind === 'hq') return 'hq'
  if (kind === 'campaign') return 'campaigns'
  return 'general'
}

export function deriveArtistGuideAiReadiness(
  connections: ReadonlyArray<{ isAuthenticated: boolean }> | undefined,
): ArtistGuideAiReadiness {
  if (!connections || connections.length === 0) return 'needs-setup'
  return connections.some((connection) => connection.isAuthenticated) ? 'ready' : 'check-setup'
}

export const ARTIST_GUIDE_TABS: ArtistGuideTabContent[] = [
  {
    id: 'general',
    label: 'General',
    intro: 'Connect the essentials, learn the few core building blocks, and start useful work.',
    start: [
      {
        id: 'setup-ai',
        title: 'Connect an AI model',
        body: 'Add a provider, verify it, and choose the model your agents should use.',
        icon: 'ai',
        readiness: 'ai',
        actions: [{ id: 'settings.ai', label: 'Open AI' }],
      },
      {
        id: 'setup-connections',
        title: 'Connect the services you use',
        body: 'Connections unlock specific tools. You do not need to connect every service.',
        icon: 'connection',
        actions: [{ id: 'settings.connections', label: 'Open Connections' }],
      },
      {
        id: 'setup-accounts',
        title: 'Connect artist accounts',
        body: 'Add the social, Spotify, or advertising accounts your work depends on.',
        icon: 'accounts',
        actions: [
          { id: 'settings.social-accounts', label: 'Social' },
          { id: 'settings.spotify', label: 'Spotify' },
          { id: 'settings.ad-accounts', label: 'Ads' },
        ],
      },
      {
        id: 'setup-permissions',
        title: 'Choose your safety boundaries',
        body: 'Drafting can stay low-risk. Public posts, sends, spending, and destructive actions follow your approval rules.',
        icon: 'safety',
        actions: [{ id: 'settings.permissions', label: 'Open Permissions' }],
      },
      {
        id: 'setup-artist-truth',
        title: 'Give agents the artist truth',
        body: 'Profile, Voice, and Branding tell every campaign who the artist is and how they should sound.',
        icon: 'brain',
        actions: [
          { id: 'hq.profile', label: 'Profile' },
          { id: 'hq.voice', label: 'Voice' },
          { id: 'hq.branding', label: 'Branding' },
        ],
      },
    ],
    destinations: [
      {
        id: 'general-command',
        title: 'Command',
        body: 'Talk to the manager, ask what to do next, or begin a job.',
        icon: 'command',
        actions: [{ id: 'workspace.command', label: 'Open' }],
      },
      {
        id: 'general-workers',
        title: 'Workers',
        body: 'Browse specialists. Selecting one starts a chat with that worker.',
        icon: 'workers',
        actions: [{ id: 'workspace.workers', label: 'Open' }],
      },
      {
        id: 'general-workflows',
        title: 'Workflows',
        body: 'Run a repeatable multi-step process.',
        icon: 'workflow',
        actions: [{ id: 'workspace.workflows', label: 'Open' }],
      },
      {
        id: 'general-automations',
        title: 'Automations',
        body: 'Trigger or schedule work that should repeat.',
        icon: 'automation',
        actions: [{ id: 'workspace.automations', label: 'Open' }],
      },
      {
        id: 'general-outputs',
        title: 'Outputs',
        body: 'Find durable work produced by agents and workflows.',
        icon: 'outputs',
        actions: [{ id: 'app.outputs', label: 'Open' }],
      },
      {
        id: 'general-lab',
        title: 'Creative Lab',
        body: 'Develop songs and projects before they become campaign work.',
        icon: 'lab',
        actions: [{ id: 'lab.home', label: 'Open' }],
      },
    ],
    conceptsLabel: 'Know the difference',
    concepts: [
      {
        id: 'concept-work-types',
        title: 'Worker, Workflow, or Automation?',
        body: 'A Worker is a specialist you talk to. A Workflow is a saved sequence. An Automation decides when repeatable work runs.',
      },
      {
        id: 'concept-work-location',
        title: 'Where did my work go?',
        body: 'Chats preserve the conversation. Outputs hold durable deliverables. Approved campaign assets belong in that campaign’s Release Kit.',
      },
      {
        id: 'concept-connections',
        title: 'What does connecting a tool allow?',
        body: 'It makes the capability available. Permission and approval rules still control external actions.',
      },
      {
        id: 'concept-goal',
        title: 'What is Goal Mode?',
        body: 'A bounded long-running objective inside one chat. External and public actions still obey approval rules.',
      },
    ],
  },
  {
    id: 'hq',
    label: 'HQ',
    intro: 'Build the reusable artist brain, see the bigger picture, and manage work across releases.',
    start: [
      {
        id: 'hq-start-profile',
        title: 'Complete Profile',
        body: 'Add the artist identity, positioning, audience, and current priorities.',
        icon: 'brain',
        actions: [{ id: 'hq.profile', label: 'Open Profile' }],
      },
      {
        id: 'hq-start-voice',
        title: 'Define Voice',
        body: 'Give agents a clear feel for how the artist should sound.',
        icon: 'command',
        actions: [{ id: 'hq.voice', label: 'Open Voice' }],
      },
      {
        id: 'hq-start-brand',
        title: 'Add Branding and Intel',
        body: 'Store the reusable creative world and research agents should know.',
        icon: 'brain',
        actions: [
          { id: 'hq.branding', label: 'Branding' },
          { id: 'hq.research', label: 'Intel Docs' },
        ],
      },
      {
        id: 'hq-start-people',
        title: 'Add important people',
        body: 'Keep collaborators, press, partners, and useful relationships in one place.',
        icon: 'people',
        actions: [{ id: 'hq.people', label: 'Open People' }],
      },
      {
        id: 'hq-start-signals',
        title: 'Connect live signals',
        body: 'Spotify, social, and intel features need their related connections before they can run.',
        icon: 'connection',
        actions: [
          { id: 'settings.spotify', label: 'Spotify' },
          { id: 'settings.social-accounts', label: 'Social' },
          { id: 'settings.connections', label: 'Research tools' },
        ],
      },
      {
        id: 'hq-start-campaign',
        title: 'Move release work into a Campaign',
        body: 'Once work belongs to one release, its dates, jobs, and approved assets should live in that Campaign.',
        icon: 'campaign',
        actions: [{ id: 'campaign.home', label: 'Open Campaign' }],
      },
    ],
    destinations: [
      {
        id: 'hq-destination-home',
        title: 'HQ',
        body: 'See next moves, release horizon, signals, and active work.',
        icon: 'hq',
        actions: [{ id: 'hq.home', label: 'Open' }],
      },
      {
        id: 'hq-destination-people',
        title: 'People',
        body: 'Manage the artist’s working relationships and community.',
        icon: 'people',
        actions: [{ id: 'hq.people', label: 'Open' }],
      },
      {
        id: 'hq-destination-work',
        title: 'Work',
        body: 'Use artist-wide specialists, repeatable processes, and ongoing automations.',
        icon: 'workers',
        actions: [
          { id: 'workspace.workers', label: 'Workers' },
          { id: 'workspace.workflows', label: 'Workflows' },
          { id: 'workspace.automations', label: 'Automations' },
        ],
      },
      {
        id: 'hq-destination-command',
        title: 'Command',
        body: 'Ask the HQ manager to route work, answer questions, or delegate.',
        icon: 'command',
        actions: [{ id: 'workspace.command', label: 'Open' }],
      },
      {
        id: 'hq-destination-brain',
        title: 'Brain',
        body: 'Profile, Voice, Intel Docs, Branding, and Vault are the reusable artist truth.',
        icon: 'brain',
        actions: [
          { id: 'hq.profile', label: 'Profile' },
          { id: 'hq.vault', label: 'Vault' },
        ],
      },
    ],
    conceptsLabel: 'How HQ works',
    concepts: [
      {
        id: 'hq-concept-split',
        title: 'HQ versus Campaign',
        body: 'HQ holds reusable artist identity, relationships, direction, and shared assets. A Campaign holds one release’s execution.',
      },
      {
        id: 'hq-concept-pulses',
        title: 'Pulse panels',
        body: 'Spotify, social, and intel panels need their connections. Starting a Pulse begins work; it does not mean the result is complete.',
      },
      {
        id: 'hq-concept-vault',
        title: 'Vault',
        body: 'Vault stores reusable artist assets and references. It is not the same as a campaign Release Kit.',
      },
      {
        id: 'hq-concept-horizon',
        title: 'Release horizon',
        body: 'HQ gives the strategic view of current and upcoming releases. Detailed day-to-day scheduling belongs inside each Campaign.',
      },
    ],
  },
  {
    id: 'campaigns',
    label: 'Campaigns',
    intro: 'Plan one release, finish what it needs, and keep approved assets safe and usable.',
    start: [
      {
        id: 'campaign-start-context',
        title: 'Set the release context and date',
        body: 'The release date powers the countdown and helps the campaign surface what matters next.',
        icon: 'campaign',
        actions: [{ id: 'campaign.home', label: 'Open Campaign' }],
      },
      {
        id: 'campaign-start-overview',
        title: 'Check the overview',
        body: 'See days to release, the team, active workers, and approvals at a glance.',
        icon: 'hq',
        actions: [{ id: 'campaign.home', label: 'Open Overview' }],
      },
      {
        id: 'campaign-start-plan',
        title: 'Build the Plan',
        body: 'Add operational dates, events, agent jobs, and scheduled work.',
        icon: 'calendar',
        actions: [{ id: 'campaign.plan', label: 'Open Plan' }],
      },
      {
        id: 'campaign-start-essentials',
        title: 'Finish Essentials',
        body: 'Use the release checklist and cue the right worker from unfinished items.',
        icon: 'essentials',
        actions: [{ id: 'campaign.essentials', label: 'Open Essentials' }],
      },
      {
        id: 'campaign-start-kit',
        title: 'Approve finished assets',
        body: 'Release Kit is the trusted source for approved audio, Single Art, videos, images, and plans.',
        icon: 'release-kit',
        actions: [{ id: 'campaign.release-kit', label: 'Open Release Kit' }],
      },
      {
        id: 'campaign-start-attention',
        title: 'Watch approvals and attention states',
        body: 'Review sensitive actions, failed jobs, and work that needs a decision before calling it finished.',
        icon: 'safety',
        actions: [{ id: 'campaign.home', label: 'Review Campaign' }],
      },
    ],
    destinations: [
      {
        id: 'campaign-destination-home',
        title: 'Campaign',
        body: 'Compact release overview: countdown, team, active workers, and approvals.',
        icon: 'campaign',
        actions: [{ id: 'campaign.home', label: 'Open' }],
      },
      {
        id: 'campaign-destination-plan',
        title: 'Plan',
        body: 'Operational calendar for events, jobs, deadlines, and scheduled work.',
        icon: 'calendar',
        actions: [{ id: 'campaign.plan', label: 'Open' }],
      },
      {
        id: 'campaign-destination-essentials',
        title: 'Essentials',
        body: 'Unfinished release requirements and worker cues.',
        icon: 'essentials',
        actions: [{ id: 'campaign.essentials', label: 'Open' }],
      },
      {
        id: 'campaign-destination-kit',
        title: 'Release Kit',
        body: 'Approved campaign assets agents can trust and use.',
        icon: 'release-kit',
        actions: [{ id: 'campaign.release-kit', label: 'Open' }],
      },
      {
        id: 'campaign-destination-work',
        title: 'Work',
        body: 'Use specialists and repeatable processes with this campaign’s context.',
        icon: 'workers',
        actions: [
          { id: 'workspace.workers', label: 'Workers' },
          { id: 'workspace.workflows', label: 'Workflows' },
          { id: 'workspace.automations', label: 'Automations' },
        ],
      },
      {
        id: 'campaign-destination-command',
        title: 'Command',
        body: 'Talk to the campaign-aware manager.',
        icon: 'command',
        actions: [{ id: 'workspace.command', label: 'Open' }],
      },
    ],
    conceptsLabel: 'Plan and finish work',
    concepts: [
      {
        id: 'campaign-concept-calendar',
        title: 'Events and jobs',
        body: 'Use Add event for a date or reminder. Use Add job when an agent or workflow should perform scheduled work.',
      },
      {
        id: 'campaign-concept-attention',
        title: 'Attention states',
        body: 'Needs approval, Awaiting review, Failed, and Missed all mean the work still needs attention.',
      },
      {
        id: 'campaign-concept-assets',
        title: 'Essentials versus Release Kit',
        body: 'Essentials shows what is unfinished. Release Kit contains what has been explicitly approved as final.',
      },
      {
        id: 'campaign-concept-execution',
        title: 'Sensitive execution',
        body: 'Posting, outreach, spending, and other external work must show the exact account, content, timing, and required authorization.',
      },
    ],
  },
]

