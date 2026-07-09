---
status: current
owner: agent
last_verified: 2026-07-09
source_of_truth: true
---

# Runner System Map

Generated: 2026-07-09

## Why This Exists

This map captures Runner-specific wiring that future agents often miss: worker visibility, skill/source bundles, approval mode, trusted tools, Canvas awareness, context injection, and launch surfaces.

## Source Files

- starterAgents: `packages/shared/src/agent-definitions/starter-templates.ts`
- agentTypes: `packages/shared/src/agent-definitions/types.ts`
- systemSkills: `packages/shared/src/skills/system.ts`
- starterSkills: `packages/shared/src/skills/starter-templates.ts`
- workersLaunchpad: `apps/electron/src/renderer/components/app-shell/AgentsLaunchpad.tsx`
- workerDefaults: `apps/electron/src/renderer/lib/worker-defaults.ts`
- runAgent: `apps/electron/src/renderer/lib/run-agent.ts`
- composeAgentPrompt: `apps/electron/src/renderer/lib/compose-agent-prompt.ts`
- sessionManager: `packages/server-core/src/sessions/SessionManager.ts`
- sharedIntelHandler: `packages/server-core/src/handlers/rpc/shared-intel.ts`
- sharedIntelRouter: `packages/shared/src/shared-intel/router.ts`
- sharedIntelTypes: `packages/shared/src/shared-intel/types.ts`
- sessionTools: `packages/session-tools-core/src/tool-defs.ts`
- outputFinals: `packages/shared/src/outputs/finals.ts`
- outputService: `packages/server-core/src/outputs/OutputService.ts`
- outputsHook: `apps/electron/src/renderer/hooks/useOutputs.ts`
- outputFinalActionDialog: `apps/electron/src/renderer/components/outputs/OutputFinalActionDialog.tsx`
- bundledSkills: `packages/shared/src/skills/bundled.generated.ts`
- builtinSources: `packages/shared/src/sources/builtin-sources.ts`
- starterWorkflows: `packages/shared/src/workflows/starter-templates.ts`

## Summary

- Agents mapped: 39
- Hidden from Workers home: 5
- Campaign default workers: `branding-agent`, `world-builder`, `college-radio-agent`, `spotify-playlist-creator`, `content-genius`, `scroll-stopper`, `art-director`, `ad-creative-agent`, `ads-strategist`, `ads-agent`, `ig-trending-power-up`, `influencer-campaign-power-up`, `playlisting-power-up`, `record-doctor`, `industry-hunter`
- Starter workflows mapped: 2
- Shared Intel prompt injection: wired
- Outputs -> Finals promotion: wired
- Domains: Command 3, Content Creation 6, Creative 5, Merch 2, Operators 2, Other Workers 2, Outreach 5, Promotion 9, Research 3, Socials 2
- Permission modes: ask 32, safe 7
- Known skills: 121 (78 bundled, 6 system, 121 user-global on this machine)
- Known builtin sources: 25

## Reference Health

- All mapped starter-agent skill/source references resolve to repo-bundled/system skills or builtin sources.

## Runtime Rules Agents Should Not Miss

- Saved agents live in the global library and are activated per workspace.
- Workers page shows active agents, except system agents and hidden worker-home slugs.
- Artist HQ default workers are currently branding-agent, world-builder, college-radio-agent, spotify-playlist-creator.
- Campaign default workers are currently branding-agent, world-builder, college-radio-agent, spotify-playlist-creator, content-genius, scroll-stopper, art-director, ad-creative-agent, ads-strategist, ads-agent, ig-trending-power-up, influencer-campaign-power-up, playlisting-power-up, record-doctor, industry-hunter.
- run-agent drops missing skills/sources before session creation and includes a launch receipt.
- Concierge receives broad workspace context and an active-agent capability catalog for routing.
- Share Intel writes targeted workspace context docs, then the central prompt composer injects them as a dedicated Shared Intel section at agent launch.
- Specialist agents do not need individual prompt edits for Shared Intel; they see only the routed docs selected for their slug. Concierge/HNIC can see all enabled context docs through its existing override.
- Outputs become Finals through UI actions or the promote_output_to_final session tool; Finals are pointers to existing Output bundles, not copied assets.
- Finals writes use a workspace filesystem lock under context/.locks/output-finals.lock; campaign Finals require campaignId and source Outputs cannot be deleted while still referenced.
- message_agent/spawn_session cannot exceed parent permission mode; external actions still need user approval.
- trustedWorkerTools are for bounded internal work only, not sends/posts/publishing.

## Shared Intel Awareness

