export type ArtistGuideTabId = 'general' | 'hq' | 'campaigns' | 'creative-lab' | 'connections' | 'top-bar'

export type ArtistGuideWorkspaceKind = 'general' | 'hq' | 'campaign' | 'lab'

export type ArtistGuideActionId =
  | 'settings.ai'
  | 'settings.connections'
  | 'settings.social-accounts'
  | 'settings.spotify'
  | 'settings.ad-accounts'
  | 'settings.messaging'
  | 'settings.permissions'
  | 'settings.app'
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
  | 'app.tools'
  | 'app.skills'
  | 'workspace.context'
  | 'lab.home'
  | 'lab.pad'
  | 'lab.songs'
  | 'lab.projects'
  | 'lab.create'
  | 'lab.spark-bank'

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
  | 'song-pad'
  | 'songs'
  | 'projects'
  | 'spark'
  | 'tools'
  | 'skills'
  | 'context'
  | 'notifications'
  | 'settings'
  | 'guide'

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

export type ArtistGuideConnection = {
  id: string
  group: string
  title: string
  unlocks: string
  setup: string
  action: ArtistGuideAction
}

export type ArtistGuideAiReadiness = 'ready' | 'needs-setup' | 'check-setup'

export function defaultArtistGuideTab(kind: ArtistGuideWorkspaceKind): ArtistGuideTabId {
  if (kind === 'hq') return 'hq'
  if (kind === 'campaign') return 'campaigns'
  if (kind === 'lab') return 'creative-lab'
  return 'general'
}

export function deriveArtistGuideAiReadiness(
  connections: ReadonlyArray<{ isAuthenticated: boolean }> | undefined,
): ArtistGuideAiReadiness {
  if (!connections || connections.length === 0) return 'needs-setup'
  return connections.some((connection) => connection.isAuthenticated) ? 'ready' : 'check-setup'
}

export const ARTIST_GUIDE_PRIMARY_TAB_IDS: ArtistGuideTabId[] = ['general', 'hq', 'campaigns', 'creative-lab']
export const ARTIST_GUIDE_UTILITY_TAB_IDS: ArtistGuideTabId[] = ['connections', 'top-bar']

