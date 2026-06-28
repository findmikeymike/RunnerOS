import * as React from 'react'
import { CheckCircle2, KeyRound, Loader2, Plus, RefreshCcw, Trash2, WalletCards } from 'lucide-react'
import { toast } from 'sonner'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsSection } from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { UserSecretSummary, ZeroStatus } from '../../../shared/types'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'secrets',
}

type SecretPreset = {
  group: string
  name: string
  label: string
  description: string
  placeholder?: string
  storage: 'env' | 'source' | 'managed-source'
  sourceSlug?: string
  sourceType?: 'api' | 'mcp' | 'local'
}

type SecretService = {
  id: string
  group: string
  title: string
  description: string
  presetNames: string[]
  optionalPresetNames?: string[]
  requiredAnyPresetNames?: string[]
}

type ServiceStatus = 'ready' | 'needs' | 'optional'

const SECRET_PRESETS: SecretPreset[] = [
  {
    group: 'Ads',
    name: 'META_ADS_OAUTH',
    label: 'Meta Ads credential',
    description: 'Managed by the Meta Ads source OAuth flow. Connect it from Tools/Sources, not by pasting a token here.',
    storage: 'managed-source',
    sourceSlug: 'meta-ads',
    sourceType: 'mcp',
  },
  {
    group: 'Ads',
    name: 'GOOGLE_ADS_OAUTH',
    label: 'Google Ads credential',
    description: 'Managed by the Google Ads source setup because it also needs a developer token and optional login customer ID.',
    storage: 'managed-source',
    sourceSlug: 'google-ads',
    sourceType: 'local',
  },
  {
    group: 'Research',
    name: 'YOUTUBE_API_KEY',
    label: 'YouTube Data API key',
    description: 'Saved into the YouTube Research source so source status and the bundled wrapper credential cache stay in sync.',
    placeholder: 'AIza...',
    storage: 'source',
    sourceSlug: 'youtube-research',
    sourceType: 'local',
  },
  {
    group: 'Promotion',
    name: 'SPOTIFY_CLIENT_ID',
    label: 'Spotify client ID',
    description: 'Used by Spotify playlist and artist-data workflows once Spotify OAuth is wired.',
    placeholder: 'Spotify client ID',
    storage: 'env',
  },
  {
    group: 'Promotion',
    name: 'SPOTIFY_CLIENT_SECRET',
    label: 'Spotify client secret',
    description: 'Used with the Spotify client ID for playlist and artist-data workflows.',
    placeholder: 'Spotify client secret',
    storage: 'env',
  },
  {
    group: 'Promotion',
    name: 'SPOTIFY_REDIRECT_URI',
    label: 'Spotify redirect URI',
    description: 'Optional callback URL for Spotify OAuth apps.',
    placeholder: 'http://127.0.0.1:53682/callback',
    storage: 'env',
  },
  {
    group: 'Promotion',
    name: 'TRYPOST_API_KEY',
    label: 'TryPost API key',
    description: 'Used by the TryPost agent for social publishing through TryPost.',
    placeholder: 'TryPost API key',
    storage: 'env',
  },
  {
    group: 'Promotion',
    name: 'POSTIZ_API_KEY',
    label: 'Postiz API key',
    description: 'Used by Postiz-compatible social scheduling and publishing workflows.',
    placeholder: 'Postiz API key',
    storage: 'env',
  },
  {
    group: 'Promotion',
    name: 'POSTIZ_BASE_URL',
    label: 'Postiz workspace URL',
    description: 'Optional. Use when your Postiz instance is self-hosted or not the default cloud endpoint.',
    placeholder: 'https://postiz.example.com',
    storage: 'env',
  },
  {
    group: 'Commerce',
    name: 'SHOPIFY_SHOP',
    label: 'Shopify shop domain',
    description: 'Required by Shopify Agent. Example: mystore.myshopify.com.',
    placeholder: 'mystore.myshopify.com',
    storage: 'env',
  },
  {
    group: 'Commerce',
    name: 'SHOPIFY_ACCESS_TOKEN',
    label: 'Shopify access token',
    description: 'Required by Shopify Agent. Use a custom app token with only needed scopes.',
    placeholder: 'shpat_...',
    storage: 'env',
  },
  {
    group: 'Commerce',
    name: 'SHOPIFY_STORE_DOMAIN',
    label: 'Shopify store domain alias',
    description: 'Alternate name accepted by Shopify tooling. Use this or SHOPIFY_SHOP.',
    placeholder: 'mystore.myshopify.com',
    storage: 'env',
  },
  {
    group: 'Commerce',
    name: 'SHOPIFY_API_VERSION',
    label: 'Shopify API version',
    description: 'Optional. Defaults to 2026-04 when unset.',
    placeholder: '2026-04',
    storage: 'env',
  },
  {
    group: 'Commerce',
    name: 'PRINTIFY_API_TOKEN',
    label: 'Printify API token',
    description: 'Required by Print Agent / Printify source.',
    placeholder: 'Printify token',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'ASSEMBLYAI_API_KEY',
    label: 'AssemblyAI API key',
    description: 'Used by speech transcription and audio intelligence workflows.',
    placeholder: 'AssemblyAI key',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'ELEVENLABS_API_KEY',
    label: 'ElevenLabs API key',
    description: 'Used by voice/TTS workflows and env fallback source lookup.',
    placeholder: 'ElevenLabs key',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'INWORLD_API_KEY',
    label: 'Inworld API key',
    description: 'Used by voice/TTS workflows and env fallback source lookup.',
    placeholder: 'Inworld key',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'INWORLD_RUNTIME_KEY',
    label: 'Inworld runtime key',
    description: 'Used by Inworld runtime voice and character workflows.',
    placeholder: 'Inworld runtime key',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'HEYGEN_API_KEY',
    label: 'HeyGen API key',
    description: 'Generic HeyGen key. Squad also supports SQUAD_HEYGEN_API_KEY for isolated Video Director credentials.',
    placeholder: 'HeyGen API key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_OPENAI_API_KEY',
    label: 'Squad OpenAI API key',
    description: 'Optional isolated OpenAI key for Squad director decisions, image prompts, and image evaluation.',
    placeholder: 'sk-...',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'FAL_API_KEY',
    label: 'Fal API key',
    description: 'Generic Fal key used by image/video generation tools when no Squad-specific key is set.',
    placeholder: 'fal key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_FAL_API_KEY',
    label: 'Squad Fal API key',
    description: 'Required by Squad image generation and used as the Fal video fallback provider.',
    placeholder: 'fal key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_WAVESPEED_API_KEY',
    label: 'Squad WaveSpeed API key',
    description: 'Primary Squad full-production video provider key.',
    placeholder: 'WaveSpeed key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'WAVESPEED_API_KEY',
    label: 'WaveSpeed API key',
    description: 'Generic WaveSpeed fallback accepted by Squad video smoke and production checks.',
    placeholder: 'WaveSpeed key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_HEYGEN_API_KEY',
    label: 'Squad HeyGen API key',
    description: 'Isolated HeyGen key for Squad UGC/avatar video generation.',
    placeholder: 'HeyGen API key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_HEYGEN_AVATAR_ID',
    label: 'Squad HeyGen avatar ID',
    description: 'Required with the HeyGen key for Squad talking-head/avatar video runs.',
    placeholder: 'avatar id',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_HEYGEN_VOICE_ID',
    label: 'Squad HeyGen voice ID',
    description: 'Required with the HeyGen key for Squad talking-head/avatar video runs.',
    placeholder: 'voice id',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_HEYGEN_PERSONA_MAP_JSON',
    label: 'Squad HeyGen persona map',
    description: 'Optional JSON map for selecting HeyGen avatar and voice IDs by persona.',
    placeholder: '{"persona":{"avatar_id":"...","voice_id":"..."}}',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_FISH_TTS_API_KEY',
    label: 'Squad Fish Audio API key',
    description: 'Optional isolated Fish Audio/Fish TTS key for Squad voiceover generation.',
    placeholder: 'Fish Audio key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'FISH_AUDIO_API_KEY',
    label: 'Fish Audio API key',
    description: 'Generic Fish Audio fallback accepted by Squad TTS.',
    placeholder: 'Fish Audio key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_FISH_TTS_REFERENCE_ID',
    label: 'Squad Fish voice reference ID',
    description: 'Optional Fish TTS reference or voice ID for Squad voiceover generation.',
    placeholder: 'reference id',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_INWORLD_TTS_API_KEY',
    label: 'Squad Inworld TTS API key',
    description: 'Optional isolated Inworld TTS key for Squad voiceover generation.',
    placeholder: 'Inworld TTS key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'INWORLD_TTS_API_KEY',
    label: 'Inworld TTS API key',
    description: 'Generic Inworld TTS fallback accepted by Squad voiceover generation.',
    placeholder: 'Inworld TTS key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'SQUAD_INWORLD_TTS_VOICE_ID',
    label: 'Squad Inworld voice ID',
    description: 'Optional Inworld voice ID for Squad voiceover generation.',
    placeholder: 'voice id',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'MUAPI_API_KEY',
    label: 'MuAPI API key',
    description: 'Used by Squad MuAPI workflow execution tools.',
    placeholder: 'MuAPI key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'RUNPOD_API_KEY',
    label: 'RunPod API key',
    description: 'Used by Squad RunPod/LTX video benchmark and hosted worker flows.',
    placeholder: 'RunPod key',
    storage: 'env',
  },
  {
    group: 'Squad Video',
    name: 'RUNPOD_LTX_ENDPOINT_ID',
    label: 'RunPod LTX endpoint ID',
    description: 'Required with RUNPOD_API_KEY for Squad RunPod/LTX video runs.',
    placeholder: 'endpoint id',
    storage: 'env',
  },
  {
    group: 'Dev / Cloud',
    name: 'GITHUB_TOKEN',
    label: 'GitHub token',
    description: 'Common GitHub token for CLI, MCP, and automation tooling.',
    placeholder: 'ghp_...',
    storage: 'env',
  },
  {
    group: 'Dev / Cloud',
    name: 'GH_TOKEN',
    label: 'GitHub CLI token',
    description: 'GitHub CLI-compatible token alias used by some local tools.',
    placeholder: 'ghp_...',
    storage: 'env',
  },
  {
    group: 'Dev / Cloud',
    name: 'STRIPE_SECRET_KEY',
    label: 'Stripe secret key',
    description: 'Stripe API key for tools that need direct Stripe API access. Webhook secrets stay under Automation.',
    placeholder: 'sk_live_...',
    storage: 'env',
  },
  {
    group: 'Dev / Cloud',
    name: 'AWS_ACCESS_KEY_ID',
    label: 'AWS access key ID',
    description: 'Used by CLI object storage and cloud tooling.',
    placeholder: 'AKIA...',
    storage: 'env',
  },
  {
    group: 'Dev / Cloud',
    name: 'AWS_SECRET_ACCESS_KEY',
    label: 'AWS secret access key',
    description: 'Used with AWS_ACCESS_KEY_ID by CLI object storage and cloud tooling.',
    placeholder: 'AWS secret',
    storage: 'env',
  },
  {
    group: 'Dev / Cloud',
    name: 'AWS_SESSION_TOKEN',
    label: 'AWS session token',
    description: 'Optional temporary AWS session token for short-lived credentials.',
    placeholder: 'AWS session token',
    storage: 'env',
  },
  {
    group: 'Dev / Cloud',
    name: 'NPM_TOKEN',
    label: 'npm token',
    description: 'Used by package publish and registry automation tooling.',
    placeholder: 'npm_...',
    storage: 'env',
  },
  {
    group: 'Dev / Cloud',
    name: 'STITCH_API_KEY',
    label: 'Stitch API key',
    description: 'Used by the bundled stitch-mcp source validation flow.',
    placeholder: 'Stitch API key',
    storage: 'env',
  },
  {
    group: 'MCP / Apps',
    name: 'BRAVE_API_KEY',
    label: 'Brave Search API key',
    description: 'Used by the documented Brave Search MCP server env config.',
    placeholder: 'Brave Search key',
    storage: 'env',
  },
  {
    group: 'Automation',
    name: 'CRAFT_WH_SIGNED_HOOK_SECRET',
    label: 'Webhook signing secret',
    description: 'Use for signed inbound webhook automations. Rename if a specific automation expects another CRAFT_WH_* name.',
    placeholder: 'shared signing secret',
    storage: 'env',
  },
  {
    group: 'Automation',
    name: 'CRAFT_WH_GITHUB_SECRET',
    label: 'GitHub webhook secret',
    description: 'Used by the built-in GitHub external trigger template.',
    placeholder: 'GitHub webhook secret',
    storage: 'env',
  },
  {
    group: 'Automation',
    name: 'CRAFT_WH_STRIPE_SECRET',
    label: 'Stripe webhook secret',
    description: 'Used by the built-in Stripe external trigger template.',
    placeholder: 'whsec_...',
    storage: 'env',
  },
  {
    group: 'Automation',
    name: 'CRAFT_WH_API_TOKEN',
    label: 'Webhook API token',
    description: 'Common bearer token used by webhook action templates.',
    placeholder: 'API token',
    storage: 'env',
  },
  {
    group: 'Automation',
    name: 'CRAFT_WH_SLACK_URL',
    label: 'Slack webhook URL',
    description: 'Common webhook URL used by automation examples and session notification templates.',
    placeholder: 'https://hooks.slack.com/services/...',
    storage: 'env',
  },
  {
    group: 'Automation',
    name: 'CRAFT_WH_CLIENT_ID',
    label: 'Webhook OAuth client ID',
    description: 'Common OAuth client ID used by webhook action templates.',
    placeholder: 'client ID',
    storage: 'env',
  },
  {
    group: 'Automation',
    name: 'CRAFT_WH_CLIENT_SECRET',
    label: 'Webhook OAuth client secret',
    description: 'Common OAuth client secret used by webhook action templates.',
    placeholder: 'client secret',
    storage: 'env',
  },
  {
    group: 'Zero',
    name: 'ZERO_PRIVATE_KEY',
    label: 'Zero wallet private key',
    description: 'Used by Zero CLI before falling back to ~/.zero/config.json.',
    placeholder: '0x...',
    storage: 'env',
  },
]