- User action: chat `Share Intel` calls the shared-intel RPC for the current workspace/session.
- Router action: the backend reads recent session messages, scores durable nuggets, picks target agents from the active agent catalog, and upserts targeted workspace context docs.
- Storage: shared notes use the shared-intel context slug prefix and `routing: { mode: "targeted", agents: [...] }`.
- Agent launch: `loadActiveContextDocsForAgent` filters docs for the launched agent; Concierge/HNIC keeps the broad context override.
- Prompt delivery: `composeAgentSystemPrompt` and workflow prompt composition inject matching notes into a dedicated `Shared Intel for this worker:` section and remove them from generic workspace context to avoid duplicate/bloat.
- Practical result: agents know to check it because the runtime places the relevant notes in their system prompt at launch. Individual saved agent prompts do not need to be edited.

## Outputs -> Finals Promotion

- User action: Output list/detail actions open `OutputFinalActionDialog` for `Set as Final`, `Set as Primary`, or `Remove from Finals`.
- Agent action: `promote_output_to_final` is exposed through the session tool manifest and calls the same backend promotion path.
- Backend action: `OutputService.promoteToFinal` validates workspace ownership, then writes through shared Finals registry helpers.
- Storage: Finals live as JSON pointers in `context/finals/CONTEXT.md`; the Output bundle remains canonical.
- Safety: writes use `context/.locks/output-finals.lock`, corrupt registry data fails closed, campaign Finals require `campaignId`, and source Output deletion is blocked while referenced.
- Surfacing: HQ and campaign command-center widgets read Outputs with attached Final pointers; campaign widgets fail closed without a campaign id.

## Starter Workflows

### Weekly Content Pipeline (`weekly-content-pipeline`)

- Description: Research a topic, draft a post, critique it, revise, hand off for human approval.
- Trigger: `manual`; inputs: 3; steps: 4
- Agent refs: `critic`, `researcher`, `writer`
- Missing agent refs: none
- Step order: research -> @researcher; draft -> @writer; critique -> @critic; revise -> @writer

### Email Triage (`email-triage`)

- Description: Classify an email, decide on next action, optionally draft a reply.
- Trigger: `manual`; inputs: 3; steps: 2
- Agent refs: `triager`, `writer`
- Missing agent refs: none
- Step order: classify -> @triager; draft_reply -> @writer


## Workers By Domain

### Command

#### HNIC (`concierge`)

- Description: Main work chat. Routes goals to the right workers, skills, automations, and workflows.
- Permission: `safe`; thinking: `medium`
- Launch surfaces: `hq-sidebar-chat`, `campaign-sidebar-chat`, `system-agent-hidden-from-worker-home`
- Skills: `agent-creator`, `automation-creator`, `workflow-creator`, `source-recipe`
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `chat`, `guide`, `routing`, `workflows`, `automations`
- Signals: `agent-catalog-aware`, `artifact-output-aware`, `context-doc-aware`, `explicit-approval-required`, `external-action-boundary`, `memory-scope-instructions`, `safe-default`
- Inputs: Any goal, task, question, campaign need, automation idea, workflow idea, or worker-routing request.
- Outputs: A direct answer, worker handoff, queued-work plan, automation/workflow draft, or approval-gated next action.

#### Orchestrator (`orchestrator`)

- Description: Break a goal into steps and coordinate the right agents.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `system-agent-hidden-from-worker-home`
- Skills: `agent-creator`, `automation-creator`, `workflow-creator`, `source-recipe`
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `planning`, `coordination`, `multi-step`
- Signals: `approval-capable`, `artifact-output-aware`, `memory-scope-instructions`
- Inputs: A goal or outcome you want to achieve.
- Outputs: A step-by-step plan with named owners, plus the executed result.

#### Setup Concierge (`setup-concierge`)

- Description: Guides app setup, connections, keys, services, and “how do I use this?” questions.
- Permission: `ask`; thinking: `medium`
- Launch surfaces: `workspace-workers-when-active`
- Skills: `artist-os-guide`, `source-recipe`
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `setup`, `connections`, `keys`, `help`, `guide`, `command`
- Signals: `approval-capable`, `artifact-output-aware`, `explicit-approval-required`, `external-action-boundary`
- Inputs: A setup goal, pasted credential, app-feature question, broken connection, or “what do I do next?” request.
- Outputs: A guided setup step, saved-setting plan, connection test path, app explanation, or follow-up checklist.

### Content Creation

#### Hypermotion Agent (`hypermotion-agent`)