export const ARTIST_GUIDE_CONNECTIONS: ArtistGuideConnection[] = [
  {
    id: 'ai-providers', group: 'Core setup', title: 'AI providers',
    unlocks: 'Powers every agent. Mix GPT or Claude subscriptions with API providers for model choice, cost, and routing.',
    setup: 'Open AI, then sign in with a supported subscription or paste the provider key from its developer dashboard.',
    action: { id: 'settings.ai', label: 'Open AI' },
  },
  {
    id: 'google-workspace', group: 'Core setup', title: 'Google Workspace',
    unlocks: 'Calendar, Gmail, Drive, and People access for connected workers and workflows.',
    setup: 'Create Desktop OAuth credentials in Google Cloud, save the client ID and secret in Connections, then complete Google sign-in.',
    action: { id: 'settings.connections', label: 'Open Connections' },
  },
  {
    id: 'messaging', group: 'Core setup', title: 'Telegram + WhatsApp',
    unlocks: 'Routes messages into Artist OS sessions so agents can receive and respond through connected channels.',
    setup: 'Open Phone Channels. Telegram uses a BotFather token; WhatsApp connects through its guided sign-in flow.',
    action: { id: 'settings.messaging', label: 'Phone Channels' },
  },
  {
    id: 'social-accounts', group: 'Artist accounts', title: 'Instagram, TikTok, X + YouTube',
    unlocks: 'Gives approved social work an exact saved account and isolated browser login instead of guessing where to post.',
    setup: 'Open Social Accounts, add the artist profile, open its login, sign in, and click Verify Account.',
    action: { id: 'settings.social-accounts', label: 'Social Accounts' },
  },
  {
    id: 'spotify', group: 'Artist accounts', title: 'Spotify',
    unlocks: 'Lets Spotify workers inspect the artist account and use supported artist, ads, and analytics surfaces.',
    setup: 'Open Spotify, add a profile, choose the needed surface, sign in through the controlled browser, and verify it.',
    action: { id: 'settings.spotify', label: 'Spotify' },
  },
  {
    id: 'ad-dashboard-accounts', group: 'Artist accounts', title: 'Meta + Google Ads dashboards',
    unlocks: 'Gives Ad Runner an exact saved dashboard account for browser-based reporting and approved ad work.',
    setup: 'Open Ad Accounts, add Meta or Google Ads, open the dashboard login, sign in, then click Verify.',
    action: { id: 'settings.ad-accounts', label: 'Ad Accounts' },
  },
  {
    id: 'meta-ads', group: 'Promotion + research', title: 'Meta Ads API',
    unlocks: 'Account discovery, reporting, diagnostics, and supported campaign operations for Meta advertising.',
    setup: 'Generate a Marketing API token in Meta Graph API Explorer, then connect the Meta Ads service.',
    action: { id: 'settings.connections', label: 'Open Connections' },
  },
  {
    id: 'google-ads', group: 'Promotion + research', title: 'Google Ads API',
    unlocks: 'Account lookup, reports, diagnostics, and supported Google Ads campaign work.',
    setup: 'Follow Google Ads API setup for a developer token, OAuth credentials, and customer ID, then connect the service.',
    action: { id: 'settings.connections', label: 'Open Connections' },
  },
  {
    id: 'youtube-research', group: 'Promotion + research', title: 'YouTube Research',
    unlocks: 'Video, channel, transcript, comment, and research lookup for YouTube specialists.',
    setup: 'Zero handles this automatically when configured. Optionally add a YouTube Data API key for the direct free-quota route.',
    action: { id: 'settings.connections', label: 'Open Connections' },
  },
  {
    id: 'genius', group: 'Promotion + research', title: 'Genius',
    unlocks: 'Song, artist, album-art, annotation, and reference lookup for Creative Lab research.',
    setup: 'Create a Genius API Client, generate a Client Access Token, and save it under Genius.',
    action: { id: 'settings.connections', label: 'Open Connections' },
  },
  {
    id: 'trypost-provider', group: 'Promotion + research', title: 'TryPost',
    unlocks: 'Drafts, schedules, previews, and approval-gated publishing across TryPost-connected social accounts.',
    setup: 'Create a Personal Access Token in TryPost Settings → API Keys, then connect the TryPost source.',
    action: { id: 'settings.social-accounts', label: 'Social Accounts' },
  },
  {
    id: 'postiz-provider', group: 'Promotion + research', title: 'Postiz',
    unlocks: 'Drafts, schedules, and approval-gated publishing through connected Postiz channels.',
    setup: 'Create a key in Postiz Settings → Developers → Public API, then connect the Postiz source.',
    action: { id: 'settings.social-accounts', label: 'Social Accounts' },
  },
  {
    id: 'resend-email', group: 'Community + commerce', title: 'Community Email',
    unlocks: 'Lets Community send user-approved fan emails through Resend.',
    setup: 'Create a Resend API key, verify the sending domain in Resend, then save the key under Community Email.',
    action: { id: 'settings.connections', label: 'Open Connections' },
  },
  {
    id: 'shopify', group: 'Community + commerce', title: 'Shopify',
    unlocks: 'Store and product access for merch, catalog, and commerce specialists.',
    setup: 'Create a least-privilege Shopify custom app, then add its Admin API token and myshopify.com store domain.',
    action: { id: 'settings.connections', label: 'Open Connections' },
  },
  {
    id: 'printify', group: 'Community + commerce', title: 'Printify',
    unlocks: 'Product, mockup, and print-on-demand workflow access for merch specialists.',
    setup: 'Create a Printify Personal Access Token in your Printify account, then save it under Printify.',
    action: { id: 'settings.connections', label: 'Open Connections' },
  },
  {
    id: 'voice-audio', group: 'Creative providers', title: 'Voice + Audio',
    unlocks: 'Speech, voiceover, transcription, and audio intelligence through AssemblyAI, ElevenLabs, Fish Audio, or Inworld.',
    setup: 'Create keys in the provider dashboards you use, then add only those keys under Voice + Audio.',
    action: { id: 'settings.connections', label: 'Open Connections' },
  },
  {
    id: 'media-generation', group: 'Creative providers', title: 'Media Generation',
    unlocks: 'Image, video, avatar, and render generation through Fal, WaveSpeed, Replicate, HeyGen, MUAPI, or RunPod.',
    setup: 'Create keys in the chosen provider dashboards, save them here, then optionally set quality, speed, or cost priority.',
    action: { id: 'settings.connections', label: 'Open Connections' },
  },
  {
    id: 'avatar-video', group: 'Creative providers', title: 'Avatar Video',
    unlocks: 'Lets video workflows target approved HeyGen avatars and voices instead of selecting them blindly.',
    setup: 'Connect HeyGen first, then copy the approved avatar and voice IDs into Avatar Video.',
    action: { id: 'settings.connections', label: 'Open Connections' },
  },
  {
    id: 'developer-cloud', group: 'Advanced + automation', title: 'Developer + Cloud',
    unlocks: 'Optional GitHub, AWS, Stripe, npm, and Stitch access for technical workers and cloud workflows.',
    setup: 'Create least-privilege credentials in the relevant provider dashboard and save only the keys your work needs.',
    action: { id: 'settings.connections', label: 'Open Connections' },
  },
  {
    id: 'mcp-apps', group: 'Advanced + automation', title: 'MCP + Apps',
    unlocks: 'Adds external app tools and custom MCP or API capabilities beyond the built-in connection list.',
    setup: 'Add the available service key in Connections, or ask Command to connect a named MCP server or API.',
    action: { id: 'app.tools', label: 'Open Tools' },
  },
  {
    id: 'automation', group: 'Advanced + automation', title: 'Automation Webhooks',
    unlocks: 'Authenticated inbound triggers and outbound notifications for services such as GitHub, Stripe, and Slack.',
    setup: 'Create the webhook secret or URL in the sending service, then save its matching value under Automation Webhooks.',
    action: { id: 'settings.connections', label: 'Open Connections' },
  },
  {
    id: 'zero', group: 'Advanced + automation', title: 'Zero CLI',
    unlocks: 'Allows agents to call supported paid external services through a funded Zero wallet.',
    setup: 'Set up and fund a Zero CLI wallet, then store its private key under Zero CLI.',
    action: { id: 'settings.connections', label: 'Open Connections' },
  },
]

