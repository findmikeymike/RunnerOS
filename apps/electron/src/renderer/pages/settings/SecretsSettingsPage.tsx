import * as React from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ExternalLink, Info, KeyRound, Loader2, LogOut, Mail, RefreshCcw, Save, Trash2, WalletCards } from 'lucide-react'
import { toast } from 'sonner'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsSection } from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { LoadedSource, SourceCredentialScopeResult, UserSecretSummary, ZeroStatus } from '../../../shared/types'
import { useAppShellContext } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'secrets',
}

function InfoExplainer({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/[0.04] text-white/40 transition-colors hover:bg-white/[0.08] hover:text-white/80">
          <Info className="h-2.5 w-2.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" className="max-w-[220px] bg-[#1a1a1a] border-white/10 text-white/80 text-[11px] leading-relaxed p-2.5 shadow-modal-small">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

export type SecretPreset = {
  group: string
  name: string
  label: string
  description: string
  placeholder?: string
  inputType?: 'text' | 'password' | 'select'
  options?: Array<{ value: string; label: string }>
  storage: 'env' | 'source' | 'managed-source'
  sourceSlug?: string
  sourceType?: 'api' | 'mcp' | 'local'
  setupUrl?: string
  setupLabel?: string
}

export type SecretService = {
  id: string
  group: string
  title: string
  description: string
  presetNames: string[]
  optionalPresetNames?: string[]
  requiredAnyPresetNames?: string[]
}

type ServiceStatus = 'ready' | 'needs' | 'optional'

export const SECRET_PRESETS: SecretPreset[] = [
  {
    group: 'Ads',
    name: 'META_ADS_OAUTH',
    label: 'Meta Ads credential',
    description: 'Open Meta\'s token tool, generate a Marketing API access token, then paste it into the Meta Ads source when ready.',
    storage: 'managed-source',
    sourceSlug: 'meta-ads',
    sourceType: 'mcp',
    setupUrl: 'https://developers.facebook.com/tools/explorer/',
    setupLabel: 'Get token',
  },
  {
    group: 'Ads',
    name: 'GOOGLE_ADS_OAUTH',
    label: 'Google Ads credential',
    description: 'Open Google\'s setup guide for the developer token, OAuth credentials, and customer ID required by the Google Ads API.',
    storage: 'managed-source',
    sourceSlug: 'google-ads',
    sourceType: 'local',
    setupUrl: 'https://developers.google.com/google-ads/api/docs/get-started/make-first-call',
    setupLabel: 'Setup guide',
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
    group: 'Workspace',
    name: 'GOOGLE_OAUTH_CLIENT_ID',
    label: 'Google OAuth client ID',
    description: 'Desktop OAuth client ID used for Google Calendar, Gmail, Drive, People, and Google MCP source sign-in.',
    placeholder: 'Google OAuth client ID',
    storage: 'env',
  },
  {
    group: 'Workspace',
    name: 'GOOGLE_OAUTH_CLIENT_SECRET',
    label: 'Google OAuth client secret',
    description: 'Desktop OAuth client secret stored with Google tokens so Calendar/Gmail/Drive access can refresh safely.',
    placeholder: 'Google OAuth client secret',
    storage: 'env',
  },
  {
    group: 'Workspace',
    name: 'GOOGLE_WORKSPACE_PRIMARY_CALENDAR_ID',
    label: 'Primary calendar ID',
    description: 'Optional. Defaults to primary. Use this when Artist HQ should sync to a dedicated Google Calendar.',
    placeholder: 'primary',
    storage: 'env',
  },
  {
    group: 'Community',
    name: 'RESEND_API_KEY',
    label: 'Resend API key',
    description: 'Used by Community to send approved fan emails through Resend. Your From address must use a verified Resend domain.',
    placeholder: 're_...',
    storage: 'env',
  },
  {
    group: 'Promotion',
    name: 'SPOTIFY_CLIENT_ID',
    label: 'Spotify client ID (legacy)',
    description: 'Legacy public Web API credential. Current Spotify Analyst and Playlist Creator use the connected Spotify browser session instead.',
    placeholder: 'Spotify client ID',
    storage: 'env',
  },
  {
    group: 'Promotion',
    name: 'SPOTIFY_CLIENT_SECRET',
    label: 'Spotify client secret (legacy)',
    description: 'Legacy public Web API credential. It is not required by the current browser-based Spotify agents.',
    placeholder: 'Spotify client secret',
    storage: 'env',
  },
  {
    group: 'Promotion',
    name: 'SPOTIFY_REDIRECT_URI',
    label: 'Spotify redirect URI (legacy)',
    description: 'Optional callback URL for legacy Spotify OAuth tooling, not the current browser-based Spotify agents.',
    placeholder: 'http://127.0.0.1:53682/callback',
    storage: 'env',
  },
  {
    group: 'Music / Lyrics',
    name: 'GENIUS_ACCESS_TOKEN',
    label: 'Genius access token',
    description: 'Used by Lab song research for Genius song, artist, album art, annotation, and page lookup. Create a Genius API Client and generate a Client Access Token.',
    placeholder: 'Genius Client Access Token',
    storage: 'env',
    setupUrl: 'https://genius.com/api-clients',
    setupLabel: 'Get token',
  },
  {
    group: 'Promotion',
    name: 'TRYPOST_SOURCE_CONNECTION',
    label: 'TryPost provider connection',
    description: 'Connect TryPost with a Personal Access Token. The token is encrypted in source credential storage and used by TryPost Agent.',
    storage: 'managed-source',
    sourceSlug: 'trypost',
    sourceType: 'mcp',
    setupLabel: 'Connect source',
  },
  {
    group: 'Promotion',
    name: 'POSTIZ_SOURCE_CONNECTION',
    label: 'Postiz provider connection',
    description: 'Connect Postiz Cloud with an API key. The key is encrypted in source credential storage and used by Postiz Agent.',
    storage: 'managed-source',
    sourceSlug: 'postiz',
    sourceType: 'mcp',
    setupLabel: 'Connect source',
  },
  {
    group: 'Promotion',
    name: 'POSTIZ_API_KEY',
    label: 'Postiz API key (local tools)',
    description: 'Used by bundled local/Squad Postiz workflows. The Postiz agent connects separately through the Postiz source.',
    placeholder: 'Postiz API key',
    storage: 'env',
  },
  {
    group: 'Promotion',
    name: 'POSTIZ_BASE_URL',
    label: 'Postiz URL (local tools)',
    description: 'Optional self-hosted URL for bundled local/Squad Postiz workflows.',
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
    description: 'Used by avatar/video generation workflows. Legacy isolated alias SQUAD_HEYGEN_API_KEY is still accepted by older tools.',
    placeholder: 'HeyGen API key',
    storage: 'env',
  },
  {
    group: 'Media Generation',
    name: 'SQUAD_OPENAI_API_KEY',
    label: 'OpenAI media API key (legacy isolated)',
    description: 'Legacy isolated key for older media workflows. Prefer the main AI provider connection when possible.',
    placeholder: 'sk-...',
    storage: 'env',
  },
  {
    group: 'Media Generation',
    name: 'FAL_API_KEY',
    label: 'Fal API key',
    description: 'Shared Fal key used by image, image-edit, reference, and video generation agents.',
    placeholder: 'fal key',
    storage: 'env',
  },
  {
    group: 'Media Generation',
    name: 'SQUAD_FAL_API_KEY',
    label: 'Fal API key (legacy alias)',
    description: 'Legacy isolated alias. Prefer FAL_API_KEY for shared media generation.',
    placeholder: 'fal key',
    storage: 'env',
  },
  {
    group: 'Media Generation',
    name: 'REPLICATE_API_TOKEN',
    label: 'Replicate API token',
    description: 'Shared Replicate token used by image, reference, edit, and model-specific generation agents.',
    placeholder: 'r8_...',
    storage: 'env',
  },
  {
    group: 'Media Generation',
    name: 'SQUAD_WAVESPEED_API_KEY',
    label: 'WaveSpeed API key (legacy alias)',
    description: 'Legacy isolated alias. Prefer WAVESPEED_API_KEY for shared media generation.',
    placeholder: 'WaveSpeed key',
    storage: 'env',
  },
  {
    group: 'Media Generation',
    name: 'WAVESPEED_API_KEY',
    label: 'WaveSpeed API key',
    description: 'Shared WaveSpeed key used by fast image/video generation agents.',
    placeholder: 'WaveSpeed key',
    storage: 'env',
  },
  {
    group: 'Media Generation',
    name: 'SQUAD_HEYGEN_API_KEY',
    label: 'HeyGen API key (legacy alias)',
    description: 'Legacy isolated alias. Prefer HEYGEN_API_KEY for shared avatar/video generation.',
    placeholder: 'HeyGen API key',
    storage: 'env',
  },
  {
    group: 'Media Generation',
    name: 'SQUAD_HEYGEN_AVATAR_ID',
    label: 'HeyGen avatar ID',
    description: 'Optional avatar ID for avatar video runs.',
    placeholder: 'avatar id',
    storage: 'env',
  },
  {
    group: 'Media Generation',
    name: 'SQUAD_HEYGEN_VOICE_ID',
    label: 'HeyGen voice ID',
    description: 'Optional voice ID for avatar video runs.',
    placeholder: 'voice id',
    storage: 'env',
  },
  {
    group: 'Media Generation',
    name: 'SQUAD_HEYGEN_PERSONA_MAP_JSON',
    label: 'HeyGen persona map',
    description: 'Optional JSON map for selecting HeyGen avatar and voice IDs by persona.',
    placeholder: '{"persona":{"avatar_id":"...","voice_id":"..."}}',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'SQUAD_FISH_TTS_API_KEY',
    label: 'Fish Audio API key (legacy alias)',
    description: 'Legacy isolated alias. Prefer FISH_AUDIO_API_KEY for shared voice generation.',
    placeholder: 'Fish Audio key',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'FISH_AUDIO_API_KEY',
    label: 'Fish Audio API key',
    description: 'Generic Fish Audio fallback accepted by Squad TTS.',
    placeholder: 'Fish Audio key',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'SQUAD_FISH_TTS_REFERENCE_ID',
    label: 'Fish voice reference ID',
    description: 'Optional Fish TTS reference or voice ID for voiceover generation.',
    placeholder: 'reference id',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'SQUAD_INWORLD_TTS_API_KEY',
    label: 'Inworld TTS API key (legacy alias)',
    description: 'Legacy isolated alias. Prefer INWORLD_TTS_API_KEY for shared voice generation.',
    placeholder: 'Inworld TTS key',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'INWORLD_TTS_API_KEY',
    label: 'Inworld TTS API key',
    description: 'Generic Inworld TTS fallback accepted by voiceover generation.',
    placeholder: 'Inworld TTS key',
    storage: 'env',
  },
  {
    group: 'AI / Media',
    name: 'SQUAD_INWORLD_TTS_VOICE_ID',
    label: 'Inworld voice ID',
    description: 'Optional Inworld voice ID for voiceover generation.',
    placeholder: 'voice id',
    storage: 'env',
  },
  {
    group: 'Media Generation',
    name: 'MUAPI_API_KEY',
    label: 'MuAPI API key',
    description: 'Used by media workflow execution tools.',
    placeholder: 'MuAPI key',
    storage: 'env',
  },
  {
    group: 'Media Generation',
    name: 'RUNPOD_API_KEY',
    label: 'RunPod API key',
    description: 'Used by RunPod/LTX video benchmark and hosted worker flows.',
    placeholder: 'RunPod key',
    storage: 'env',
  },
  {
    group: 'Media Generation',
    name: 'RUNPOD_LTX_ENDPOINT_ID',
    label: 'RunPod LTX endpoint ID',
    description: 'Required with RUNPOD_API_KEY for RunPod/LTX video runs.',
    placeholder: 'endpoint id',
    storage: 'env',
  },
  {
    group: 'Media Generation',
    name: 'MEDIA_IMAGE_PROVIDER',
    label: 'Default image provider',
    description: 'Optional. Used when a creative agent needs image generation and the user did not name a provider.',
    placeholder: 'auto',
    inputType: 'select',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'fal', label: 'Fal' },
      { value: 'replicate', label: 'Replicate' },
      { value: 'wavespeed', label: 'WaveSpeed' },
    ],
    storage: 'env',
  },
  {
    group: 'Media Generation',
    name: 'MEDIA_VIDEO_PROVIDER',
    label: 'Default video provider',
    description: 'Optional. Used when a creative agent needs video generation and the user did not name a provider.',
    placeholder: 'auto',
    inputType: 'select',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'fal', label: 'Fal' },
      { value: 'replicate', label: 'Replicate' },
      { value: 'wavespeed', label: 'WaveSpeed' },
    ],
    storage: 'env',
  },
  {
    group: 'Media Generation',
    name: 'MEDIA_PROVIDER_STRATEGY',
    label: 'Generation priority',
    description: 'Optional. Helps agents choose between connected providers when more than one can do the job.',
    placeholder: 'balanced',
    inputType: 'select',
    options: [
      { value: 'balanced', label: 'Balanced' },
      { value: 'speed', label: 'Fastest' },
      { value: 'quality', label: 'Best quality' },
      { value: 'cost', label: 'Cheapest' },
    ],
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

export const SERVICES: SecretService[] = [
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
    id: 'genius',
    group: 'Music / Lyrics',
    title: 'Genius',
    description: 'Connect Genius lookup for song research, artist references, album art, annotations, and writing context.',
    presetNames: ['GENIUS_ACCESS_TOKEN'],
  },
  {
    id: 'google-workspace',
    group: 'Workspace',
    title: 'Google',
    description: 'Connect your Google account to use Gmail in Artist OS.',
    presetNames: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_WORKSPACE_PRIMARY_CALENDAR_ID'],
    optionalPresetNames: ['GOOGLE_WORKSPACE_PRIMARY_CALENDAR_ID'],
  },
  {
    id: 'resend-email',
    group: 'Community',
    title: 'Community Email',
    description: 'Connect Resend so Community can send approved fan emails from a verified domain.',
    presetNames: ['RESEND_API_KEY'],
  },
  {
    id: 'social-publishing',
    group: 'Promotion',
    title: 'Social Publishing Tools',
    description: 'Optional Postiz credentials for bundled local/Squad workflows. Connect provider agents from Sources.',
    presetNames: ['POSTIZ_API_KEY', 'POSTIZ_BASE_URL'],
    optionalPresetNames: ['POSTIZ_API_KEY', 'POSTIZ_BASE_URL'],
  },
  {
    id: 'trypost-provider',
    group: 'Promotion',
    title: 'TryPost Agent',
    description: 'Provider connection for TryPost drafts, scheduling, and publishing.',
    presetNames: ['TRYPOST_SOURCE_CONNECTION'],
  },
  {
    id: 'postiz-provider',
    group: 'Promotion',
    title: 'Postiz Agent',
    description: 'Provider connection for Postiz drafts, scheduling, and publishing.',
    presetNames: ['POSTIZ_SOURCE_CONNECTION'],
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
    presetNames: ['ASSEMBLYAI_API_KEY', 'ELEVENLABS_API_KEY', 'FISH_AUDIO_API_KEY', 'INWORLD_API_KEY', 'INWORLD_RUNTIME_KEY', 'INWORLD_TTS_API_KEY'],
    optionalPresetNames: ['ASSEMBLYAI_API_KEY', 'ELEVENLABS_API_KEY', 'FISH_AUDIO_API_KEY', 'INWORLD_API_KEY', 'INWORLD_RUNTIME_KEY', 'INWORLD_TTS_API_KEY'],
  },
  {
    id: 'media-generation',
    group: 'AI + Media',
    title: 'Media Generation',
    description: 'Shared image, video, avatar, and render keys for creative agents.',
    presetNames: ['FAL_API_KEY', 'WAVESPEED_API_KEY', 'REPLICATE_API_TOKEN', 'HEYGEN_API_KEY', 'MUAPI_API_KEY', 'RUNPOD_API_KEY', 'RUNPOD_LTX_ENDPOINT_ID', 'MEDIA_IMAGE_PROVIDER', 'MEDIA_VIDEO_PROVIDER', 'MEDIA_PROVIDER_STRATEGY'],
    optionalPresetNames: ['FAL_API_KEY', 'WAVESPEED_API_KEY', 'REPLICATE_API_TOKEN', 'HEYGEN_API_KEY', 'MUAPI_API_KEY', 'RUNPOD_API_KEY', 'RUNPOD_LTX_ENDPOINT_ID', 'MEDIA_IMAGE_PROVIDER', 'MEDIA_VIDEO_PROVIDER', 'MEDIA_PROVIDER_STRATEGY'],
  },
  {
    id: 'avatar-video',
    group: 'AI + Media',
    title: 'Avatar Video',
    description: 'Optional HeyGen avatar and voice settings.',
    presetNames: ['SQUAD_HEYGEN_AVATAR_ID', 'SQUAD_HEYGEN_VOICE_ID', 'SQUAD_HEYGEN_PERSONA_MAP_JSON'],
    optionalPresetNames: ['SQUAD_HEYGEN_AVATAR_ID', 'SQUAD_HEYGEN_VOICE_ID', 'SQUAD_HEYGEN_PERSONA_MAP_JSON'],
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
    group: 'Miscellaneous',
    title: 'Zero CLI',
    description: 'Zero lets agents call paid external services. Set up the CLI wallet, then fund it.',
    presetNames: ['ZERO_PRIVATE_KEY'],
    optionalPresetNames: ['ZERO_PRIVATE_KEY'],
  },
]