- Description: Create polished motion graphics, Spotify Canvas loops, captions, and social promos.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `hidden-from-workers-home`
- Skills: `hyperframes`, `spotify-canvas-video`
- Sources: `hypermotion`
- Optional sources: `media-generation`
- Trusted tools: none
- Tags: `creative`, `video`, `motion`, `spotify-canvas`, `hyperframes`, `remotion`
- Signals: `approval-capable`, `artifact-output-aware`, `canvas-visual-agent`, `external-action-boundary`, `optional-source-aware`, `requires-source-activation`
- Inputs: A motion/video brief, assets, target platform, duration, format, brand direction, or existing artifact to animate or render.
- Outputs: Canvas-ready HTML previews, Spotify Canvas loops, MP4 renders, poster frames, asset folders, render receipts, and clear next actions.

#### Lottie Animation Agent (`lottie-animation-agent`)

- Description: Create lightweight web and app animations.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `hidden-from-workers-home`
- Skills: none
- Sources: `lottie`
- Optional sources: none
- Trusted tools: none
- Tags: `creative`, `animation`, `lottie`, `motion`, `svg`, `visual`
- Signals: `approval-capable`, `artifact-output-aware`, `canvas-visual-agent`, `requires-source-activation`
- Inputs: A Lottie animation brief, SVG/path/image reference, timing direction, target platform, dimensions, FPS, duration, and desired editable controls.
- Outputs: A verified public/lottie.json animation, optional public/controls.json, preview URL, key-frame checks, and embed guidance for web, mobile, or app use.

#### Lyric Video (`lyric-video-agent`)

- Description: Creates single lyric clips from song audio, lyrics, image refs or visual assets, captions, and FFmpeg renders.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`
- Skills: `lyric-video-genesis`, `spotify-canvas-video`
- Sources: `genesis-lyric`, `lyrics-transcriber`
- Optional sources: `media-generation`, `raw-video-editor`, `video-studio`
- Trusted tools: none
- Tags: `creative`, `video`, `music`, `lyrics`, `captions`, `song-teaser`
- Signals: `approval-capable`, `artifact-output-aware`, `canvas-visual-agent`, `external-action-boundary`, `optional-source-aware`, `requires-source-activation`
- Inputs: Song audio, lyrics or timed lyric lines, visual source or image reference, platform/aspect ratio, duration, caption style, and output destination.
- Outputs: A single rendered MP4, render report, caption timing notes, and clear blockers when audio/lyrics/visuals are missing.

#### Raw Video Editor (`raw-video-editor`)

- Description: Edit existing raw footage into polished clips, reels, shorts, interviews, and social cutdowns.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`
- Skills: `raw-video-editor`
- Sources: `raw-video-editor`, `video-studio`
- Optional sources: none
- Trusted tools: none
- Tags: `creative`, `video`, `editing`, `raw-footage`, `captions`, `social`
- Signals: `approval-capable`, `artifact-output-aware`, `canvas-visual-agent`, `explicit-approval-required`, `external-action-boundary`, `requires-source-activation`
- Inputs: A folder of existing video/audio files, desired platform/aspect ratio, target runtime, pacing direction, must-keep moments, must-cut moments, caption style, and brand/editing notes.
- Outputs: An edit folder with inventory, packed transcript, EDL, preview/final MP4 paths, self-check notes, and clear limits when source media or transcription is missing.

#### Scroll Stopper (`scroll-stopper`)

- Description: Invents absurd, polarizing AI-video concepts with hard cover-shot direction and paste-ready vertical generation prompts.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`, `campaign-workers-default-visible`
- Skills: `scroll-stopper`
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `content`, `shortform`, `viral`, `ai-video`, `hooks`, `campaigns`
- Signals: `approval-capable`, `artifact-output-aware`, `external-action-boundary`
- Inputs: Campaign context, artist world, content lane, platform, niche, vibe, constraints, reference ideas, or a rough premise that needs to become a vertical AI-video concept.
- Outputs: Scroll-stopping short-form concepts with loglines, lever/setting/character/trigger tags, cover-shot art direction, safety notes, and ready-to-paste 9:16 AI-video prompts.

#### Video Editor Agent (`video-editor-agent`)

- Description: Assemble footage, captions, images, and audio into edited videos.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`
- Skills: none
- Sources: `video-studio`
- Optional sources: none
- Trusted tools: none
- Tags: `creative`, `video`, `editing`, `timeline`, `captions`, `visual`
- Signals: `approval-capable`, `artifact-output-aware`, `canvas-visual-agent`, `external-action-boundary`, `requires-source-activation`
- Inputs: A video brief, local media files, caption/transcript files, target platform, aspect ratio, duration, pacing direction, and export needs.
- Outputs: A valid .runner-video.json project, registered media, timeline clips, simple MP4 renders for video/image/audio/text timelines, placeholder export receipts, and clear render-limit notes.