export const ARTIST_GUIDE_TABS: ArtistGuideTabContent[] = [
  {
    id: 'general',
    label: 'General',
    intro: 'Connect the essentials, learn the few core building blocks, and start useful work.',
    start: [
      {
        id: 'setup-ai',
        title: 'Connect an AI model',
        body: 'Use a GPT or Claude subscription, or connect multiple providers so agents can route stronger models to planning and cheaper models to simple execution.',
        icon: 'ai',
        readiness: 'ai',
        actions: [{ id: 'settings.ai', label: 'Open AI' }],
      },
      {
        id: 'setup-connections',
        title: 'Connect the services you use',
        body: 'Connections unlock specific tools, and some specialists rely on them to do things—not just give advice. You do not need to connect every service.',
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
        body: 'Go to Brain to establish Profile, Voice, and Branding so agents understand you as an artist. Add music, photos, and reusable assets to Vault so agents can use them when appropriate.',
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
        id: 'general-active-work',
        title: 'Active',
        body: 'See what is running, coming next, repeating, or waiting for you. Set work up manually or ask Artist Manager.',
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
        body: 'A Worker is a specialist you talk to. A Workflow is a chain of specialists acting in sequence for long, complex work. An Automation decides when repeatable work runs.',
      },
      {
        id: 'concept-automation-inputs',
        title: 'What does an automation need?',
        body: 'Use Same every time for information that stays fixed. Use Ask me each time when the value changes between runs; the work waits under Needs you until you supply it.',
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
        body: 'A bounded long-running objective inside one agent chat. Type /goal followed by the objective—or $goal followed by the objective—then review it and press Start Goal. External and public actions still obey approval rules.',
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
          { id: 'hq.research', label: 'Signals' },
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
          { id: 'workspace.automations', label: 'Active' },
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
        body: 'Profile, Voice, Branding, and Vault hold the reusable artist truth. Signals tracks outside intelligence.',
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
        body: 'HQ is where you handle the big picture: artist-wide direction, long-term planning, relationships, and shared knowledge. A Campaign is the day-to-day home for one individual release—its dates, jobs, team, approvals, and assets.',
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
          { id: 'workspace.automations', label: 'Active' },
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
        body: 'Go to Plan → Calendar. Use Add event for a date or reminder; use Add job when an agent or workflow should perform scheduled work.',
      },
      {
        id: 'campaign-concept-attention',
        title: 'Attention states',
        body: 'Needs approval, Awaiting review, Failed, and Missed all mean the work still needs attention.',
      },
      {
        id: 'campaign-concept-assets',
        title: 'Essentials versus Release Kit',
        body: 'Essentials shows the core things a great release needs. Click the play icon beside an item to cue the exact specialist who can help. Release Kit holds the final assets that go out into the world—the song master, Single Art, images, videos, and other approved release materials.',
      },
      {
        id: 'campaign-concept-execution',
        title: 'Sensitive execution',
        body: 'Posting, outreach, spending, and other external work must show the exact account, content, timing, and required authorization.',
      },
    ],
  },
  {
    id: 'creative-lab',
    label: 'Creative Lab',
    intro: 'Write lyrics, develop ideas, and intelligently save and plan every song in one creative workspace.',
    start: [
      {
        id: 'lab-start-pad',
        title: 'Start writing in Song Pad',
        body: 'Craft lyrics in a focused writing space with rhymes, line alternatives, and specialist help close at hand.',
        icon: 'song-pad',
        actions: [{ id: 'lab.pad', label: 'Open Song Pad' }],
      },
      {
        id: 'lab-start-songs',
        title: 'Document every song',
        body: 'Keep every finished song and work in progress organized instead of losing drafts across notes and chats.',
        icon: 'songs',
        actions: [{ id: 'lab.songs', label: 'Open Songs' }],
      },
      {
        id: 'lab-start-projects',
        title: 'Shape songs into projects',
        body: 'Sequence songs as a playlist, album, EP, or other project so you can see how the body of work flows.',
        icon: 'projects',
        actions: [{ id: 'lab.projects', label: 'Open Projects' }],
      },
      {
        id: 'lab-start-create',
        title: 'Work with specialists',
        body: 'Discuss songs, strengthen lyrics, explore enhancements, and research ideas with the right specialist agents.',
        icon: 'workers',
        actions: [{ id: 'lab.create', label: 'Open Work' }],
      },
      {
        id: 'lab-start-spark',
        title: 'Catch ideas before they disappear',
        body: 'Use the diamond button to save any lyric, title, concept, or fragment to Spark Bank from anywhere in the Lab.',
        icon: 'spark',
        actions: [{ id: 'lab.spark-bank', label: 'Open Spark Bank' }],
      },
    ],
    destinations: [
      {
        id: 'lab-destination-home',
        title: 'Creative Lab',
        body: 'See recent songs, active ideas, and the main ways to begin creating.',
        icon: 'lab',
        actions: [{ id: 'lab.home', label: 'Open' }],
      },
      {
        id: 'lab-destination-pad',
        title: 'Song Pad',
        body: 'The powerful writing pad for lyrics, rhymes, alternate lines, and song-focused help.',
        icon: 'song-pad',
        actions: [{ id: 'lab.pad', label: 'Open' }],
      },
      {
        id: 'lab-destination-songs',
        title: 'Songs',
        body: 'The complete record of songs you have written or are still developing.',
        icon: 'songs',
        actions: [{ id: 'lab.songs', label: 'Open' }],
      },
      {
        id: 'lab-destination-projects',
        title: 'Projects',
        body: 'Sequence songs and view them as a playlist, album list, EP, or another collection.',
        icon: 'projects',
        actions: [{ id: 'lab.projects', label: 'Open' }],
      },
      {
        id: 'lab-destination-create',
        title: 'Work',
        body: 'Work with specialist agents on lyrics, song improvements, references, and research.',
        icon: 'workers',
        actions: [{ id: 'lab.create', label: 'Open' }],
      },
      {
        id: 'lab-destination-sparks',
        title: 'Spark Bank',
        body: 'Find, filter, tag, and reuse the strong fragments you captured along the way.',
        icon: 'spark',
        actions: [{ id: 'lab.spark-bank', label: 'Open' }],
      },
    ],
    conceptsLabel: 'Use Song Pad well',
    concepts: [
      {
        id: 'lab-concept-rhymes',
        title: 'Find rhymes without leaving the lyric',
        body: 'Highlight the last word of a line to see rhyme options while keeping your place in the song.',
      },
      {
        id: 'lab-concept-alternates',
        title: 'Keep alternate lines beside the original',
        body: 'Click a written line to store alternate versions right at that line instead of collecting them at the bottom of the pad.',
      },
      {
        id: 'lab-concept-specialists',
        title: 'Bring in a specialist when useful',
        body: 'Ask an agent to review a lyric, strengthen a weak section, research references, or help explore a direction without replacing your draft.',
      },
      {
        id: 'lab-concept-sparks',
        title: 'Spark Bank travels with the Lab',
        body: 'The diamond button stays available throughout Creative Lab, so a line, title, image, or concept can be captured the moment it arrives.',
      },
    ],
  },
  {
    id: 'connections',
    label: 'Connections',
    intro: 'Connect only the services you use. A connection gives agents tools; permissions and approvals still control what they may do.',
    start: [
      {
        id: 'connections-start-built-in',
        title: 'Use the built-in setup first',
        body: 'Settings → Connections holds supported API keys, OAuth setup, provider sources, and service-specific instructions. Artist account logins have their own direct settings pages.',
        icon: 'connection',
        actions: [{ id: 'settings.connections', label: 'Open Connections' }],
      },
      {
        id: 'connections-start-agent',
        title: 'Ask Command to connect something else',
        body: 'Say “Connect [service] to this workspace.” An agent can help create an MCP, REST API, or local source, find the official setup path, test it, and trigger OAuth or a secure credential prompt. You still approve credentials and external actions.',
        icon: 'command',
        actions: [
          { id: 'workspace.command', label: 'Ask Command' },
          { id: 'app.tools', label: 'Open Tools' },
        ],
      },
    ],
    destinations: [],
    conceptsLabel: 'Connection safety',
    concepts: [],
  },
  {
    id: 'top-bar',
    label: 'Top Bar',
    intro: 'Use the top-right controls to add capabilities, find work, catch alerts, and configure Artist OS.',
    start: [
      {
        id: 'topbar-start-library',
        title: 'Open the tool icon for your Library',
        body: 'Manage Tools, Skills, and Workspace Context from one menu.',
        icon: 'tools',
        actions: [
          { id: 'app.tools', label: 'Tools' },
          { id: 'app.skills', label: 'Skills' },
          { id: 'workspace.context', label: 'Context' },
        ],
      },
      {
        id: 'topbar-start-outputs',
        title: 'Find created work in Outputs',
        body: 'See durable files, reports, media, and receipts created in the workspace you are currently viewing, newest first.',
        icon: 'outputs',
        actions: [{ id: 'app.outputs', label: 'Open Outputs' }],
      },
      {
        id: 'topbar-start-bell',
        title: 'Check the notification bell',
        body: 'See workspace Pulse alerts and requests that may need your attention.',
        icon: 'notifications',
      },
      {
        id: 'topbar-start-settings',
        title: 'Configure Artist OS in Settings',
        body: 'Manage app behavior, AI providers, connections, accounts, permissions, and other setup.',
        icon: 'settings',
        actions: [{ id: 'settings.app', label: 'Open Settings' }],
      },
      {
        id: 'topbar-start-guide',
        title: 'Return here for the essentials',
        body: 'The guide icon opens this fast-start guide for General, HQ, Campaigns, Creative Lab, and the top bar.',
        icon: 'guide',
      },
    ],
    destinations: [
      {
        id: 'topbar-destination-tools',
        title: 'Tools',
        body: 'See and connect tools, connectors, and apps that give workers additional abilities.',
        icon: 'tools',
        actions: [{ id: 'app.tools', label: 'Open' }],
      },
      {
        id: 'topbar-destination-skills',
        title: 'Skills',
        body: 'Manage reusable capabilities workers can use, including new workers you create.',
        icon: 'skills',
        actions: [{ id: 'app.skills', label: 'Open' }],
      },
      {
        id: 'topbar-destination-context',
        title: 'Workspace Context',
        body: 'Add facts, instructions, and documents agents in the current workspace should know.',
        icon: 'context',
        actions: [{ id: 'workspace.context', label: 'Open' }],
      },
      {
        id: 'topbar-destination-outputs',
        title: 'Outputs',
        body: 'Review durable work created by agents and workflows in the current workspace.',
        icon: 'outputs',
        actions: [{ id: 'app.outputs', label: 'Open' }],
      },
      {
        id: 'topbar-destination-settings',
        title: 'Settings',
        body: 'Control the app and manage its providers, connections, accounts, and safety rules.',
        icon: 'settings',
        actions: [{ id: 'settings.app', label: 'Open' }],
      },
    ],
    conceptsLabel: 'Know what each surface holds',
    concepts: [
      {
        id: 'topbar-concept-library',
        title: 'Tools, Skills, and Context are different',
        body: 'Tools connect capabilities. Skills teach workers how to perform reusable jobs. Workspace Context gives selected workers the facts and documents they should know here.',
      },
      {
        id: 'topbar-concept-output-kit',
        title: 'Outputs versus Release Kit',
        body: 'Outputs are created work and drafts. A campaign Release Kit holds only the final assets explicitly approved to go out into the world.',
      },
      {
        id: 'topbar-concept-output-scope',
        title: 'Outputs currently follow the active workspace',
        body: 'Switching between HQ and a Campaign changes which Outputs appear. A single all-workspaces feed is not available yet.',
      },
      {
        id: 'topbar-concept-notifications',
        title: 'The bell is not the only approval surface',
        body: 'The bell currently carries workspace Pulse notifications. Approval requests can also appear in the relevant chat, Campaign, Plan, or workflow run.',
      },
    ],
  },
]
