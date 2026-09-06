---
status: active
owner: agent
last_verified: 2026-09-06
worktree: /Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os
branch: main
scope: onboarding
---

# Handoff: Artist OS Onboarding

Read this before touching anything. It covers what the product is, how agents
and context are wired, which docs to trust, and how to verify work. It does not
track feature status — see the spec index for that.

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

As of 2026-09-06 this folder holds the `main` branch, the built app, and
everything that ships. Read
**[GIT-FACTS-ALWAYS-READ-ME.md](GIT-FACTS-ALWAYS-READ-ME.md)** before your
first commit, branch, or merge — it is the authority on where work lives and
how it gets onto `main`.

The stash stack is shared with every other worktree and other agents are working
concurrently. **Never use bare `git stash` / `git stash pop`** — you can pop
someone else's work. Use a temporary WIP commit instead.

Other agents have uncommitted files in this tree right now. Check `git status`
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

**Defining a persona does not make it appear.** There are three separate lists,
and time has been lost to this:

1. `BUILTIN_VISIBLE_AGENT_SLUGS` in `apps/electron/src/renderer/hooks/useAgents.ts`
   — shows an agent in both HQ and Campaign. Computed per load, so existing
   workspaces pick it up with no migration. This is usually the one you want.
2. `apps/electron/src/renderer/lib/worker-defaults.ts` — separate BASE / HQ /
   Campaign display lists.
3. `packages/shared/src/agent-definitions/defaults.ts` — activates agents when a
   workspace is **created**. Returns `[]` for existing roots, so it will not fix
   anything retroactively.

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
  Note: prompt assembly is **duplicated** in `SessionManager.ts` — known drift
  risk, check both if prompts behave oddly.
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

The single best doc is `docs/creator-command-center/todo/README.md`. It indexes
unbuilt specs and its stated rule is that a spec is only listed after verifying
its defining symbol is absent from the tree. **However** it currently still
lists specs 38 and 41 as unbuilt; both are now built. Verify before trusting any
line in it.

`HANDOFF.md` and `docs/CURRENT.md` both declare `source_of_truth: true` but were
last verified 2026-08-30 and point at a **different worktree and branch**
(`.worktrees/active/artist-os-release-kit`). Useful for architectural background,
wrong about current state. Do not follow their "start here" instructions.

`docs/system-map/runner-system-map.md` is generated — regenerate with
`bun run docs:system-map` rather than reading a stale copy.

`docs/creator-command-center/` holds ~44 numbered specs, the real design record.
Read the one covering your area before writing code.

## Runtime

Electron **44.2.0** (Node 24, Chromium 152) since 2026-09-06. Node ≥ 22.12 on
PATH for packaging or Electron's installer; `bun install` no longer fetches the
Electron binary. Details, packaging paths and the sharp-natives gate:
[GIT-FACTS-ALWAYS-READ-ME.md](GIT-FACTS-ALWAYS-READ-ME.md) §6.

## Verifying

    bun test <path>                              # targeted; fast
    cd packages/<name> && bun run tsc --noEmit   # per package
    cd apps/electron && bun run tsc --noEmit
    cd apps/electron && bun run build:renderer   # catches import/bundling breaks

Some pre-existing failures are unrelated to you — artwork and video tool tests
time out on ffmpeg/sharp. Establish whether a failure is yours before claiming
it isn't.

To actually run the app (needed for visual checks):

    CRAFT_PRODUCT_VARIANT=artist-os CRAFT_CONFIG_DIR=$HOME/.artist-os-dev

from `apps/electron`. Without those env vars you get the old RunnerOS profile
and will think nothing works. The app holds a single-instance lock, so ask the
user to close theirs first. The renderer is served from `dist/renderer`, not a
Vite dev server — run `build:renderer` then Cmd+R to see changes.

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

Spec 41, Slice D — the artist's *existing* site, the one they're not going to
abandon:

- `website_inspect_external` crawls their Squarespace/Wix/WordPress page once,
  stores the reading on `manifest.external`, and reports findings as
  consequences ("your signup goes to mailchimp, so those fans can't be emailed
  from here"). `packages/server-core/src/website/inspect.ts`
- The Community CSV importer now survives real provider exports: proper RFC 4180
  parsing, provider column mapping, and unsubscribed rows becoming suppressions
  instead of contacts. The page previews the file before writing.
  `packages/shared/src/community/list-export.ts`
- Editing an existing site goes through **the browser** (`browser_tool`), not an
  API adapter. Decided deliberately: WordPress's REST API writes `post_content`,
  but Elementor/Divi sites keep the layout in postmeta, so an API write breaks
  the page and reports success.

Last four commits: `bec22c3b0`, `ec1412ab8`, `7afe1de29`, `5437309f9`.