### Creative

#### Art Director (`art-director`)

- Description: Create highly aesthetic single and album art, merch, posters, and campaign visuals.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`, `campaign-workers-default-visible`
- Skills: `artist-art-direction`, `artist-typography-taste`, `artist-visual-world-director`, `ad-creative`, `zero`
- Sources: none
- Optional sources: `media-generation`, `zero`
- Trusted tools: `artwork_compose`, `create_output`
- Tags: `creative`, `art-direction`, `album-art`, `merch`, `design`, `image-generation`, `visuals`
- Signals: `approval-capable`, `artifact-output-aware`, `canvas-visual-agent`, `explicit-approval-required`, `external-action-boundary`, `optional-source-aware`, `trusted-worker-tools`
- Inputs: Artist HQ Profile, Voice, Branding, themes, similar artists, music style, song/release notes, lyrics, references, approved artist photos and face references, cover/merch mode, format, and generation approval.
- Outputs: Taste-led visual concepts, style-lane recommendations, album/single art prompts, merch graphic specs, reference-image requirements, typography/layout direction, SVG/PNG artwork composition exports, Canvas-visible artifacts, anti-slop checks, and approved image-generation/layout briefs.

#### Content Genius (`content-genius`)

- Description: Plan short-form content ideas, then finish locked ideas with captions and overlays that command attention.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`, `campaign-workers-default-visible`
- Skills: `contentgenuis`, `captions-and-overlays`
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `creative`, `content`, `shortform`, `campaigns`, `copy`
- Signals: `approval-capable`, `external-action-boundary`
- Inputs: Campaign context, artist/profile voice, audience, platform, rough idea, clip notes, script, trend, post goal, or content pillar.
- Outputs: Short-form content concepts, hook angles, scene/opening ideas, caption hooks, on-screen text overlays, and native caption variants ready for approval or handoff.

#### Legendary Minds (`persona-agent`)

- Description: Pressure-test ideas through Kurt Cobain, David Bowie, Kanye West, Tom Ford, Jobs, and MrBeast lenses.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`
- Skills: `creative-oracle`, `steve-jobs-perspective`, `mrbeast-perspective`, `tom-ford`
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `creative`, `persona`, `brand`, `content`, `critique`, `strategy`
- Signals: `approval-capable`, `artifact-output-aware`
- Inputs: A product, brand, offer, script, video idea, campaign, deck, launch plan, or creative decision that needs a persona-led critique.
- Outputs: A persona-lens critique with the strongest verdicts, contradictions, recommended edits, and next creative move.

#### Record Doctor (`record-doctor`)

- Description: Submit a song for premium producer vetting, feedback, or enhancement by sending a clean approval-gated packet to mikeymikemusic@gmail.com.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`, `campaign-workers-default-visible`
- Skills: `record-doctor-handoff`, `artist-comms-strategist`
- Sources: none
- Optional sources: `gmail`
- Trusted tools: none
- Tags: `creative`, `producer`, `song-review`, `music`, `email`, `handoff`
- Signals: `approval-capable`, `artifact-output-aware`, `external-action-boundary`, `optional-source-aware`
- Inputs: Song file/link, artist name, song title, desired review goal, song notes, references, timeline, contact info, and approval to send.
- Outputs: A Record Doctor submission packet, producer email draft to mikeymikemusic@gmail.com, approval checklist, Gmail draft/send receipt when connected, or manual copy-paste packet.

#### World Builder (`world-builder`)

- Description: Design immersive low-budget release worlds fans can enter, built from the song's actual emotional world instead of generic promo tactics.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`, `hq-workers-default-visible`, `campaign-workers-default-visible`
- Skills: `world-immersion`, `artist-narrative-universe`, `artist-campaign-angle-builder`
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `campaigns`, `release`, `worldbuilding`, `fan-experience`, `creative-direction`
- Signals: `approval-capable`, `artifact-output-aware`
- Inputs: Song title, lyrics, demo/file/link, Artist HQ Profile, Voice, Branding, campaign brief, mood, visual world, release date, audience size, budget, and artist willingness to commit.
- Outputs: A song-world map, central immersive mechanic, anti-corny law check, spokes, rollout sequence, feasibility notes, and failure-mode de-risking.

### Merch

#### Print Agent (`print-agent`)

