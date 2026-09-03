---
status: implemented
owner: agent
last_verified: 2026-09-01
source_of_truth: true
related: ./26-agent-bound-messaging-spec.md
---

# Computer Use Provider Strategy

## Briefing For The Implementing Agent

Read this first.

### What this is

Artist OS controls native macOS apps through a **Computer Use** MCP source. It now prefers `cua-driver`, falls back to Copilot computer use, and retains the vendored Swift runtime as the final fallback.

### The one fact that shapes everything

Only three tools on macOS can drive an app **without stealing the user's cursor**, and all three use the same undocumented private APIs from `SkyLight.framework` (`SLEventPostToPid`, `SLPSPostEventRecordTo`):

| Tool | Status | License |
| --- | --- | --- |
| `actuallyepic/background-computer-use` | **Vendored here.** Dormant — last push 2026-05-05, single author, 0 open issues | MIT |
| `trycua/cua-driver` | Actively maintained, funded team, nightly builds, ~17.7k stars | MIT |
| OpenAI Codex computer use | Proprietary, hosted — not embeddable | — |

Everything else in the category disqualifies itself: Open Interpreter and Skyvern are **AGPL** (fatal for a commercial closed-source product), Bytebot runs in a VM and cannot touch the artist's signed-in apps, and the rest take over the physical pointer.

**Apple has shipped no sanctioned alternative.** There is no public equivalent to `SLEventPostToPid` in macOS 15 or 26. The private surface is the only path, so this risk is structural for the whole category — it cannot be engineered away by choosing differently.

### Therefore: this is not a swap

Switching to `cua-driver` does **not** reduce technical risk — it sits on the identical private-API surface. What it buys is **response capability**: a funded team whose product depends on fixing regressions quickly, versus a dormant repo with nobody to fix anything.

So the design is *additive*. Prefer `cua-driver` when present, keep the vendored Swift package as fallback, and make the shared failure mode visible.

### The failure mode that matters most

macOS 14.5 introduced an authorization check that **silently** broke SkyLight calls for window managers like yabai — the function still returned success, the operation just became a no-op.

That is the realistic failure here: not a crash, but **computer use quietly doing nothing while reporting success**. An agent would keep issuing clicks into the void and report progress it never made.

Current detection cannot catch this. `readBaseUrl()` only checks that the runtime manifest file exists, and `computer_use_status` only calls `/health` and `/v1/bootstrap` — both confirm the runtime is *reachable*, neither confirms it can still *affect a window*.

### What already exists (do not rebuild)

The provider abstraction remains deliberately small:

```ts
// packages/shared/src/sources/builtin-sources.ts
provider: selection.provider
```

- `provider` is typed as an open `string` — adding a value needs no type change
- Only **7** non-test references to either provider name exist across the repo
- Both providers already ship **different tool vocabularies**, and `workflowGuide` already branches per provider to teach the correct one
- Everything routes through a 347-line stdio MCP bridge

Adding a third branch follows a path the code already walks.

### Do not

- **Do not remove the vendored Swift package.** It is the fallback when `cua-driver` is absent, and it works today.
- **Do not vendor `cua-driver`.** It ships as a standalone MCP server binary. Detect it the way `getCopilotComputerUseMcpPath()` detects Copilot's.
- **Do not assume tool names carry over.** Each provider names its tools differently; the workflow guide must match the selected provider exactly or the agent will call tools that do not exist.
- **Do not treat reachability as health.** See the silent no-op failure above.

---

## Current State

Verified at `last_verified`.

### Provider selection

`getComputerUseSource()` in `packages/shared/src/sources/builtin-sources.ts` resolves one of three providers at call time:

- **`cua-driver`** — preferred after a bounded `--version` startup probe succeeds. The result is cached by binary path for 30 seconds so repeated source loads do not repeatedly block the event loop. Discovery honors the authoritative `CRAFT_CUA_DRIVER_MCP` override, then checks `~/.local/bin`, the macOS application bundle, and `PATH`.
- **`copilot-computer-use`** — second choice when GitHub Copilot's `computer-use-mcp` binary is found. Detected by `getCopilotComputerUseMcpPath()`, which probes `CRAFT_COPILOT_COMPUTER_USE_MCP` and three `node_modules/@github/copilot-<platform>-<arch>/prebuilds/` locations.
- **`background-computer-use`** — fallback. Runs `bun run <script>` against the vendored Swift runtime via the MCP bridge.

