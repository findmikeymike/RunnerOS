---
status: draft
owner: product
last_verified: 2026-07-05
source_of_truth: false
---

# Service Keys

Some workers need outside accounts or API keys. You do not need all of these on day one. Add only what you plan to use.

Never paste secrets into normal chat or workspace notes. Use Settings/Connections or Setup Concierge when the app provides a save path.

Setup Concierge can save approved keys into RunnerOS encrypted credential storage. For most users, keys should be app/global credentials so the same services work across HQ and every campaign workspace. Use workspace-specific overrides only when one workspace must use a different account or key.

## LLM Providers

Use these for model access.

| Service | Used for | Where to get key |
| --- | --- | --- |
| OpenAI | GPT models, structured outputs, realtime/voice-capable flows | [OpenAI API keys](https://platform.openai.com/api-keys) |
| Anthropic / Claude | Claude model access | [Claude Console](https://platform.claude.com/) |
| Google Gemini | Gemini model access | [Google AI Studio API keys](https://aistudio.google.com/app/apikey), [Google guide](https://ai.google.dev/gemini-api/docs/api-key) |
| OpenRouter | many models through one key | [OpenRouter keys](https://openrouter.ai/keys) |
| Mistral | Mistral models | [Mistral Console](https://console.mistral.ai/) |
| Kimi / Moonshot | Kimi models | [Moonshot platform](https://platform.moonshot.ai/) |
| AWS Bedrock | AWS-hosted models | [AWS Bedrock console](https://console.aws.amazon.com/bedrock/) |
| Ollama | local models, no cloud key | [Ollama](https://ollama.com/) |

Note: a ChatGPT/Claude/Gemini web subscription is usually not the same as API access.

## Creative Generation

Use these for image, video, audio, and creative assets.

Save image/video provider keys under **Settings -> Connections -> AI + Media -> Media Generation**. These are shared app credentials, so Art Director, Content Genius, Video workers, and future creative agents can use the same connected services across HQ and campaign workspaces.

| Service | Used for | Where to get key |
| --- | --- | --- |
| Fal (`FAL_API_KEY`) | image/video/audio/3D model APIs | [Fal authentication docs](https://fal.ai/docs/api-reference/platform-apis/authentication) |
| Replicate (`REPLICATE_API_TOKEN`) | model-specific image/video generation and editing | [Replicate HTTP API docs](https://replicate.com/docs/reference/http) |
| WaveSpeed (`WAVESPEED_API_KEY`) | fast image/video generation APIs | [WaveSpeed authentication docs](https://wavespeed.ai/docs/docs-authentication) |
| Inworld | character/voice/interactive AI services, if enabled | [Inworld API key docs](https://docs.inworld.ai/quickstart-tts) |
| ElevenLabs | voice/TTS/SFX, if enabled | [ElevenLabs API authentication](https://elevenlabs.io/docs/api-reference/authentication) |
| HeyGen (`HEYGEN_API_KEY`) | avatar/video generation, if enabled | [HeyGen API key docs](https://developers.heygen.com/docs/api-key) |

Older local builds may show `SQUAD_*` media keys. Treat those as legacy aliases. Prefer the shared names above for anything new.

Optional provider defaults live in the same Media Generation card:

- `MEDIA_IMAGE_PROVIDER`: `auto`, `fal`, `replicate`, or `wavespeed`.
- `MEDIA_VIDEO_PROVIDER`: `auto`, `fal`, `replicate`, or `wavespeed`.
- `MEDIA_PROVIDER_STRATEGY`: `balanced`, `speed`, `quality`, or `cost`.

Use `auto`/`balanced` unless you have a strong preference. If you ask for a specific provider in chat, that overrides the default.

## Google Workspace

Use these for Gmail, Calendar, Drive, YouTube, and Google Ads features.

| Service | Used for | Where to set up |
| --- | --- | --- |
| Google OAuth / Workspace | Gmail, Calendar, Drive account connection | [Create Google credentials](https://developers.google.com/workspace/guides/create-credentials) |
| Google Cloud API key | Google cloud APIs when a key is required | [Manage Google API keys](https://docs.cloud.google.com/docs/authentication/api-keys) |
| YouTube Data API | YouTube research/upload-adjacent workflows, if enabled | [YouTube Data API docs](https://developers.google.com/youtube/v3) |
| Google Ads | Ads Agent reporting/planning | [Google Ads API center](https://ads.google.com/aw/apicenter) |

For Gmail/Drive/Calendar, OAuth is usually better than pasting raw tokens.

For Runner's Google sources, make sure the matching Google Cloud APIs are enabled: Gmail API, Google Calendar API, and Google Drive API. Source/API paths should resolve through `https://www.googleapis.com/...`; old direct hosts like `drive.googleapis.com/drive/v3` and `calendar.googleapis.com/calendar/v3` can return misleading 404s.

## Social / Publishing / Ads

Use these for posting, account reads, and paid media.

| Service | Used for | Where to get access |
| --- | --- | --- |
| Meta / Facebook / Instagram | Meta Ads, pages, Instagram-connected work | [Meta access tokens](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens) |
| WhatsApp Business | WhatsApp messaging gateway, if enabled | [WhatsApp access tokens](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens) |
| TikTok | TikTok posting/research paths, if enabled | [TikTok for Developers](https://developers.tiktok.com/) |
| X / Twitter | X posting/research paths, if enabled | [X Developer Portal](https://developer.x.com/) |

Social publishing should always show the exact account/profile and ask before live posting.

## Email / Outreach

| Service | Used for | Where to get key |
| --- | --- | --- |
| Gmail | drafts, sends, thread lookup through Google account | [Google Workspace credentials](https://developers.google.com/workspace/guides/create-credentials) |
| Resend | sending transactional or campaign-style email through API | [Resend API keys](https://resend.com/docs/dashboard/api-keys/introduction) |

For outreach, drafts are safer than direct sends until the user approves the exact message.

## Commerce / Merch

| Service | Used for | Where to get access |
| --- | --- | --- |
| Shopify | store, products, listings, admin work | [Shopify Admin API tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin) |
| Printify | print-on-demand product drafts | [Printify API docs](https://developers.printify.com/), [API token help](https://help.printify.com/hc/en-us/sections/4471760080657-Printify-API) |

Commerce actions should create drafts/approval packets before changing a live store.

## Key Safety

Do:
- use restricted keys when possible
- name keys by app/workspace
- save keys through Settings/Connections or Setup Concierge
- rotate keys if exposed
- delete keys you no longer use
- keep billing limits/alerts on

Do not:
- paste keys into ordinary chat or docs
- store secrets in campaign notes
- commit keys into files
- share keys between unrelated clients/accounts

## Setup Order For Most Users

Start small:

1. One LLM provider.
2. Google Workspace if you need Gmail/Calendar/Drive.
3. Social/profile browser sessions if you publish.
4. Fal, Replicate, WaveSpeed, or another Media Generation provider if you create media.
5. Shopify/Printify only if you run commerce.

If a worker says a key/source is missing, add only that one.