- Description: Turn artwork into print-on-demand merch plans and product drafts.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`
- Skills: `printify-commerce`, `print-product-assets`
- Sources: `printify`
- Optional sources: none
- Trusted tools: none
- Tags: `print`, `printify`, `pod`, `apparel`, `products`, `commerce`
- Signals: `approval-capable`, `artifact-output-aware`, `canvas-visual-agent`, `explicit-approval-required`, `external-action-boundary`, `requires-source-activation`
- Inputs: Image folders, artwork files, shirt/product ideas, Printify shop tasks, product batches, pricing, placement, catalog, upload, order, and fulfillment requests.
- Outputs: Asset inventories, product plans, placement specs, Printify manifests, upload/product approval packets, QA reports, receipts, and Canvas-ready previews.

#### Shopify Agent (`shopify-agent`)

- Description: Manage Shopify products, listings, inventory, and store updates.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`
- Skills: `shopify-commerce`
- Sources: `shopify`
- Optional sources: none
- Trusted tools: none
- Tags: `shopify`, `ecommerce`, `commerce`, `products`, `store-ops`
- Signals: `approval-capable`, `artifact-output-aware`, `canvas-visual-agent`, `external-action-boundary`, `requires-source-activation`
- Inputs: Shopify product, collection, inventory, order, customer, discount, listing copy, pricing, merchandising, or store-operation requests.
- Outputs: Store diagnostics, product/listing plans, draft mutations, approval packets, reports, receipts, and Canvas-ready artifacts.

### Operators

#### Coder (`coder`)

- Description: Writes, refactors, and debugs code with attention to convention.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`
- Skills: none
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `code`, `refactor`, `debug`
- Signals: `approval-capable`, `memory-scope-instructions`
- Inputs: A code change request, bug report, or codebase to modify.
- Outputs: Code edits matching the project's conventions, with tests and root-cause notes.

#### Update System Agent (`update-system-agent`)

- Description: Check installed tools, agents, and skills before updates.
- Permission: `safe`; thinking: `high`
- Launch surfaces: `system-agent-hidden-from-worker-home`
- Skills: none
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `updates`, `audit`, `tools`, `sources`, `maintenance`, `provenance`
- Signals: `artifact-output-aware`, `external-action-boundary`, `safe-default`
- Inputs: A request to check whether RunnerOS tools, agents, skills, sources, CLIs, packages, or integrations need updates or cleanup.
- Outputs: A short maintenance report with blockers, needs-review items, safe follow-ups, and exact next commands.

### Other Workers

#### Open Slide (`open-slide-agent`)

- Description: Create clean slide decks and export them to HTML or PDF.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `hidden-from-workers-home`
- Skills: `open-slide-decks`, `slide-design-taste`
- Sources: `open-slide`
- Optional sources: none
- Trusted tools: none
- Tags: `slides`, `presentation`, `deck`, `design`, `visual`
- Signals: `approval-capable`, `artifact-output-aware`, `canvas-visual-agent`, `external-action-boundary`, `requires-source-activation`
- Inputs: A deck brief (topic, audience, length, tone), or an existing deck to edit/export.
- Outputs: A static HTML build (and optional PDF) of the deck, published as a Canvas-visible Output. Edit URL and dist path included.

#### Writer (`writer`)

- Description: Drafts and edits prose with a clear, direct voice.
- Permission: `ask`; thinking: `medium`
- Launch surfaces: `workspace-workers-when-active`
- Skills: none
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `writing`, `editing`, `prose`
- Signals: `approval-capable`, `memory-scope-instructions`
- Inputs: A topic + audience, or an existing draft to revise.
- Outputs: A clean draft (or edited version) in a direct, specific voice.

### Outreach

#### College Radio (`college-radio-agent`)

- Description: Match releases to college and non-commercial radio stations, verify fit, and prepare rule-aware outreach packets.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`, `hq-workers-default-visible`, `campaign-workers-default-visible`
- Skills: `college-radio-matcher`, `college-radio-outreach`
- Sources: none
- Optional sources: none
- Trusted tools: `create_output`, `message_agent`
- Tags: `radio`, `college-radio`, `promotion`, `outreach`, `campaigns`, `research`
- Signals: `approval-capable`, `artifact-output-aware`, `external-action-boundary`, `trusted-worker-tools`
- Inputs: Artist HQ and campaign context, song/release, genre and vibe, 2–5 sound-alikes, clean/explicit status, hometown, tour markets, release type, stream/download links, and physical-format availability.
- Outputs: Ranked verified station shortlist, send-first tier, rules watch-list, submission path, personalized pitch drafts, follow-up plan, and Outreach Agent handoff packet.

#### Comms Agent (`comms-agent`)