The source logs the chosen provider and reason. If no provider is usable, it reports a failed connection instead of deferring failure until an agent tries to act.

### Tool vocabularies

They are not interchangeable:

| CUA Driver | Copilot | Vendored Swift bridge |
| --- | --- | --- |
| `health_report`, `list_apps`, `list_windows` | `list_apps` | `computer_use_list_apps`, `computer_use_list_windows` |
| `get_window_state`, `verify_state` | `get_window_state` | `computer_use_observe_window` |
| `click`, `type_text`, `set_value`, `press_key`, `hotkey`, `scroll`, `drag`, `invoke_menu`, `set_window_frame` | `click`, `set_text`, `insert_text`, `type_chars`, `key_chord`, `scroll`, `drag`, `select_option`, `secondary_action` | `computer_use_click`, `computer_use_type_text`, `computer_use_set_value`, `computer_use_press_key`, `computer_use_scroll`, `computer_use_drag`, `computer_use_perform_secondary_action`, `computer_use_resize`, `computer_use_set_window_frame`, `computer_use_status` |

### Vendored package provenance

Vendored 2026-05-02 from `actuallyepic/background-computer-use` at upstream SHA `dcf55a3feee557ebdcda4afa6241c82dc6abdd8c` (commit `066cf1e8a` in this repo). Deliberately copied rather than submoduled — the reasoning is recorded in that commit and remains sound.

`tools/background-computer-use/UPSTREAM.md` records the provenance and local changes. `Package.swift` moved from Swift tools 6.2 to 6.1 at vendoring, then to 6.0 later. `script/build_and_run.sh` is byte-identical to the vendored upstream SHA; the later upstream build-path fix is applicable but optional because Artist OS does not use the affected release-build path.

Upstream has **two** commits since vendoring. The build-path fix is optional because its release-build branch is unused; "Add installable computer use skill" is packaging for other agent setups and would introduce an unnecessary Python dependency.

---

## Core Laws

```text
Prefer the maintained provider; always keep a working fallback.
The workflow guide must match the selected provider's tool names exactly.
Reachable is not the same as functional.
A silent no-op must surface as a failure, never as success.
```

## Provider Selection

Resolution order, first match wins:

1. **`cua-driver`** — actively maintained, background-capable
2. **`copilot-computer-use`** — existing preference, background-capable
3. **`background-computer-use`** — vendored Swift fallback

Detection follows the existing pattern: an explicit env override first, then known install locations, then `null`. `CRAFT_CUA_DRIVER_MCP` is authoritative when set, so users and tests can force a specific build without silently falling through to a different CUA installation.

Selection is resolved once per `getComputerUseSource()` call and must be **logged with the chosen provider and the reason** — an artist reporting "computer use isn't working" needs that line to be answerable.

## Health, Not Reachability

The current check confirms the runtime answers HTTP. It cannot detect the macOS 14.5-class failure where events post successfully but do nothing.

Add a **capability probe** to the status path:

1. Confirm the runtime responds (existing behavior).
2. Confirm it can **enumerate windows** — a non-empty result proves Accessibility and Screen Recording permissions are actually granted, not merely requested.
3. Report a three-state result: `ready`, `degraded` (reachable but cannot observe windows — almost always a revoked permission), or `unavailable`.

`degraded` must be surfaced to the user with the actual remedy — which permission, in which System Settings pane — rather than a generic failure. Permission revocation after an OS update is the single most likely real-world cause.

**Do not attempt to auto-detect the silent no-op by performing a real action.** A synthetic click to test liveness is itself a side effect on the user's machine. Enumerating windows is read-only and sufficient.

## Agent-Facing Behavior

The existing workflow guide already instructs the agent to observe before acting and to ask before irreversible actions. Preserve both verbatim for the new provider, adapted to its tool names.

Add one rule that applies to all three providers:

> If an action reports success but a subsequent observation shows the expected change did not occur, stop and tell the user. Do not retry the same action.

That is the agent-side counterpart to the silent no-op: the host cannot always detect it, but an agent that observes after acting can.