const SECRET_GROUPS = Array.from(new Set(SERVICES.map((service) => service.group)))
const PRESET_BY_NAME = new Map(SECRET_PRESETS.map((preset) => [preset.name, preset]))

export default function SecretsSettingsPage() {
  const { activeWorkspaceId } = useAppShellContext()
  const [secrets, setSecrets] = React.useState<UserSecretSummary[]>([])
  const [sources, setSources] = React.useState<LoadedSource[]>([])
  const [zero, setZero] = React.useState<ZeroStatus | null>(null)
  const [selectedGroup, setSelectedGroup] = React.useState(SECRET_GROUPS[0] ?? '')
  const [draftValues, setDraftValues] = React.useState<Record<string, string>>({})
  const [loading, setLoading] = React.useState(false)
  const [installing, setInstalling] = React.useState(false)
  const [busyServiceId, setBusyServiceId] = React.useState<string | null>(null)
  const [expandedServiceId, setExpandedServiceId] = React.useState<string | null>(null)
  const [zeroAction, setZeroAction] = React.useState<string | null>(null)
  const [zeroImportOpen, setZeroImportOpen] = React.useState(false)
  const [canManageSecrets, setCanManageSecrets] = React.useState<boolean | null>(null)
  const [accessMessage, setAccessMessage] = React.useState('Only the workspace Owner can view or change saved keys and connected service credentials.')
  const [gmailScope, setGmailScope] = React.useState<SourceCredentialScopeResult | null>(null)
  const [gmailConnectionError, setGmailConnectionError] = React.useState<string | null>(null)
  const [savedSecretsOpen, setSavedSecretsOpen] = React.useState(false)

  const services = React.useMemo(
    () => SERVICES.filter((service) => service.group === selectedGroup),
    [selectedGroup],
  )
  const savedByName = React.useMemo(
    () => new Map(secrets.map((secret) => [secret.name, secret])),
    [secrets],
  )
  const sourceBySlug = React.useMemo(
    () => new Map(sources.map((source) => [source.config.slug, source])),
    [sources],
  )

  const load = React.useCallback(async () => {
    setLoading(true)
    setCanManageSecrets(null)
    setSecrets([])
    setZero(null)
    setSources([])
    setGmailScope(null)
    try {
      if (!activeWorkspaceId) {
        setAccessMessage('Select an active workspace to manage saved keys and connected service credentials.')
        setCanManageSecrets(false)
        return
      }
      const teamStatus = await window.electronAPI.getWorkspaceTeamStatus(activeWorkspaceId)
      const canManage = teamStatus.currentRole === 'owner'
      setAccessMessage('Only the workspace Owner can view or change saved keys and connected service credentials.')
      setCanManageSecrets(canManage)
      if (!canManage) return
      const [secretRows, zeroStatus, sourceRows, nextGmailScope] = await Promise.all([
        window.electronAPI.listSecrets(activeWorkspaceId),
        window.electronAPI.getZeroStatus(activeWorkspaceId),
        window.electronAPI.getSources(activeWorkspaceId).catch(() => [] as LoadedSource[]),
        window.electronAPI.getSourceCredentialScope(activeWorkspaceId, 'gmail').catch(() => null),
      ])
      setSecrets(secretRows)
      setZero(zeroStatus)
      setSources(sourceRows)
      setGmailScope(nextGmailScope)
      if (nextGmailScope?.hasEffectiveCredential) setGmailConnectionError(null)
    } catch (error) {
      setAccessMessage('Owner access could not be verified, so keys and connected services remain hidden.')
      setCanManageSecrets(false)
      toast.error('Could not load keys and services', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId])

  const connectGmail = React.useCallback(async () => {
    if (!activeWorkspaceId) return
    setBusyServiceId('google-workspace')
    setGmailConnectionError(null)
    try {
      const result = await window.electronAPI.performOAuth({ sourceSlug: 'gmail', credentialScope: 'workspace' })
      if (!result.success) {
        const message = result.error || 'Google sign-in failed. Try connecting again.'
        setGmailConnectionError(message)
        toast.error(message)
        return
      }

      let nextScope: SourceCredentialScopeResult | null = null
      for (const delayMs of [0, 100, 250, 500, 1000]) {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
        nextScope = await window.electronAPI
          .getSourceCredentialScope(activeWorkspaceId, 'gmail')
          .catch(() => null)
        if (nextScope?.hasEffectiveCredential) break
      }

      if (!nextScope?.hasEffectiveCredential) {
        const message = 'Google approved access, but Artist OS could not save the connection. Try connecting again.'
        setGmailConnectionError(message)
        toast.error(message)
        return
      }

      setGmailScope(nextScope)
      toast.success(`Google connected${result.email ? ` as ${result.email}` : ''}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setGmailConnectionError(message)
      toast.error('Could not connect Google', {
        description: message,
      })
    } finally {
      setBusyServiceId(null)
    }
  }, [activeWorkspaceId, load])

  const disconnectGmail = React.useCallback(async () => {
    setBusyServiceId('google-workspace')
    try {
      const result = await window.electronAPI.oauthRevoke('gmail')
      if (result.warning) toast.warning('Google disconnected locally', { description: result.warning })
      else toast.success('Google disconnected and access revoked')
      await load()
    } catch (error) {
      toast.error('Could not disconnect Google', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusyServiceId(null)
    }
  }, [load])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    if (!window.electronAPI?.onSecretsChanged) return
    return window.electronAPI.onSecretsChanged(() => {
      void load()
    })
  }, [load])

  React.useEffect(() => {
    if (!window.electronAPI?.onSourcesChanged) return
    return window.electronAPI.onSourcesChanged((workspaceId) => {
      if (workspaceId === activeWorkspaceId) void load()
    })
  }, [activeWorkspaceId, load])

  const openSource = React.useCallback((preset: SecretPreset) => {
    if (preset.setupUrl) {
      void window.electronAPI.openUrl(preset.setupUrl)
      return
    }
    if (!preset.sourceSlug) return
    if (preset.sourceType === 'mcp') {
      navigate(routes.view.sourcesMcp(preset.sourceSlug))
    } else if (preset.sourceType === 'api') {
      navigate(routes.view.sourcesApi(preset.sourceSlug))
    } else {
      navigate(routes.view.sourcesLocal(preset.sourceSlug))
    }
  }, [])

  const remove = async (secretName: string) => {
    if (!activeWorkspaceId) {
      toast.error('Select an active workspace before deleting secrets')
      return
    }
    try {
      const result = await window.electronAPI.deleteSecret(secretName, activeWorkspaceId)
      if (!result.success) {
        toast.error(result.error || 'Could not delete secret')
        return
      }
      toast.success('Secret deleted')
      await load()
    } catch (error) {
      toast.error('Could not delete secret', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const installZero = async () => {
    if (!activeWorkspaceId) return
    setInstalling(true)
    try {
      const result = await window.electronAPI.installZero(activeWorkspaceId)
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

  const initZero = async () => {
    if (!activeWorkspaceId) return
    setZeroAction('init')
    try {
      const result = await window.electronAPI.initZero(activeWorkspaceId)
      if (!result.success) {
        toast.error(result.error || 'Zero init failed')
        return
      }
      await load()
      toast.success(result.output?.includes('Wallet created') ? 'Zero wallet created' : 'Zero CLI setup complete')
    } finally {
      setZeroAction(null)
    }
  }

  const fundZero = async () => {
    if (!activeWorkspaceId) return
    setZeroAction('fund')
    try {
      const result = await window.electronAPI.fundZero(activeWorkspaceId)
      if (!result.success) {
        toast.error(result.error || 'Could not create Zero funding link')
        return
      }
      if (result.fundingUrl) {
        await window.electronAPI.openUrl(result.fundingUrl)
        toast.success('Opened Zero funding link')
      } else {
        toast.info(result.output || 'Zero funding command finished')
      }
      await load()
    } finally {
      setZeroAction(null)
    }
  }

  const claimZeroWelcome = async () => {
    if (!activeWorkspaceId) return
    setZeroAction('welcome')
    try {
      const result = await window.electronAPI.claimZeroWelcome(activeWorkspaceId)
      if (!result.success) {
        toast.error(result.error || 'Could not claim Zero welcome bonus')
        return
      }
      toast.success(result.output || 'Zero welcome bonus claimed')
      await load()
    } finally {
      setZeroAction(null)
    }
  }

  const saveService = async (service: SecretService) => {
    const presets = service.presetNames.map((name) => PRESET_BY_NAME.get(name)).filter(Boolean) as SecretPreset[]
    const managedPreset = presets.find((preset) => preset.storage === 'managed-source')
    const changedPresets = presets.filter((preset) => draftValues[preset.name]?.trim())
    if (managedPreset) {
      openSource(managedPreset)
      return
    }

    const missing = missingRequiredPresets(service, savedByName, sourceBySlug, draftValues)
    const unsavedRequired = missing.filter((preset) => !draftValues[preset.name]?.trim())
    if (unsavedRequired.length > 0) {
      toast.error(`Add ${unsavedRequired[0]!.label} first`)
      return
    }
    if (changedPresets.length === 0) {
      toast.info(serviceStatus(service, savedByName, sourceBySlug, draftValues) === 'optional' ? 'Paste a key first.' : 'Nothing new to save.')
      return
    }

    setBusyServiceId(service.id)
    try {
      for (const preset of presets) {
        const value = draftValues[preset.name]?.trim()
        if (!value) continue

        if (preset.storage === 'source') {
          if (!activeWorkspaceId || !preset.sourceSlug) {
            toast.error('Select an active workspace before saving this connection')
            return
          }
          await window.electronAPI.saveSourceCredentials(activeWorkspaceId, preset.sourceSlug, value)
        } else if (preset.storage === 'env') {
          if (!activeWorkspaceId) {
            toast.error('Select an active workspace before saving secrets')
            return
          }
          const result = await window.electronAPI.saveSecret(preset.name, value, activeWorkspaceId)
          if (!result.success) {
            toast.error(result.error || `Could not save ${preset.label}`)
            return
          }
        }
      }

      setDraftValues((current) => {
        const next = { ...current }
        for (const preset of presets) delete next[preset.name]
        return next
      })
      setExpandedServiceId(null)
      toast.success(`${service.title} saved`)
      await load()
    } catch (error) {
      toast.error(`Could not save ${service.title}`, {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusyServiceId(null)
    }
  }

  const testService = async (service: SecretService) => {
    if (!activeWorkspaceId) {
      toast.error('Select an active workspace before testing this connection')
      return
    }
    const missing = missingRequiredPresets(service, savedByName, sourceBySlug, draftValues)
    if (missing.length > 0) {
      toast.error(`${service.title} is missing ${missing[0]!.label}`)
      return
    }
    if (serviceStatus(service, savedByName, sourceBySlug, draftValues) === 'optional') {
      toast.info(`${service.title} is optional. Add a key when a workflow needs it.`)
      return
    }
    const managedPreset = service.presetNames
      .map((name) => PRESET_BY_NAME.get(name))
      .find((preset) => preset?.storage === 'managed-source')
    if (managedPreset?.sourceSlug) {
      if (!activeWorkspaceId) {
        toast.error('Select an active workspace before testing this connection')
        return
      }
      setBusyServiceId(service.id)
      try {
        const result = await window.electronAPI.getMcpTools(activeWorkspaceId, managedPreset.sourceSlug)
        if (!result.success) {
          toast.error(result.error || `${service.title} connection failed`)
          return
        }
        toast.success(`${service.title} connected · ${result.tools?.length ?? 0} tools available`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `${service.title} connection failed`)
      } finally {
        setBusyServiceId(null)
      }
      return
    }
    if (service.id === 'google-workspace') {
      toast.info('Google OAuth app keys are saved. Verify the signed-in Google account from its connected source or Calendar settings.')
      return
    }
    if (service.id === 'genius') {
      setBusyServiceId(service.id)
      try {
        const result = await window.electronAPI.testGeniusAccessToken(activeWorkspaceId, draftValues.GENIUS_ACCESS_TOKEN?.trim())
        if (!result.success) {
          toast.error(result.error || 'Genius token test failed')
          return
        }
        toast.success(`Genius connected${typeof result.hits === 'number' ? ` · ${result.hits} search hits` : ''}`)
      } finally {
        setBusyServiceId(null)
      }
      return
    }
    toast.success(`${service.title} setup looks ready`)
  }

  if (canManageSecrets !== true) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader />
        <div className="mx-auto flex w-full max-w-2xl flex-1 items-center px-6 py-10">
          <SettingsCard className="w-full">
            <div className="p-6">
              <h1 className="text-lg font-semibold text-white">{canManageSecrets === null ? 'Checking access…' : 'Owner access required'}</h1>
              <p className="mt-2 text-sm leading-6 text-white/48">
                {canManageSecrets === null ? 'Keys and connected services stay hidden until access is verified.' : accessMessage}
              </p>
            </div>
          </SettingsCard>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[1600px] space-y-2 px-6 pb-8 pt-2">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-2 h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>

          <SettingsSection
            title="Services"
          >
            <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
              <SettingsCard className="self-start">
                <div className="space-y-1 p-2">
                  {SECRET_GROUPS.map((group) => {
                    const groupServices = SERVICES.filter((service) => service.group === group)
                    const readyCount = groupServices.filter((service) => (
                      service.id === 'google-workspace'
                        ? gmailScope?.hasEffectiveCredential === true
                        : serviceStatus(service, savedByName, sourceBySlug, draftValues) === 'ready'
                    )).length
                    return (
                      <button
                        key={group}
                        type="button"
                        onClick={() => setSelectedGroup(group)}
                        className={[
                          'flex w-full items-center justify-between rounded-[12px] px-3 py-2 text-left text-sm transition-colors',
                          selectedGroup === group ? 'bg-white/[0.075] text-white' : 'text-white/58 hover:bg-white/[0.045] hover:text-white/82',
                        ].join(' ')}
                      >
                        <span>{group}</span>
                        <span className="text-[11px] text-white/34">{readyCount}/{groupServices.length}</span>
                      </button>
                    )
                  })}
                </div>
              </SettingsCard>

              <div className="space-y-3">
                {services.map((service) => {
                  const presets = service.presetNames.map((name) => PRESET_BY_NAME.get(name)).filter(Boolean) as SecretPreset[]
                  const status = service.id === 'google-workspace'
                    ? gmailScope?.hasEffectiveCredential ? 'ready' : 'needs'
                    : serviceStatus(service, savedByName, sourceBySlug, draftValues)
                  const managedPreset = presets.find((preset) => preset.storage === 'managed-source')
                  const busy = busyServiceId === service.id
                  const expanded = service.id !== 'google-workspace' && expandedServiceId === service.id
                  const zeroPrivateKeyPreset = presets.find((preset) => preset.name === 'ZERO_PRIVATE_KEY')
                  return (
                    <SettingsCard key={service.id} className="!border-0 shadow-none">
                      <div className="p-3">
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-semibold text-white/90">{service.title}</h3>
                              {service.id !== 'zero' && (
                                <StatusIcon status={status} serviceId={service.id} />
                              )}
                            </div>
                            <p className="mt-1 line-clamp-1 max-w-3xl text-xs leading-4 text-white/38">{service.description}</p>
                          </div>
                          {service.id === 'google-workspace' ? null : managedPreset ? (
                            <div className="flex shrink-0 items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void testService(service)}
                                disabled={busy || status !== 'ready'}
                                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-white/[0.065] bg-white/[0.025] px-2.5 text-xs font-medium text-white/52 transition-colors hover:bg-white/[0.055] hover:text-white/76 disabled:cursor-not-allowed disabled:opacity-35"
                              >
                                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                                Test
                              </button>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => openSource(managedPreset)}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-white/[0.065] bg-white/[0.035] px-2.5 text-xs font-medium text-white/52 transition-colors hover:bg-white/[0.055] hover:text-white/76"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    {managedPreset.setupLabel ?? 'Open source'}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-[260px] text-xs">
                                  {managedPreset.description}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          ) : service.id !== 'zero' ? (
                            <button
                              type="button"
                              onClick={() => setExpandedServiceId(expanded ? null : service.id)}
                              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-white/[0.065] bg-white/[0.035] px-2.5 text-xs font-medium text-white/52 transition-colors hover:bg-white/[0.055] hover:text-white/76"
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                              {status === 'ready' ? 'Keys' : 'Add key'}
                              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                            </button>
                          ) : null}
                        </div>

                        {service.id === 'google-workspace' ? (
                          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-white/[0.025] px-4 py-3">
                            {gmailScope?.hasEffectiveCredential ? (
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-400/12 text-emerald-300">
                                  <CheckCircle2 className="h-4 w-4" />
                                </span>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-emerald-200">You're connected</p>
                                  {gmailScope.metadata?.accountEmail ? (
                                    <p className="truncate text-xs text-white/42">{gmailScope.metadata.accountEmail}</p>
                                  ) : null}
                                </div>
                              </div>
                            ) : (
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-white/52">Connect once, then Artist OS can use Gmail when you ask.</p>
                                {gmailConnectionError ? (
                                  <p className="mt-1.5 text-xs leading-5 text-amber-300/80">{gmailConnectionError}</p>
                                ) : null}
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              {gmailScope?.hasEffectiveCredential ? (
                                <button
                                  type="button"
                                  onClick={() => void disconnectGmail()}
                                  disabled={busy}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-xs font-medium text-white/42 transition-colors hover:bg-white/[0.045] hover:text-white/70 disabled:opacity-50"
                                >
                                  <LogOut className="h-3.5 w-3.5" />
                                  Disconnect
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void connectGmail()}
                                  disabled={busy}
                                  className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/90 disabled:opacity-40"
                                >
                                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                                  Connect Google
                                </button>
                              )}
                            </div>
                          </div>
                        ) : service.id === 'zero' ? (
                          <div className="mt-4 space-y-3">
                            <div className="rounded-[12px] border border-white/[0.06] bg-black/20 p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 text-sm font-medium">
                                    <WalletCards className="h-4 w-4 text-white/50" />
                                    <span>Zero Installation</span>
                                    {zero?.installed ? (
                                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400/80" />
                                    ) : (
                                      <AlertCircle className="h-3.5 w-3.5 text-amber-400/80" />
                                    )}
                                  </div>
                                  <div className="mt-2 grid gap-1 text-xs text-white/45">
                                    <span>{zero?.installed ? `Installed${zero.version ? ` · ${zero.version}` : ''}` : 'Not installed'}</span>
                                    {zero?.path && <span className="truncate font-mono text-[10px]">{zero.path}</span>}
                                    <span>{zero?.walletConfigured ? 'Wallet ready' : 'Wallet missing'}</span>
                                    {zero?.balance && <span className="truncate">{zero.balance}</span>}
                                    {zero?.error && <span className="text-amber-300/80">{zero.error}</span>}
                                  </div>
                                </div>
                                <div className="flex shrink-0 flex-col gap-2">
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
                            </div>
                            <div className="grid gap-2 sm:grid-cols-3">
                              <button
                                type="button"
                                onClick={initZero}
                                disabled={!zero?.installed || zeroAction !== null}
                                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-white/[0.08] px-3 text-xs font-medium text-white/76 transition-colors hover:bg-white/[0.12] disabled:opacity-50"
                              >
                                {zeroAction === 'init' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WalletCards className="h-3.5 w-3.5" />}
                                Setup CLI
                              </button>
                              <button
                                type="button"
                                onClick={fundZero}
                                disabled={!zero?.installed || !zero?.walletConfigured || zeroAction !== null}
                                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] border border-white/[0.06] bg-white/[0.025] px-3 text-xs font-medium text-white/52 transition-colors hover:bg-white/[0.045] hover:text-white/74 disabled:opacity-50"
                              >
                                {zeroAction === 'fund' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                                Fund wallet
                              </button>
                              <button
                                type="button"
                                onClick={claimZeroWelcome}
                                disabled={!zero?.installed || !zero?.walletConfigured || zeroAction !== null}
                                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] border border-white/[0.06] bg-white/[0.025] px-3 text-xs font-medium text-white/52 transition-colors hover:bg-white/[0.045] hover:text-white/74 disabled:opacity-50"
                              >
                                {zeroAction === 'welcome' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                Claim welcome
                              </button>
                            </div>
                            {zeroPrivateKeyPreset ? (
                              <div className="rounded-[10px] border border-white/[0.055] bg-black/20 p-3">
                                <button
                                  type="button"
                                  onClick={() => setZeroImportOpen((open) => !open)}
                                  className="flex w-full items-center justify-between gap-3 text-left"
                                >
                                  <span className="text-xs font-medium text-white/70">Import wallet private key instead</span>
                                  <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-white/26">
                                    {savedByName.has(zeroPrivateKeyPreset.name) ? 'Saved' : 'Optional'}
                                  </span>
                                  <ChevronDown className={`h-3.5 w-3.5 text-white/38 transition-transform ${zeroImportOpen ? 'rotate-180' : ''}`} />
                                </button>
                                <AnimateServiceFields open={zeroImportOpen}>
                                  <div className="flex gap-2">
                                    <input
                                      value={draftValues[zeroPrivateKeyPreset.name] ?? ''}
                                      onChange={(event) => setDraftValues((current) => ({ ...current, [zeroPrivateKeyPreset.name]: event.target.value }))}
                                      placeholder={savedByName.has(zeroPrivateKeyPreset.name) ? savedPlaceholder(zeroPrivateKeyPreset, savedByName) : zeroPrivateKeyPreset.placeholder}
                                      type="password"
                                      className="h-8 min-w-0 flex-1 rounded-[9px] border border-white/[0.07] bg-white/[0.02] px-3 text-sm text-white/82 outline-none placeholder:text-white/22 focus:border-[#fb923c]/45"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => saveService(service)}
                                      disabled={busy || !draftValues[zeroPrivateKeyPreset.name]?.trim()}
                                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] bg-white/[0.08] px-3 text-xs font-medium text-white/76 transition-colors hover:bg-white/[0.12] disabled:opacity-50"
                                    >
                                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                      Import
                                    </button>
                                  </div>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button type="button" className="mt-2 text-left text-[11px] leading-4 text-white/30 transition-colors hover:text-white/52">
                                        Guide
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-[280px] text-xs">
                                      {zeroPrivateKeyPreset.description}
                                    </TooltipContent>
                                  </Tooltip>
                                </AnimateServiceFields>
                              </div>
                            ) : null}
                          </div>
                        ) : managedPreset ? null : (
                          <AnimateServiceFields open={expanded}>
                            <div className="grid gap-3 md:grid-cols-2">
                              {presets.map((preset) => {
                                const saved = presetIsSaved(preset, savedByName, sourceBySlug)
                                const optional = service.optionalPresetNames?.includes(preset.name)
                                return (
                                  <div key={preset.name} className="rounded-[10px] border border-white/[0.055] bg-black/20 p-3">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                      <label className="text-xs font-medium text-white/70">{preset.label}</label>
                                      <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-white/26">
                                        {optional ? 'Optional' : saved ? 'Saved' : 'Required'}
                                      </span>
                                    </div>
                                    {preset.inputType === 'select' ? (
                                      <select
                                        value={draftValues[preset.name] ?? ''}
                                        onChange={(event) => setDraftValues((current) => ({ ...current, [preset.name]: event.target.value }))}
                                        className="h-8 w-full rounded-[9px] border border-white/[0.07] bg-white/[0.02] px-3 text-sm text-white/82 outline-none focus:border-[#fb923c]/45"
                                      >
                                        <option value="">{saved ? 'Keep saved setting' : preset.placeholder ?? 'Choose'}</option>
                                        {preset.options?.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <input
                                        value={draftValues[preset.name] ?? ''}
                                        onChange={(event) => setDraftValues((current) => ({ ...current, [preset.name]: event.target.value }))}
                                        placeholder={saved ? savedPlaceholder(preset, savedByName) : preset.placeholder ?? 'Paste key'}
                                        type={preset.inputType ?? (preset.name.includes('DOMAIN') || preset.name.includes('URL') || preset.name.includes('URI') || preset.name.includes('VERSION') || preset.name.includes('ID') ? 'text' : 'password')}
                                        className="h-8 w-full rounded-[9px] border border-white/[0.07] bg-white/[0.02] px-3 text-sm text-white/82 outline-none placeholder:text-white/22 focus:border-[#fb923c]/45"
                                      />
                                    )}
                                    <div className="mt-2 flex items-center gap-3">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <button type="button" className="text-left text-[11px] leading-4 text-white/30 transition-colors hover:text-white/52">
                                            Guide
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-[280px] text-xs">
                                          {preset.description}
                                        </TooltipContent>
                                      </Tooltip>
                                      {preset.setupUrl ? (
                                        <button
                                          type="button"
                                          onClick={() => void window.electronAPI.openUrl(preset.setupUrl!)}
                                          className="inline-flex items-center gap-1 text-[11px] leading-4 text-white/30 transition-colors hover:text-white/60"
                                        >
                                          {preset.setupLabel ?? 'Open setup'}
                                          <ExternalLink className="h-3 w-3" />
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => saveService(service)}
                                disabled={busy}
                                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-white/[0.08] px-3 text-xs font-medium text-white/76 transition-colors hover:bg-white/[0.12] disabled:opacity-50"
                              >
                                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => void testService(service)}
                                disabled={busy}
                                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-white/[0.06] bg-white/[0.025] px-3 text-xs font-medium text-white/48 transition-colors hover:bg-white/[0.045] hover:text-white/70 disabled:opacity-50"
                              >
                                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                Test
                              </button>
                            </div>
                          </AnimateServiceFields>
                        )}
                      </div>
                    </SettingsCard>
                  )
                })}
              </div>
            </div>
            </SettingsSection>

            <SettingsCard className="mt-8 overflow-hidden">
              <button
                type="button"
                onClick={() => setSavedSecretsOpen((open) => !open)}
                aria-expanded={savedSecretsOpen}
                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-white/[0.025]"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-white/38" />
                  <span className="text-sm font-medium text-white/68">Saved secrets</span>
                  <span className="text-xs text-white/30">{secrets.length}</span>
                </div>
                <ChevronDown className={`h-4 w-4 shrink-0 text-white/34 transition-transform ${savedSecretsOpen ? 'rotate-180' : ''}`} />
              </button>
              {savedSecretsOpen ? (
                <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
                  {secrets.length === 0 ? (
                    <div className="p-4 text-sm text-white/38">No secrets saved.</div>
                  ) : secrets.map((secret) => (
                    <div key={secret.name} className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-white/[0.015]">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium text-white/74">
                          <span className="truncate">{secret.name}</span>
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400/80" />
                        </div>
                        <div className="mt-1 font-mono text-xs text-white/35">{secret.maskedValue}</div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => remove(secret.name)} className="hover:bg-red-500/10 hover:text-red-400">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </SettingsCard>
          </div>
        </ScrollArea>
    </div>
  )
}

function AnimateServiceFields({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={`overflow-hidden transition-all duration-150 ${open ? 'mt-3 max-h-[900px] opacity-100' : 'max-h-0 opacity-0'}`}>
      {children}
    </div>
  )
}

function StatusIcon({ status, serviceId }: { status: ServiceStatus; serviceId: string }) {
  const ready = status === 'ready'
  const optional = status === 'optional'
  const label = serviceId === 'google-workspace' && ready ? 'Keys saved' : ready ? 'Ready' : optional ? 'Optional' : 'Needs key'
  const icon = ready ? (
    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400/70" />
  ) : optional ? (
    <Info className="h-3.5 w-3.5 text-white/28" />
  ) : (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.07] text-[12px] font-semibold leading-none text-red-300/80">!</span>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full">
          {icon}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

function savedPlaceholder(preset: SecretPreset, savedByName: Map<string, UserSecretSummary>) {
  return savedByName.get(preset.name)?.maskedValue ?? preset.placeholder ?? 'Saved'
}

function serviceStatus(
  service: SecretService,
  savedByName: Map<string, UserSecretSummary>,
  sourceBySlug: Map<string, LoadedSource>,
  draftValues: Record<string, string>,
): ServiceStatus {
  const required = requiredPresets(service)
  if (required.length === 0 && !serviceHasAnyCredential(service, savedByName, sourceBySlug, draftValues)) return 'optional'
  return missingRequiredPresets(service, savedByName, sourceBySlug, draftValues).length === 0 ? 'ready' : 'needs'
}

function missingRequiredPresets(
  service: SecretService,
  savedByName: Map<string, UserSecretSummary>,
  sourceBySlug: Map<string, LoadedSource>,
  draftValues: Record<string, string>,
) {
  const missing = requiredPresets(service)
    .filter((preset) => !presetIsSaved(preset, savedByName, sourceBySlug) && !draftValues[preset.name]?.trim())
  const anyRequired = service.requiredAnyPresetNames
    ?.map((name) => PRESET_BY_NAME.get(name))
    .filter((preset): preset is SecretPreset => Boolean(preset)) ?? []

  if (
    anyRequired.length > 0
    && !anyRequired.some((preset) => presetIsSaved(preset, savedByName, sourceBySlug) || Boolean(draftValues[preset.name]?.trim()))
  ) {
    missing.push(anyRequired[0]!)
  }

  return missing
}

function requiredPresets(service: SecretService) {
  return service.presetNames
    .map((name) => PRESET_BY_NAME.get(name))
    .filter((preset): preset is SecretPreset => Boolean(preset))
    .filter((preset) => !service.requiredAnyPresetNames?.includes(preset.name))
    .filter((preset) => !service.optionalPresetNames?.includes(preset.name))
}

function serviceHasAnyCredential(
  service: SecretService,
  savedByName: Map<string, UserSecretSummary>,
  sourceBySlug: Map<string, LoadedSource>,
  draftValues: Record<string, string>,
) {
  return service.presetNames
    .map((name) => PRESET_BY_NAME.get(name))
    .filter((preset): preset is SecretPreset => Boolean(preset))
    .some((preset) => presetIsSaved(preset, savedByName, sourceBySlug) || Boolean(draftValues[preset.name]?.trim()))
}

function presetIsSaved(
  preset: SecretPreset,
  savedByName: Map<string, UserSecretSummary>,
  sourceBySlug: Map<string, LoadedSource>,
) {
  if (preset.storage === 'env') return savedByName.has(preset.name)
  if (!preset.sourceSlug) return false
  const source = sourceBySlug.get(preset.sourceSlug)
  return Boolean(source && (sourceIsUsable(source) || source.config.connectionStatus === 'untested'))
}

function sourceIsUsable(source: LoadedSource): boolean {
  if (!source.config.enabled) return false
  const authType = source.config.mcp?.authType || source.config.api?.authType
  if (authType === 'none' || authType === undefined) return true
  return source.config.connectionStatus === 'connected'
}