- Description: Draft artist communications for fans, press, partners, collaborators, community, and team using Profile, Voice, Branding, and campaign context.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`
- Skills: `artist-comms-strategist`
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `comms`, `email`, `press`, `fans`, `outreach`, `copy`
- Signals: `approval-capable`, `artifact-output-aware`, `explicit-approval-required`, `external-action-boundary`
- Inputs: Artist HQ Profile, Voice, Branding cards, Intel reports, release/campaign context, audience segment, offer/news, links, facts, approvals, and send channel.
- Outputs: Fan emails, newsletters, SMS/community updates, press pitches, collaborator asks, internal updates, send-readiness checklists, and approval packets.

#### Industry Hunter (`industry-hunter`)

- Description: Find the right A&Rs, label operators, managers, publishers, sync people, and industry connectors, then output an Outreach-ready target list.
- Permission: `safe`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`, `campaign-workers-default-visible`
- Skills: `artist-industry-hunter`, `zero`
- Sources: `zero`
- Optional sources: none
- Trusted tools: `start_deep_research`, `list_deep_research_runs`, `get_deep_research_run`, `create_output`
- Tags: `industry`, `anr`, `outreach`, `labels`, `research`, `artist-development`, `zero`
- Signals: `artifact-output-aware`, `external-action-boundary`, `requires-source-activation`, `safe-default`, `trusted-worker-tools`
- Inputs: Artist HQ Profile, Voice, Branding, themes, music style, related artists, campaign/release goal, links, songs, lyrics, demos, and target market.
- Outputs: A ranked Industry Hunter Target List with names, roles, likely LinkedIn/profile URLs, source links, fit rationale, outreach angles, confidence, missing info, and Outreach Agent handoff prompts.

#### Outreach Agent (`outreach-agent`)

- Description: Find anyone's email via LinkedIn URL, research the person for personalized outreach, draft and send high rapport email.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`
- Skills: `zero`, `artist-comms-strategist`, `magnetic-outreach`
- Sources: `zero`
- Optional sources: `gmail`
- Trusted tools: none
- Tags: `outreach`, `email`, `linkedin`, `prospecting`, `rapport`, `gmail`, `zero`
- Signals: `approval-capable`, `artifact-output-aware`, `explicit-approval-required`, `external-action-boundary`, `optional-source-aware`, `requires-source-activation`
- Inputs: Person name, LinkedIn profile URL, outreach goal, relationship context, offer/ask, sender identity, artist/team context, and approval to send.
- Outputs: Confirmed email lookup result, prospect intel brief, hook/angle options, polished outreach draft, subject lines, copy-paste packet, approval checklist, and Gmail send receipt when connected and approved.

#### Triager (`triager`)

- Description: Sorts incoming items (emails, messages, issues) into next actions.
- Permission: `safe`; thinking: `medium`
- Launch surfaces: `workspace-workers-when-active`
- Skills: none
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `triage`, `inbox`, `prioritize`
- Signals: `artifact-output-aware`, `external-action-boundary`, `memory-scope-instructions`, `safe-default`
- Inputs: An unsorted list of items (emails, messages, issues, tasks).
- Outputs: Each item grouped by urgency with a single-verb next action and owner.

### Promotion

#### Ad Creative (`ad-creative-agent`)

- Description: Researches and finds high-performing artist ads, then helps craft creative, hooks, copy, and variants for paid campaigns.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`, `campaign-workers-default-visible`
- Skills: `artist-ad-dna`, `ad-library-intel`, `music-ad-visual-hooks`, `ads-creative-development`, `ad-creative`, `artist-campaign-angle-builder`
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `ads`, `creative`, `copy`, `hooks`, `meta`, `google-ads`, `artist-growth`
- Signals: `approval-capable`, `artifact-output-aware`
- Inputs: Artist context, strategy packet, platform, goal, creative assets, lyrics, clips, visuals, comments, destination, and brand constraints.
- Outputs: Ad Creative Packet with angles, hooks, copy variants, format plan, diversity check, fatigue refresh plan, policy risk, and execution handoff.

#### Ad Runner (`ads-agent`)

- Description: Plan, review, and run Meta, Google, Spotify ads.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`, `campaign-workers-default-visible`
- Skills: `meta-ads`, `google-ads`, `paid-ads-browser-operator`, `music-ad-conversion-protocol`
- Sources: `meta-ads`, `google-ads`, `ads-operator`
- Optional sources: none
- Trusted tools: none
- Tags: `ads`, `meta`, `google-ads`, `spotify-ads`, `paid-search`, `reporting`, `diagnostics`, `growth`
- Signals: `approval-capable`, `artifact-output-aware`, `explicit-approval-required`, `external-action-boundary`, `requires-source-activation`
- Inputs: Meta Ads, Google Ads, or Spotify Ads account, campaign, ad set/ad group, ad, keyword, search term, budget, conversion, reporting question, or Spotify for Artists audience intel.
- Outputs: Clear paid-media findings, diagnostics, reports, proposed changes, and approval-ready action plans.

