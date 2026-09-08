# Artist OS consolidation — 2026-09-08

## Authority and scope

Canonical checkout: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`,
branch `main`. The root RunnerOS checkout and other product branches are not Artist OS.
This pass integrates completed Artist OS work, preserves unrelated/unfinished work,
and distinguishes source verification from the running app and external providers.
No app launch/restart, real campaign deletion, provider run, or paid operation was performed.

## Recent work accounted for

| Work | Commit / landing | Result |
|---|---|---|
| Conversation sidebar and topic presentation | `38e7b8986` and predecessors | Already on main; compact previews retained. |
| Mikey timed phoneme/viseme sync and warmup readiness | `0c3650bdc`, `30eb0438e` | Already on main; physical/provider acceptance remains separate. |
| Signals report rendering/recovery | `efd48a426`, integration `662813f25` | Already on main; historical 8,908-test snapshot is not today's whole-app certification. |
| Chat steering | `aa53a41ba` | Visible working composer; multiple pending steers preserved in order for the next injectable opportunity. They do not schedule one future response each. |
| Specialist task modes and Branding focus | `25c636ba9`, `72d7791f2` | Persistent in-chat selection; active turn context and hidden starter boundaries protected. |
| Website Agent in existing libraries | `48608a694`, landing `b913e1a36` | Required startup installation repaired; Site Builder remains a separate specialist. |
| Campaign cleanup | `81a2673df`, landing `27613e1ca` | Explicit confirmation, verified useful-file preservation in Past Releases, saved memories retained, disposable campaign data removed. |
| Signals setup/navigation | `fc3a793fa`, landing `e9ab74b06` | Shared two-track settings, explicit saves, one-off review, separate reports and saved insights. |
| Historical messaging/hidden-session boundaries | `8077e9c52`, final landing `69dd15768` | Target capability/permission limits and hidden-session boundaries restored; legitimate replies, drafts and attachment access preserved. |

Campaign deletion intentionally does not infer “usefulness” from arbitrary chat history:
saved global memories and declared/finished creative or business files survive;
disposable campaign runtime records do not. External service posts, ads, email and events
are not canceled by deleting a local campaign. The confirmation explains this.

## Verification and runtime status

- Campaign plus current main: **8,986 passed, 0 failed, 1 skipped**, 21 test processes.
- Signals caught up after campaign landing: **8,986 passed, 0 failed, 1 skipped**, 21 processes.
- Integrated Signals browser fixtures: **42 setup + 13 report checks passed**.
- All-workspace typechecks passed again on final production source `69dd15768`.
- Final production source `69dd15768`: **8,995 passed, 0 failed, 1 skipped**, 21 processes; server-core typecheck passed.
- Artist OS main (including Session/Pi/WhatsApp helpers), renderer, preload and resource builds passed.
- Campaign browser fixtures: **8 checks passed**, including the actual Campaigns menu and Past Releases filtering.
- Browser fixtures use real React controls with specified ancillary/provider stubs; they do not prove a live provider or real user-data deletion.
- A campaign fixture was initially started while its required renderer CSS was rebuilding; that invocation failed with ENOENT before assertions. It is rerun after the build, without changing product behavior.
- Historical guard-suite sandbox bind failures are tooling evidence, not production failures; the final full run requires localhost-capable execution.

The running package was identified at
`apps/electron/release-artist-os/mac-arm64/Artist OS.app` (PID 75244 at inspection),
using production profile `~/.artist-os/electron`, not the development profile.
Its unpacked resources must not be replaced while it runs: later chunks/new windows
could otherwise read a new renderer against an old main process. The completed update is staged at
`apps/electron/release-artist-os/staged-main/Artist OS.app`, compiled from production
source `69dd15768` (subsequent CI fixes change tests only). It includes main, renderer,
preload, resources, Session/Pi/WhatsApp subprocess payloads, current allowlisted CLI
runtimes, Claude SDK/native 0.3.258, and the verified VoiceCore helper. Artist OS variant
was checked in the compiled main bundle. Native dependencies were preserved/refreshed
from the current declared local installation; this is not a clean-machine reinstall.

The staged app is signed with the local Developer ID and canonical hardened-runtime
entitlements. Elevated `codesign --verify --deep --strict` passed for both the complete
app and VoiceCore helper. Its 1,381 payload files were checked: 1,369 exact hashes match,
12 changed native files differ only in code-signature bytes (Mach-O sections match).
Voice resources, including the original helper signature, remain byte-identical.
Receipts are beside the stage: `build-payload-verification.json` and
`signed-payload-verification.json`. No timestamping, notarization, upload, app launch,
or provider run was performed. Initial sandbox-only helper verification was misleading;
elevated verification proved it valid. The original outer package failed strict
verification, which the staged signing resolved. Signing initially failed while working space was low and succeeded after freeing
space; only this task's completed worktrees/build artifacts were removed.

**Installation pending:** the running original package remains untouched. Obtain
permission to close Artist OS, then replace the canonical package with the verified
stage while it is stopped. Do not reopen it without authorization. Source main and
remote are updated; the running process is intentionally not claimed current.

## Remote CI

GitHub Validate passed at `e9ab74b06`, while Tests failed. Inspection proved a whole-config
mock in `settings-default-thinking.test.ts` omitted required exports and polluted shard 1
on both OSes. The repair isolates that test and preserves real package exports
(`cab2ecde5`). A separate native filesystem notification test replaced fixed 300ms
positive-event sleeps with bounded event waits (`26f498ca6`), retaining real filesystem
and no-event assertions. All six post-merge discovery shards passed locally:
**8646 passed, 0 failed, 1 skipped**. The newly isolated settings suite passed 4 tests;
all **21 isolated suites also passed: 349 tests, zero failures**. Together the
final discovery shards and isolated processes verify **8,995 passed, 0 failed, 1 skipped**. Both test fixes are on remote main
at `26f498ca6`. Remote **Tests and Validate both passed** at integrated main
`b408373ba0350e4ccccab17963273e1af99b485d`: all six discovery shards and isolated
suites on both macOS and Linux. Evidence:
[Tests](https://github.com/findmikeymike/RunnerOS/actions/runs/34204064761),
[Validate](https://github.com/findmikeymike/RunnerOS/actions/runs/34204064729).
This final documentation-only evidence update leaves that verified runtime/test tree
unchanged; it does not claim a future CI run has already completed.
Use `gh --repo findmikeymike/RunnerOS`: the implicit gh default points to upstream,
which is not evidence for this repository.

## Branch disposition

The following is the complete local non-ancestor snapshot from the start of this pass.
Recent branches already ancestral to main were also checked; they need no re-merge.
Historical candidates are preserved rather than deleted. Only definitive cherry-minus
rows are called patch-equivalent. Old divergent architectures and other products are
not silently promoted into Artist OS.

## Exhaustive inventory

| Branch | Non-equivalent / equivalent commits | Disposition | Evidence |
|---|---:|---|---|
| archive/subagent-deep-research-trace | 0 / 1 | patch-equivalent | git cherry main branch returned only minus entries (content-equivalent commits). |
| archive/subagent-session-receipts | 0 / 1 | patch-equivalent | git cherry main branch returned only minus entries (content-equivalent commits). |
| archive/subagent-structured-tool-result | 0 / 1 | patch-equivalent | git cherry main branch returned only minus entries (content-equivalent commits). |
| claude/artist-os-codebase-review-89feec | 2 / 1 | superseded Artist OS | Matching main timeline commits cff879089 / 17775ea6c; subsequent cba79cee3/6c35af7d8 harden timeline. Archived tree. |
| claude/sad-clarke-10a760 | 1 / 0 | superseded Artist OS | Main a75371aa6 has same guarded execution subject; 42/70 affected files still byte-identical today. Archived tree. |
| codex/agent-add-2 | 1 / 0 | superseded Artist OS | Main 18f7fb862 integrates YouTube intelligence; CLI and CLI tests byte-identical to branch at that import commit. Later 75d89dffb limits unseen uploads. |
| codex/agent-adds | 23 / 0 | documented superseded stack | GIT-FACTS/REPO-TOPOLOGY explicitly say do not merge; rebased content audit recorded. Current TLS validation now present all three sites, so topology exception stale. |
| codex/agent-adds-secrets-presets | 30 / 0 | archived superseded feature stack | Archived 2026-08-30. Shared old Video Studio stack covered by topology content audit; expanded secrets main 1e372100e, Squad main 753ecdff3, later Video Studio commits. No byte-equivalence claim for every archived tail edit. |
| codex/agent-messaging-runtime | 9 / 0 | superseded import | Main 075f36651 imports messaging; AgentMessageService.ts and workspace-open-session-window.test.ts byte-identical at that import. Later lifecycle changes exist. |
| codex/agent-work-continued | 3 / 0 | superseded Artist OS | Main bd1aea2d0 playlist creation, 89de406a4 analyst integration, d6def78f3 bounded discovery replace early Spotify candidate. Archived tree. |
| codex/app-action-layer | 4 / 0 | archived unintegrated candidate | Archived 2026-08-30; old packages/session-tools-core/src/app-actions tree absent main. Not patch-equivalent; do not call integrated. No current completion authority for generic action-layer architecture. |
| codex/artist-os-runtime-isolation | 1 / 1 | superseded Artist OS | First commit cherry-equivalent. Remaining calendar/agenda candidate f0cf86adc: current AgendaPage has onCreateTask, creatingTask and z-overlay behavior; later HQ/UI refinements supersede styling. Archived tree. |
| codex/campaign-cleanup | 1 / 0 | landed | Parent integrated campaign cleanup through `27613e1ca`. |
| codex/credential-resolver-hardening | 0 / 2 | patch-equivalent | git cherry main branch returned only minus entries (content-equivalent commits). |
| codex/deps-pi-claude-codex | 3 / 3 | superseded runtime import | Three cherry-equivalent commits; main ad7aff5d1 auth fixes and c00f9f3bc video worker counterparts; 860be178a later runtime reliability port. Archived tree. |
| codex/deps-pi-claude-codex-personal | 35 / 1 | other-product/archived stack | Personal variant of archived runtime/secrets/video work. Main separately imported shared runtime; do not reconcile personal-only credential changes. |
| codex/fix-message-agent-status | 1 / 0 | superseded exact behavior | Current packages/ui/src/components/chat/turn-utils.ts:53 detects background start and marks running; original patch 54ab4dbed did same with regex. |
| codex/google-ads-update | 2 / 0 | superseded imported tooling | Main 6ac47248b records Google Ads provenance; 860be178a later updates bundled CLI. No direct merge of old tool snapshot. |
| codex/hidden-session-boundaries | 2 / 0 | recovered through `69dd15768` | dd41b91ac/7f7c2eb5b hidden list filtering and receipt-bound reply check absent. Main SessionManager getSessions:7124 maps hidden entries; sendAgentMessageFn:9989 checks workspace only. Adapt guard without breaking intentional internal hidden consumers. |
| codex/key-functions-vetting-report | 1 / 0 | historical report only | b34316049 adds docs/audits/2026-06-23-key-functions-vetting-report.md; absent main. Historical findings are not current verification and should not be presented as completed fixes. |
| codex/message-agent-boundaries | 1 / 0 | recovered through `69dd15768` | 8dd535210 target permission ceiling/source+skill subset checks absent. Current AgentMessageService:250-267 lets caller override target lists and mode; validation only caps parent permission. Adapt and test target ceiling. |
| codex/personal-ops | 45 / 3 | different product / WIP | Explicitly unrelated per GIT-FACTS and active-product worktree; personal/trade/voice tips explicitly WIP. Never merge into Artist OS. |
| codex/post-agents | 1 / 31 | superseded Artist OS | 31 cherry-equivalent; remaining aab9db3d0 counterpart main 74865402f. 13/35 affected files remain identical; later social integration extensive. Archived tree. |
| codex/secrets-settings-presets-up-to-snuff | 21 / 0 | archived superseded feature stack | Archived 2026-08-30. Shared old Video Studio stack covered by topology content audit; expanded secrets main 1e372100e, Squad main 753ecdff3, later Video Studio commits. No byte-equivalence claim for every archived tail edit. |
| codex/signals-ux-clarity | 1 / 0 | landed | Signals UX integrated through e9ab74b06. |
| codex/social-agent-adds | 0 / 4 | patch-equivalent | git cherry main branch returned only minus entries (content-equivalent commits). |
| codex/squad-video-director | 25 / 0 | archived superseded feature stack | Archived 2026-08-30. Shared old Video Studio stack covered by topology content audit; expanded secrets main 1e372100e, Squad main 753ecdff3, later Video Studio commits. No byte-equivalence claim for every archived tail edit. |
| codex/subagent-next-runtime | 0 / 1 | patch-equivalent | git cherry main branch returned only minus entries (content-equivalent commits). |
| codex/subagent-workflow-trace | 0 / 1 | patch-equivalent | git cherry main branch returned only minus entries (content-equivalent commits). |
| codex/subagent-workflow-ui | 0 / 1 | patch-equivalent | git cherry main branch returned only minus entries (content-equivalent commits). |
| codex/teams-prd-spec | 17 / 0 | legacy architecture candidate | Old packages/shared/src/teams and session team-runs architecture absent main; main explicitly integrated later Team Mode a9fc03166,27b6e23f7 using workspaces/team-mode.ts. Not patch-equivalent; preserve legacy branch, do not blindly merge. |
| codex/teams-swarm-foundation | 21 / 0 | legacy architecture candidate | Same old teams architecture plus swarm foundation; current Team Mode is a different later model, not proof every swarm capability shipped. Generic candidate outside current completed Artist OS task integration. |
| codex/trade-god-foundation | 90 / 0 | different product / WIP | Explicitly unrelated per GIT-FACTS and active-product worktree; personal/trade/voice tips explicitly WIP. Never merge into Artist OS. |
| codex/upstream-0-10-core | 1 / 0 | superseded runtime import | eb1701061 old upstream source/browser fixes; main 860be178a and subsequent source/browser fixes update those paths. Archived via deps core tree. |
| codex/upstream-0-10-personal | 30 / 0 | other-product/archived stack | Personal variant of archived runtime/secrets/video work. Main separately imported shared runtime; do not reconcile personal-only credential changes. |
| codex/video-agent-tools | 23 / 0 | archived superseded feature stack | Archived 2026-08-30. Shared old Video Studio stack covered by topology content audit; expanded secrets main 1e372100e, Squad main 753ecdff3, later Video Studio commits. No byte-equivalence claim for every archived tail edit. |
| codex/voice-hnic-v1 | 13 / 0 | different product / WIP | Explicitly unrelated per GIT-FACTS and active-product worktree; personal/trade/voice tips explicitly WIP. Never merge into Artist OS. |
| codex/work-products-output-architecture | 3 / 0 | archived unintegrated candidate | Archived 2026-08-30. output-index.ts introduced by candidate absent main. Current Outputs has later finals/storage changes; do not claim candidate whole architecture integrated. |
| feature/canva-agent | 1 / 0 | unverified legacy prototype | c6b50a3de May28 generic RunnerOS Canva source/agent/skill absent main. No tests; old runneros integration credential path and API instructions. Not proven completed Artist OS work; requires separate adoption/verification decision. |
| launch-os/main | 52 / 0 | different product / WIP | Explicitly unrelated per GIT-FACTS and active-product worktree; personal/trade/voice tips explicitly WIP. Never merge into Artist OS. |

## Limits

Patch equivalence is definitive only for cherry-minus rows. Subject counterpart and selected-file checks establish feature provenance, not byte-for-byte certification of every old tail patch. Explicit archived paths are excluded by canonical Git facts. The inventory itself was read-only. The two identified guard gaps were subsequently adapted, tested and landed as recorded above; other divergent candidates remain preserved. Raw initial inventory: `/tmp/artist-os-branch-audit-data.json`.
