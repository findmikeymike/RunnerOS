---
status: active
owner: agent
last_verified: 2026-09-08
verification_record: docs/audits/artist-os-consolidation-2026-09-08.md
verified_head: 5ce3c102db48f59dbab617a9a7b33c0f4e93de27
verified_origin_main: 2477cc47909ba49fdb0f7a53efd914cf55420f59
worktree: /Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os
branch: main
scope: onboarding
---

> September 9 landing update: the earlier snapshot below is historical. Main now
> includes provider recovery hardening (`f4c604309`), manager/sidebar restoration
> (`94b7cb56f`), ChatGPT Conversation support and automatic/manual connection
> refresh (`d1fa9a604`), and validated Signals in State of Play (`1545cffb5`).
> The voice opener is already on `origin/main`; physical voice acceptance remains
> separate. Verify current remote state with Git. The running app was last built
> before the Signals landing; this commit/push does not certify a new runtime build.

# Handoff: Artist OS Onboarding

Read this before touching anything. It covers what the product is, how agents
and context are wired, which docs to trust, and how to verify work. It does not
track feature status — see the spec index for that.

For what has actually been verified versus what is merely assumed to work, read
[HANDOFF2.md](HANDOFF2.md). For keeping dependencies current without breaking
the app, read [docs/updates/regular-updates-check.md](docs/updates/regular-updates-check.md).

## What it is

Artist OS is an Electron desktop app for musicians where AI agents take real
actions — update the website, email the fan list, post to socials, track a
release — rather than just producing text. The artist approves the consequential
things; the agents do the work.

Technically it's a **product variant** of RunnerOS, a Bun + Electron monorepo
(`craft-agent`). The variant is selected by `CRAFT_PRODUCT_VARIANT=artist-os`,
which swaps the data root, ports, keychain, and update feed. Core file:
`packages/shared/src/config/runtime-identity.ts`. Isolation is enforced by
`scripts/check-product-isolation.ts` — don't break it.