const SERVICES: SecretService[] = [
  {
    id: 'meta-ads',
    group: 'Promotion',
    title: 'Meta Ads',
    description: 'Connect ad account access for Meta reporting, diagnostics, and planned ad work.',
    presetNames: ['META_ADS_OAUTH'],
  },
  {
    id: 'google-ads',
    group: 'Promotion',
    title: 'Google Ads',
    description: 'Connect Google Ads for account lookup, reports, diagnostics, and campaign planning.',
    presetNames: ['GOOGLE_ADS_OAUTH'],
  },
  {
    id: 'youtube-research',
    group: 'Promotion',
    title: 'YouTube Research',
    description: 'Let research agents search videos, transcripts, comments, embeds, and channels.',
    presetNames: ['YOUTUBE_API_KEY'],
  },
  {
    id: 'spotify',
    group: 'Promotion',
    title: 'Spotify',
    description: 'Credentials for playlist and artist-data workflows.',
    presetNames: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI'],
    optionalPresetNames: ['SPOTIFY_REDIRECT_URI'],
  },
  {
    id: 'social-publishing',
    group: 'Promotion',
    title: 'Social Publishing',
    description: 'Optional posting services for agents that publish or schedule content.',
    presetNames: ['TRYPOST_API_KEY', 'POSTIZ_API_KEY', 'POSTIZ_BASE_URL'],
    optionalPresetNames: ['TRYPOST_API_KEY', 'POSTIZ_API_KEY', 'POSTIZ_BASE_URL'],
  },
  {
    id: 'shopify',
    group: 'Commerce',
    title: 'Shopify',
    description: 'Connect store access for merch/product agents.',
    presetNames: ['SHOPIFY_SHOP', 'SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ACCESS_TOKEN', 'SHOPIFY_API_VERSION'],
    optionalPresetNames: ['SHOPIFY_API_VERSION'],
    requiredAnyPresetNames: ['SHOPIFY_SHOP', 'SHOPIFY_STORE_DOMAIN'],
  },
  {
    id: 'printify',
    group: 'Commerce',
    title: 'Printify',
    description: 'Connect Printify for print-on-demand merch workflows.',
    presetNames: ['PRINTIFY_API_TOKEN'],
  },
  {
    id: 'voice-audio',
    group: 'AI + Media',
    title: 'Voice + Audio',
    description: 'Speech, voiceover, transcription, and audio intelligence providers.',
    presetNames: ['ASSEMBLYAI_API_KEY', 'ELEVENLABS_API_KEY', 'FISH_AUDIO_API_KEY', 'SQUAD_FISH_TTS_API_KEY', 'SQUAD_FISH_TTS_REFERENCE_ID', 'INWORLD_API_KEY', 'INWORLD_RUNTIME_KEY', 'INWORLD_TTS_API_KEY', 'SQUAD_INWORLD_TTS_API_KEY', 'SQUAD_INWORLD_TTS_VOICE_ID'],
    optionalPresetNames: ['ASSEMBLYAI_API_KEY', 'ELEVENLABS_API_KEY', 'FISH_AUDIO_API_KEY', 'SQUAD_FISH_TTS_API_KEY', 'SQUAD_FISH_TTS_REFERENCE_ID', 'INWORLD_API_KEY', 'INWORLD_RUNTIME_KEY', 'INWORLD_TTS_API_KEY', 'SQUAD_INWORLD_TTS_API_KEY', 'SQUAD_INWORLD_TTS_VOICE_ID'],
  },
  {
    id: 'video-generation',
    group: 'AI + Media',
    title: 'Video Generation',
    description: 'Video, avatar, image, and render providers used by content agents.',
    presetNames: ['SQUAD_OPENAI_API_KEY', 'HEYGEN_API_KEY', 'FAL_API_KEY', 'SQUAD_FAL_API_KEY', 'WAVESPEED_API_KEY', 'SQUAD_WAVESPEED_API_KEY', 'MUAPI_API_KEY', 'RUNPOD_API_KEY', 'RUNPOD_LTX_ENDPOINT_ID'],
    optionalPresetNames: ['SQUAD_OPENAI_API_KEY', 'HEYGEN_API_KEY', 'FAL_API_KEY', 'SQUAD_FAL_API_KEY', 'WAVESPEED_API_KEY', 'SQUAD_WAVESPEED_API_KEY', 'MUAPI_API_KEY', 'RUNPOD_API_KEY', 'RUNPOD_LTX_ENDPOINT_ID'],
  },
  {
    id: 'squad-avatar',
    group: 'AI + Media',
    title: 'Avatar Video',
    description: 'Optional Squad-specific avatar and voice settings.',
    presetNames: ['SQUAD_HEYGEN_API_KEY', 'SQUAD_HEYGEN_AVATAR_ID', 'SQUAD_HEYGEN_VOICE_ID', 'SQUAD_HEYGEN_PERSONA_MAP_JSON'],
    optionalPresetNames: ['SQUAD_HEYGEN_API_KEY', 'SQUAD_HEYGEN_AVATAR_ID', 'SQUAD_HEYGEN_VOICE_ID', 'SQUAD_HEYGEN_PERSONA_MAP_JSON'],
  },
  {
    id: 'developer-cloud',
    group: 'Developer + Cloud',
    title: 'Developer + Cloud',
    description: 'Keys for GitHub, cloud storage, package publishing, and app service work.',
    presetNames: ['GITHUB_TOKEN', 'GH_TOKEN', 'STRIPE_SECRET_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'NPM_TOKEN', 'STITCH_API_KEY'],
    optionalPresetNames: ['GITHUB_TOKEN', 'GH_TOKEN', 'STRIPE_SECRET_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'NPM_TOKEN', 'STITCH_API_KEY'],
  },
  {
    id: 'mcp-apps',
    group: 'Developer + Cloud',
    title: 'MCP + Apps',
    description: 'Credentials for optional external app integrations.',
    presetNames: ['BRAVE_API_KEY'],
    optionalPresetNames: ['BRAVE_API_KEY'],
  },
  {
    id: 'automation',
    group: 'Automation',
    title: 'Automation Webhooks',
    description: 'Secrets and webhook URLs used by inbound triggers and outbound notifications.',
    presetNames: ['CRAFT_WH_SIGNED_HOOK_SECRET', 'CRAFT_WH_GITHUB_SECRET', 'CRAFT_WH_STRIPE_SECRET', 'CRAFT_WH_API_TOKEN', 'CRAFT_WH_SLACK_URL', 'CRAFT_WH_CLIENT_ID', 'CRAFT_WH_CLIENT_SECRET'],
    optionalPresetNames: ['CRAFT_WH_SIGNED_HOOK_SECRET', 'CRAFT_WH_GITHUB_SECRET', 'CRAFT_WH_STRIPE_SECRET', 'CRAFT_WH_API_TOKEN', 'CRAFT_WH_SLACK_URL', 'CRAFT_WH_CLIENT_ID', 'CRAFT_WH_CLIENT_SECRET'],
  },
  {
    id: 'zero',
    group: 'Wallet',
    title: 'Zero Wallet',
    description: 'Private key fallback for Zero CLI when no local Zero config is present.',
    presetNames: ['ZERO_PRIVATE_KEY'],
    optionalPresetNames: ['ZERO_PRIVATE_KEY'],
  },
]

const SECRET_GROUPS = Array.from(new Set(SERVICES.map((service) => service.group)))
const PRESET_BY_NAME = new Map(SECRET_PRESETS.map((preset) => [preset.name, preset]))

export default function SecretsSettingsPage() {
  const [secrets, setSecrets] = React.useState<UserSecretSummary[]>([])
  const [zero, setZero] = React.useState<ZeroStatus | null>(null)
  const [name, setName] = React.useState('')
  const [value, setValue] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [installing, setInstalling] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [secretRows, zeroStatus] = await Promise.all([
        window.electronAPI.listSecrets(),
        window.electronAPI.getZeroStatus(),
      ])
      setSecrets(secretRows)
      setZero(zeroStatus)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    const result = await window.electronAPI.saveSecret(name, value)
    if (!result.success) {
      toast.error(result.error || 'Could not save secret')
      return
    }
    setName('')
    setValue('')
    toast.success('Secret saved')
    await load()
  }

  const remove = async (secretName: string) => {
    await window.electronAPI.deleteSecret(secretName)
    toast.success('Secret deleted')
    await load()
  }

  const installZero = async () => {
    setInstalling(true)
    try {
      const result = await window.electronAPI.installZero()
      if (!result.success) {
        toast.error(result.error || 'Zero install failed')
        return
      }
      toast.success('Zero installed')
      await load()
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Secrets" />
      <ScrollArea className="flex-1">
        <div className="space-y-6 p-6">
          <SettingsSection title="Zero">
            <SettingsCard>
              <div className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <WalletCards className="h-4 w-4 text-white/55" />
                    Zero CLI
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-white/45">
                    <span>{zero?.installed ? `Installed${zero.version ? ` · ${zero.version}` : ''}` : 'Not installed'}</span>
                    {zero?.path && <span className="truncate">{zero.path}</span>}
                    <span>{zero?.walletConfigured ? 'Wallet ready' : 'Wallet missing'}</span>
                    {zero?.balance && <span className="truncate">{zero.balance}</span>}
                    {zero?.error && <span className="text-amber-300/80">{zero.error}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                  </Button>
                  {!zero?.installed && (
                    <Button size="sm" onClick={installZero} disabled={installing}>
                      {installing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                      Install
                    </Button>
                  )}
                </div>
              </div>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title="Environment Secrets">
            <SettingsCard>
              <div className="grid gap-3 p-4 md:grid-cols-[minmax(180px,240px)_1fr_auto]">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value.toUpperCase())}
                  placeholder="ZERO_PRIVATE_KEY"
                  className="h-9 rounded-md border border-white/10 bg-black/20 px-3 text-sm outline-none placeholder:text-white/25"
                />
                <input
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="Secret value"
                  type="password"
                  className="h-9 rounded-md border border-white/10 bg-black/20 px-3 text-sm outline-none placeholder:text-white/25"
                />
                <Button size="sm" onClick={save} disabled={!name.trim() || !value}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Save
                </Button>
              </div>
            </SettingsCard>

            <SettingsCard>
              <div className="divide-y divide-white/[0.06]">
                {secrets.length === 0 ? (
                  <div className="p-4 text-sm text-white/38">No secrets saved.</div>
                ) : secrets.map((secret) => (
                  <div key={secret.name} className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <KeyRound className="h-3.5 w-3.5 text-white/45" />
                        <span>{secret.name}</span>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400/80" />
                      </div>
                      <div className="mt-1 text-xs text-white/35">{secret.maskedValue}</div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => remove(secret.name)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </SettingsCard>
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  )
}