#### Ad Strategy (`ads-strategist`)

- Description: Builds Meta, Google, and Spotify paid-ad campaign strategy, budget, audience, territory, and testing plans from artist context before Ad Runner executes.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`, `campaign-workers-default-visible`
- Skills: `artist-ad-dna`, `ad-library-intel`, `ads-strategy`, `music-ad-conversion-protocol`
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `ads`, `strategy`, `budget`, `media-plan`, `artist-growth`, `campaigns`, `spotify-ads`
- Signals: `approval-capable`, `artifact-output-aware`, `external-action-boundary`
- Inputs: Artist context, campaign/release goal, budget, platform scope, territories, destination URL, prior ad/export data, Spotify for Artists intel, and creative assets.
- Outputs: Ads Strategy Packet with platform rationale, campaign architecture, audience/territory plan, budget split, test plan, and execution handoff fields.

#### Branding Agent (`branding-agent`)

- Description: Build artist brand DNA, mythology, narrative universe, visual world, campaign angles, and subtle public behavior.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`, `hq-workers-default-visible`, `campaign-workers-default-visible`
- Skills: `artist-brand-dna-audit`, `artist-narrative-universe`, `artist-belief-system`, `artist-campaign-angle-builder`, `artist-visual-world-director`, `artist-brand-expression-strategist`
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `branding`, `artist`, `strategy`, `mythology`, `campaigns`, `creative-direction`
- Signals: `approval-capable`, `artifact-output-aware`, `external-action-boundary`
- Inputs: Artist HQ Profile, Voice, Branding cards, Intel reports, lyrics, songs, visuals, captions, references, campaign goals, or a brand problem.
- Outputs: Brand DNA audits, narrative universes, belief systems, visual-world direction, campaign angles, subtle behavior rules, fan rituals, and next moves.

#### Critic (`critic`)

- Description: Reads work and returns honest, specific, structured criticism.
- Permission: `safe`; thinking: `medium`
- Launch surfaces: `workspace-workers-when-active`
- Skills: none
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `review`, `critique`, `feedback`
- Signals: `memory-scope-instructions`, `safe-default`
- Inputs: A finished or in-progress piece of work (writing, code, design, plan).
- Outputs: What is working, what is not, and the single highest-leverage change.

#### IG Music Trending (`ig-trending-power-up`)

- Description: Draft an inquiry to a vetted IG music trending provider.
- Permission: `ask`; thinking: `medium`
- Launch surfaces: `workspace-workers-when-active`, `campaign-workers-default-visible`
- Skills: none
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `power-up`, `instagram`, `promotion`, `service-handoff`, `creator-growth`
- Signals: `approval-capable`, `context-doc-aware`, `external-action-boundary`
- Inputs: Mission/release context, promo budget, target timeline, campaign goal, and any notes for the service partner.
- Outputs: A concise partner inquiry email draft with subject, body, missing info, and send-readiness checklist.

#### Influencer Campaign (`influencer-campaign-power-up`)

- Description: Draft an inquiry to a vetted influencer campaign provider.
- Permission: `ask`; thinking: `medium`
- Launch surfaces: `workspace-workers-when-active`, `campaign-workers-default-visible`
- Skills: none
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `power-up`, `influencer`, `promotion`, `service-handoff`, `creator-growth`
- Signals: `approval-capable`, `context-doc-aware`, `external-action-boundary`
- Inputs: Mission/release context, promo budget, target audience, influencer lane, timeline, and notes for the service partner.
- Outputs: A concise partner inquiry email draft with subject, body, missing info, and send-readiness checklist.

#### Playlisting (`playlisting-power-up`)

- Description: Draft an inquiry to a vetted playlisting provider.
- Permission: `ask`; thinking: `medium`
- Launch surfaces: `workspace-workers-when-active`, `campaign-workers-default-visible`
- Skills: none
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `power-up`, `playlisting`, `spotify`, `promotion`, `service-handoff`
- Signals: `approval-capable`, `context-doc-aware`, `external-action-boundary`
- Inputs: Mission/release context, promo budget, genre/reference lane, release target, streaming links or asset status, and notes.
- Outputs: A concise playlisting inquiry email draft with subject, body, missing info, and send-readiness checklist.