## Where you are

Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`
Branch: `main` — but always confirm with `git branch --show-current` rather
than trusting this doc or the folder name.

This is a **git worktree**, not the main checkout. Run everything from here and
never `cd` to the repo root.

This folder is the canonical `main` checkout. Source integration does not prove
the running packaged app has loaded those changes. Read
**[GIT-FACTS-ALWAYS-READ-ME.md](GIT-FACTS-ALWAYS-READ-ME.md)** before your
first commit, branch, or merge — it is the authority on where work lives and
how it gets onto `main`.

The stash stack is shared with every other worktree and other agents are working
concurrently. **Never use bare `git stash` / `git stash pop`** — you can pop
someone else's work. Use a temporary WIP commit instead.

Other agents may have uncommitted files in this tree. Check `git status`
before you stage anything, and only ever `git add` your own paths explicitly.
Never `git add -A` blindly, never `git checkout .`.

## Layout

    packages/shared/          business logic, agent definitions, context, skills
    packages/server-core/     services + session orchestration + RPC handlers
    packages/session-tools-core/  the tool registry agents call
    packages/pi-agent-server/ second agent backend (non-Anthropic models)
    apps/electron/            main process + React renderer
    tools/                    bundled CLIs agents shell out to (site-builder,
                              printing-press-social, video-studio, ...)
    docs/                     specs and status

Transport is **WebSocket JSON-RPC**, not Electron IPC, despite some legacy
naming: `packages/server-core/src/transport/server.ts`, renderer side
`apps/electron/src/transport/routed-client.ts` + `channel-map.ts`.

## How agents work

An "Agent" here is a **persona**: a saved bundle of system prompt + skills +
tools + model settings. Read `packages/shared/src/agent-definitions/types.ts`
first — it explains the distinction between these and the runtime executor
classes in `packages/shared/src/agent/`, which is a real source of confusion.

- Starter personas live in `packages/shared/src/agent-definitions/starter-templates.ts`.
  This is a very large file of prompt strings. Prompts are written in the
  artist's language, not engineer language.
- `trustedWorkerTools` on the metadata is the tool allowlist for that agent.
  A tool not listed there does not exist for it.
- Agents live in a **global** library and are activated **per workspace**.

**Availability and activation are separate.** `starter-templates.ts` owns definitions;
`packages/shared/src/agent-definitions/registration.ts` owns built-in recovery,
worker presentation groups, initial activation groups, and scope eligibility.
`defaults.ts` and renderer `worker-defaults.ts` derive their lists from that registry.

- Artist OS Workers and delegation catalogs use saved workspace activation plus a
  readable definition and scope eligibility. Adding a definition never makes it active.
- Fresh workspaces retain their six initial workers; existing roots retain their
  saved choices, including empty manifests. Manage Library enables other workers.
- Artist OS startup recovers required definitions but does not reapply legacy agent
  or skill activation backfills. Explicit deletion tombstones remain respected.
  The separate Runner variant retains its legacy migrations.
- Creative Lab excludes unrelated known built-ins from active routing; custom
  workers retain their existing eligibility. Reads do not rewrite old manifests.
- Explicit workflow/Pulse launches retain their existing launch semantics; saved
  activation controls Workers/catalog discovery and `message_agent` delegation.

Workspace kinds: **Artist HQ** (career-wide, one), **Campaign** (per release,
many), **Creative Lab** (songwriting, one).

## How context works

Agents don't get a database. They get **context docs**: markdown with fenced JSON
blocks, stored per workspace.

- Canonical schemas: `packages/shared/src/artist-context/` — profile, voice,
  branding, spotify, instagram, calendar, network. These are the source of truth;
  the `apps/electron/src/renderer/lib/artist-*.ts` files are thin re-exports.
- `packages/shared/src/hq-state/composer.ts` aggregates them into the HQ "State
  of Play" and the "Needs attention" list.
- System prompt composition: `packages/shared/src/agent-prompt/compose.ts`.
  Chat and server launches share verified context preparation in
  `packages/server-core/src/agent-launch/context.ts` and reference/skill-selection
  policy in `packages/shared/src/agent-definitions/references.ts`. Focused and
  default background launches use strict references; unfocused interactive chat
  warns and omits unavailable references. Keep transport-specific skill permission
  checks and broadcasts intact.
- Memory is markdown files (`~/.agents/USER.md`, `agents/<slug>/MEMORY.md`) with
  lexical recall and tombstones, not a vector store.
- `get_artist_context` is **HNIC-only** (Artist Manager). Every other agent uses
  `get_workspace_context`. Putting the wrong one in `trustedWorkerTools` fails at
  runtime, not at compile time.

## Adding a session tool

Tools are defined once in `packages/session-tools-core/src/tool-defs.ts` but
wiring one end to end touches eight files, in this order. Miss one and it fails
silently or at runtime:

1. `packages/session-tools-core/src/context.ts` — declare the optional method
2. `packages/session-tools-core/src/handlers/<domain>.ts` — input type + handler
3. `packages/session-tools-core/src/handlers/index.ts` — export both
4. `packages/session-tools-core/src/index.ts` — re-export the input type
5. `packages/session-tools-core/src/tool-defs.ts` — zod schema, description,
   registry entry, and the handler import
6. `packages/shared/src/agent/session-scoped-tool-callback-registry.ts` — `...Fn` type
7. `packages/shared/src/agent/session-self-management-bindings.ts` — `defineProperty`
8. `packages/server-core/src/sessions/SessionManager.ts` — the implementation

Then add the tool name to `trustedWorkerTools` for whichever agents should have
it. Set `readOnly: true` only if the tool truly has no side effects — it enables
parallel execution, so a tool that writes local state must not claim it.

## Docs — and which ones lie

Start with `docs/creator-command-center/README.md`, then its `todo/README.md`.
The parent index separates implemented, partially implemented, and unbuilt
work. Spec 48 has an implemented Branding Agent pilot; its remaining rollout and
capability-loading slices are open. Specs 38 and 41 have implemented core workflows, with live
acceptance and the complete cross-agent loop still open. Some spec files remain under `todo/` to preserve links;
that path is not a status claim. Verify symbols before trusting a status label.

`HANDOFF.md` and `docs/CURRENT.md` are preserved August 30 historical records.
Their headers now point here and to HANDOFF2; their old worktree, branch, launch,
and current-state directions are not authoritative.

`docs/system-map/runner-system-map.md` is generated — regenerate with
`bun run docs:system-map` rather than reading a stale copy.

`docs/creator-command-center/` holds the numbered product specs, the real design
record. Read the one covering your area before writing code.

## Runtime

Electron **44.2.0** (Node 24, Chromium 152) since 2026-09-06. Node ≥ 22.12 on
PATH for packaging or Electron's installer; `bun install` no longer fetches the
Electron binary. Details, packaging paths and the sharp-natives gate:
[GIT-FACTS-ALWAYS-READ-ME.md](GIT-FACTS-ALWAYS-READ-ME.md) §6.

## Verifying

    bun test <path>                              # targeted; fast
    cd packages/<name> && bun run tsc --noEmit   # per package
    cd apps/electron && bun run tsc --noEmit
    bun run electron:build:renderer              # from worktree root

Historical evidence from 2026-09-07 at `c82d4c6c9`: the discovery suite passed **8,555 tests,
one skip, zero failures** across 733 files. That is a snapshot, not permission
to dismiss a new failure as pre-existing: isolate and prove its cause.

The current consolidation evidence is in
[the 2026-09-08 audit](docs/audits/artist-os-consolidation-2026-09-08.md).
Do not reuse older test totals as proof of the current combined tree.

**Current working mode: development access, using the existing artist profile.**
The packaged release launch on September8 was the wrong mode for Michael's daily
work: it enforced licensing. The corrected live instance uses the current canonical
compiled app, Electron44, and the same `~/.artist-os` data root. Settings → App →
Behavior explicitly shows “Development access” and paid features enabled.

From the canonical checkout, after build verification and restart authorization:

```sh
CRAFT_PRODUCT_VARIANT=artist-os CRAFT_CONFIG_DIR="$HOME/.artist-os" CRAFT_BUNDLED_ASSETS_ROOT="$PWD/apps/electron" node_modules/electron/dist/Electron.app/Contents/MacOS/Electron apps/electron
```

Ordinary Artist OS startup opens HQ Overview, even when the previous window was in a campaign. During use, workspace switching restores each workspace's last page; first visits use the workspace home. Explicit navigation and deep links keep their requested destination.

This uses the existing unpackaged development entitlement; it does not change release
licensing or license records. Keep this mode for ongoing development unless the user
specifically asks to test the packaged release. The packaged app remains available at
`apps/electron/release-artist-os/mac-arm64/Artist OS.app`, with licensing enforced.
Do not silently switch profiles: `electron:dev:artist-os` below defaults to the separate
`~/.artist-os-dev` profile.

To run a development instance only after explicit user permission:

    bun run electron:dev:artist-os

Run that from this worktree root. It supplies the Artist OS variant and the
`~/.artist-os-dev` profile; a generic launch can show the old RunnerOS profile
and make correct work look missing. The app holds a single-instance lock, so
ask the user to close theirs first. The renderer is served from
`dist/renderer`, not a Vite dev server — after renderer-only changes run
`bun run electron:build:renderer`, then Cmd+R to see them.

## House rules

- **Truth over optimism.** Never say "done" without running the thing. If tests
  fail, say so and show the output.
- **Verify at the source.** Don't grep with `head` and conclude something is
  absent — you'll be wrong and it will be load-bearing. Search the whole tree.
- **Don't commit unless asked.**
- Public or outward-facing actions (publishing, sending, spending, posting)
  require the artist's explicit approval bound to the exact thing being approved,
  plus a durable receipt. An agent must never be able to grant itself that.
- Never put credentials, fan email addresses, or message bodies into memory or
  context docs.
- Don't add agents or pile skills onto existing ones without being asked. The
  user is deliberate about keeping the roster small and each agent's job legible.

## Recently shipped (don't redo)

Older but still current context — Spec 41 Slice D, the artist's *existing*
site: `website_inspect_external` (`packages/server-core/src/website/inspect.ts`)
crawls their live page once and reports consequences; the Community CSV
importer survives real provider exports
(`packages/shared/src/community/list-export.ts`); editing an existing site
goes through `browser_tool`, never a REST API write (Elementor/Divi keep
layout in postmeta — an API write silently breaks the page).

The historical September 4–7 tranche below was verified through `c82d4c6c9`.
The later consolidation and current-head additions follow it; use `git log` for
the exact ledger.

- **Voice / Mikey** (largest line, `codex/artist-os-voice-*`): voice call UX
  with **Mikey**, the Artist Manager voice persona. Focused context
  conversation without agent tools; Command handoff confirmation (natural
  language agreement) with navigation traces; Conversation settings separated
  from the Command model; focused mode/model persist across HQ navigation;
  compact call view; Moonshine room-noise endpoint repair; spoken-format
  replies, preloaded procedures, bounded Voice Core speech chunking; streamed
  focused replies on a verified Flash route; voice campaign advice grounded
  in the Release Kit. The modal now bundles the **Mikey GLB** (`e9b87972c`)
  with restrained motion. The later `0c3650bdc` update adds phoneme sync and
  warmup readiness. Local main `d1efa02bc` adds varied profile-aware opening
  greetings without a model call; at this refresh it was not yet on
  `origin/main`. A physical microphone/provider performance pass remains separate
  from source/build verification. See `docs/tts-agent/09-mikey-call-avatar.md`
  and `docs/tts-agent/11-mikey-call-openers.md`.
- **Signals** (`codex/signals-your-world`, merged `57eaa8255`): spec
  `docs/creator-command-center/47-signals-your-world-spec.md` (audits in
  `docs/audits/`). Reviewed worker retrieval, idea handoffs, reviewed track
  reader, audio experience, hardened reports. The chat SignalHandoffNotice
  hides itself without a confirmed attachment.
- **Agent task modes** (spec 48,
  `docs/creator-command-center/todo/48-agent-task-modes-spec.md`, `ffd4a1150`):
  the **Branding Agent pilot** asks what the artist is doing, then starts with
  the focused skill/context route while retaining explicit overlap awareness.
  Adjacent skills are **not loaded in the pilot**; it offers the better next
  mode/handoff when the boundary is crossed. Core:
  `packages/shared/src/agent-definitions/task-modes.ts`, in-chat
  `ChatAgentTaskModeBar.tsx`, and SessionManager support. The later `25c636ba9`
  and `72d7791f2` changes persist focus cards, pair related Branding skills, and
  isolate active-turn context from later selections. Hidden starters do not enter
  artist memory or conversation summaries. `296618103` extends the shared focus
  system across 27 approved agents; live provider performance/quality acceptance
  remains open.
- **Conversation history** (`654050905`, `ad0cabed2`): the unprojected section
  is now **Conversations**, newest first, capped to a compact inner scroller.
  Rows use the stable generated/manual topic as the primary title and the agent
  as quiet secondary context; no extra title-model call was added.
- **Memory / context**: bounded prompt injection, durable `SESSIONS.md`,
  `recall_session`, campaign-scoped facts, safer session-log parsing, and less
  whole-workspace context on every turn. Do not reintroduce giant eager prompts.
- **Models / gateway**: keyless **OmniRoute** gateway embedded with route
  tiers, free-route default, and retry-on-gateway-ask; z.ai connections
  default to GLM 5.3; cheap model for chat titles; current Claude generation
  + its thinking rule; provider preference lists corrected; **Monid** built-in
  MCP with spend controls; pi credential fixes for SDK changes.
- **Platform / security**: Electron 39 → **44.2.0**; remote-workspace TLS
  validation on by default; frontmatter parsing moved off gray-matter's
  js-yaml 3 to a safe engine; libsignal protobuf advisory cleared; sharp
  pinned at 0.34.5 with natives gating; per-platform onnxruntime binaries;
  upstream baseline at v0.13.1
  (`docs/creator-command-center/17-craft-upstream-porting-ledger-2026-08.md`).
- **Suite/CI**: the suite is order-independent under macOS/Linux sharding, but
  the historical CI snapshot was **not all green**. At `c82d4c6c9`, `Validate` passed; `Tests`
  failed one Linux shard because `blocks Bash redirect to sibling path with
  data prefix` exceeded the 5-second test timeout. A focused local rerun passed
  that file 8/8 (the failed case took 30.71 ms), and both workflows passed at
  `ad0cabed2`, so the failure did not reproduce locally; it still needs a clean
  CI rerun or a deliberate reliability fix before claiming current CI green.
  The full-suite evidence above was recorded after the avatar absorbed the
  conversation-list changes.
- **Product fixes**: website publishing retries/scheduling/rollback; community
  email retries + unsubscribe hardening; chat shows "still working" and
  elapsed time for slow tools; libvips artwork fix (25s → fast); release
  manager scoped to campaigns; squad storyboard ships bundled Python runtime;
  native window close and the web-canvas resize divider were restored
  (`2c9b68e92`).

## September 8 consolidation

- `38e7b8986`: compact conversation previews, following the sidebar/topic series.
- `aa53a41ba`: steer input and Send update stay available while processing;
  pending Claude updates retain their order until delivery. Several steers can
  arrive together at the next opportunity; this is not a one-per-response queue.
- `48608a694`: existing libraries receive the built-in Website Agent, distinct
  from Site Builder, without overwriting customization or deliberate deletion.
- `72d7791f2`: compact, persistent Branding focuses and safer selection/turn state.
- `81a2673df`: confirmed campaign deletion preserves useful files in HQ Vault →
  Past Releases and saved global memories, then removes campaign-local clutter.
  See [retention and limits](docs/audits/campaign-cleanup-2026-09-08.md).
- Signals UX `fc3a793fa` landed through `e9ab74b06`: shared track setup, clearer
  report navigation, and saved insights.
- `69dd15768`: recovered historical delegate permission/capability limits and
  hidden-session boundaries while retaining legitimate background-job replies.
- `79b2822ae` through `1fa79c16d`: refreshed Setup Concierge and the Artist OS
  Guide around live capability discovery, repaired Signals focus fixtures, and
  verified exact-stock migration without overwriting customized guidance.
- `1f69a5f38` through `b01e34bbe`: refined the workspace/header/sidebar surfaces,
  aligned People and Signals toggles, restored both website workers, starts at HQ
  Overview, remembers per-workspace destinations, and adds the Artist Manager orb.
- `6a5780a30` through `905717c57`: protects 106 built-in skill packages as managed
  runtime material while preserving personal instructions, custom skills, legacy
  behavior, product boundaries, and recovery records. Live provider acceptance is
  still separate from automated verification.
- `2477cc479`: adds Scriptwriter to HQ and campaigns with YouTube and Reels/TikTok
  modes, bounded HQ identity/voice/branding context, and approval-aware continuity
  memory. Live provider invocation and cross-session recall remain open.

Use [the consolidation audit](docs/audits/artist-os-consolidation-2026-09-08.md)
for exact landed SHAs, current checks, remote state, and remaining runtime gates.
At this documentation refresh, local main was `5ce3c102db48` and `origin/main`
was `2477cc47909b`; the only local-only feature was the profile-aware voice opener
`d1efa02bc` plus its merge commit.
Reconfirm `git status`, `git log -1`, and `origin/main` before acting. The user
subsequently authorized installation and launch; the consolidation audit records the
new process and rendered app evidence.