## Failure And Edge Cases

| Condition | Behavior |
| --- | --- |
| No provider found | Source reports unavailable with install guidance; agents see it as unusable rather than failing mid-task |
| Preferred provider present but won't start | Fall through to the next provider and log the fallthrough; never fail hard when a working fallback exists |
| Explicit CUA override is missing or not executable | Fall through safely and name the rejected override in the provider-selection log |
| Provider changes between sessions | Workflow guide is regenerated per call, so tool names stay correct automatically |
| Accessibility/Screen Recording revoked | `degraded` with the specific permission and where to re-grant it |
| Runtime reachable but events are no-ops | Cannot be detected host-side; the agent's observe-after-act rule is the mitigation |
| Vendored Swift package fails to build on a newer Xcode | Falls through to unavailable; record the toolchain divergence so the cause is diagnosable |

## Implementation Slices

**Slice 1 — Provenance (complete).** Added `tools/background-computer-use/UPSTREAM.md` with the verified upstream SHA, date, and actual local divergence. It also corrects the earlier mistaken claim that `build_and_run.sh` was locally simplified.

**Slice 2 — Health probe (complete).** The vendored status path distinguishes `ready` / `degraded` / `unavailable` with a read-only application-enumeration capability probe and actionable permission messaging.

**Slice 3 — `cua-driver` detection (complete).** Added `getCuaDriverMcpPath()`, authoritative `CRAFT_CUA_DRIVER_MCP` override handling, known-location discovery, and a bounded startup probe.

**Slice 4 — Three-way selection (complete).** Replaced the ternary with ordered resolution, added the CUA-specific workflow guide using the verified live tool catalog, and logged selection/fallthrough reasons.

**Slice 5 — Agent rule (complete).** Added observe-after-act instructions to both existing provider guides and the new CUA guide.

Slices 1 and 2 are worth doing whether or not `cua-driver` is ever adopted.

## Acceptance Tests

### Selection

- with all three present, `cua-driver` is selected
- with `cua-driver` absent, Copilot is selected
- with both absent, the vendored fallback is selected
- with none present, the source reports unavailable rather than throwing
- `CRAFT_CUA_DRIVER_MCP` overrides discovery
- the selected provider and reason are logged
- repeated loads reuse the recent startup-probe result for the same binary path

### Workflow guide correctness

- the guide names **only** tools the selected provider actually exposes
- no guide references a tool from a different provider's vocabulary
- the observe-before-act and ask-before-irreversible rules are present for every provider
- an opt-in live contract test can compare the guide vocabulary with an installed `cua-driver`

### Health

- reachable + windows enumerable → `ready`
- reachable + zero windows enumerable → `degraded`, message names the permission and where to grant it
- unreachable → `unavailable`
- the probe performs no click, keystroke, or window mutation

### Regression

- existing Copilot and vendored paths behave exactly as before when `cua-driver` is absent

## Deferred

- Removing the vendored Swift package. Keep it until `cua-driver` has been proven in real use on the current macOS.
- Windows/Linux computer use. This spec is macOS-only, matching the current implementation.
- Auto-installing `cua-driver`. Detection only; installation is the user's choice.
- Automated detection of the silent no-op. Not solvable host-side without causing side effects.

## Verification Status

Verified directly against the codebase on `last_verified`: three-way provider selection, startup fallthrough, unavailable state, provider-specific guides, the read-only capability probe, and the shared observe-after-act rule.

Verified against upstream sources: `background-computer-use` provenance and divergence; `trycua/cua-driver` maintenance status, MIT license, install locations, CLI, and MCP documentation; AGPL licensing on Open Interpreter and Skyvern; absence of a public Apple equivalent to `SLEventPostToPid` in macOS 15/26 release notes; and the macOS 14.5 SkyLight authorization regression affecting yabai.

Verified locally with CUA Driver 0.23.2: the binary starts, exposes 56 MCP tools, and uses an implicit lifecycle session for MCP transport. The opt-in live contract test confirms every tool taught by the guide exists in that catalog.

**Still requires manual runtime proof on this Mac:** Accessibility and Screen Recording are not yet granted to CUA Driver, so a real read-only app/window observation and background action smoke test have not passed. Canvas-heavy application behavior also remains workflow-specific and unproven.