#### Spotify Playlist Creator (`spotify-playlist-creator`)

- Description: Create Spotify playlists that place your songs beside bigger artists.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`, `hq-workers-default-visible`, `campaign-workers-default-visible`
- Skills: `spotify-playlist-curator`
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `spotify`, `playlist`, `promotion`, `music-marketing`
- Signals: `approval-capable`, `artifact-output-aware`, `explicit-approval-required`, `external-action-boundary`
- Inputs: Playlist theme, comparable artists/tracks, artist Spotify tracks, target length, feature ratio, visibility, and Spotify account/tool readiness.
- Outputs: A Spotify playlist plan, approval checklist, and creation payload or receipt when approved and Spotify tooling is connected.

### Research

#### Researcher (`researcher`)

- Description: Research a topic and return clear findings with sources.
- Permission: `safe`; thinking: `high`
- Launch surfaces: `hidden-from-workers-home`
- Skills: none
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `research`, `summarize`, `cite`
- Signals: `artifact-output-aware`, `memory-scope-instructions`, `safe-default`
- Inputs: A topic, question, or subject area to investigate.
- Outputs: A structured summary with TL;DR, findings, open questions, and numbered citations.

#### Spotify Analyst (`spotify-analyst`)

- Description: Pulls Spotify artist data and turns it into useful growth signal.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`
- Skills: `spotify-growth-intake`, `spotify-analytics-snapshot`, `spotify-anomaly-watch`, `spotify-playlist-curator`
- Sources: none
- Optional sources: none
- Trusted tools: none
- Tags: `spotify`, `analytics`, `research`, `audience`, `music-marketing`
- Signals: `approval-capable`, `explicit-approval-required`
- Inputs: Artist HQ Profile, Spotify client credentials, Spotify artist ID or URL, existing Spotify snapshots, and campaign context.
- Outputs: Spotify public API snapshots, optional S4A snapshot normalization, delta briefs, anomaly alerts, and growth handoff notes.

#### YouTube Research Agent (`youtube-research-agent`)

- Description: Find YouTube videos, comments, transcripts, and ideas for a campaign.
- Permission: `safe`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`
- Skills: `youtube-research`, `create-viral-content`
- Sources: `youtube-research`
- Optional sources: none
- Trusted tools: none
- Tags: `youtube`, `research`, `video`, `transcripts`, `comments`, `channels`, `seo`
- Signals: `artifact-output-aware`, `external-action-boundary`, `requires-source-activation`, `safe-default`
- Inputs: Campaign brief, song ethos, audience lane, YouTube topic, keyword list, channel handle, playlist URL, video ID, transcript request, comment research, or embed-candidate task.
- Outputs: Ranked video candidates, transcript summaries, top comments, channel scans, related-video lists, campaign-adjacent cultural notes, and embed-ready recommendations.

### Socials

#### Social Publisher (`social-publisher`)

- Description: Post or schedule content on Instagram, TikTok, X, and YouTube.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`
- Skills: `social-publishing`
- Sources: `printing-press-social`
- Optional sources: none
- Trusted tools: none
- Tags: `social`, `posting`, `browser`, `marketing`
- Signals: `approval-capable`, `artifact-output-aware`, `explicit-approval-required`, `external-action-boundary`, `requires-source-activation`
- Inputs: A social action request: post, reply/comment, DM, profile login, or channel readiness check.
- Outputs: A dry-run plan, browser execution, and a publish/send receipt when approved.

#### TryPost (`trypost-agent`)

- Description: Post or schedule social content through TryPost.
- Permission: `ask`; thinking: `high`
- Launch surfaces: `workspace-workers-when-active`
- Skills: none
- Sources: `trypost`
- Optional sources: none
- Trusted tools: none
- Tags: `social`, `socials`, `posting`, `trypost`, `api`, `mcp`
- Signals: `approval-capable`, `artifact-output-aware`, `explicit-approval-required`, `external-action-boundary`, `requires-source-activation`
- Inputs: Social post request, platform, account/profile, copy, media paths, schedule target, campaign context, and approval status.
- Outputs: TryPost-ready draft, missing-fields checklist, approval packet, and publish/schedule receipt once wired and approved.

## Manual Follow-Up Map Gaps

- IPC channel to UI route mapping is not yet generated.
- Automation template wiring is not yet merged into this map.
- Context-doc routing is summarized from launch/runtime code, not enumerated per workspace doc.
- Live user/global agent overrides in `~/.agents/agents` are not included; this maps starter code, not machine-local mutations.
- If Reference Health flags a missing skill/source that intentionally lives only in a user workspace, document that exception here.
