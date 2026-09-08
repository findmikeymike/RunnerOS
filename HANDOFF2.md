---
status: active
owner: agent
last_verified: 2026-09-08
worktree: /Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os
branch: main
scope: state of the tree, what has been verified, what has not
---

# Handoff 2: Where Artist OS Actually Stands

[HANDOFF1.md](HANDOFF1.md) explains what the product is and how the code is
organised. Read that first if you are new. This file answers a different
question: **what has been checked, what is known broken, and what nobody has
verified yet.**

The rule this file follows is that a claim without a check behind it does not
belong here. Where something is unverified it says so, rather than being left
out to make the picture look tidier.

## Where the code is

Trunk is `main`, in `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`,
with `origin/main` as its remote trunk. Verify the current local/remote SHA;
this document is not proof that a later change has been pushed.

The root checkout at `/Users/michaelb.williams/RunnerOS` is on an old branch and
has untracked files belonging to other agents. Do not build or land from there.
[GIT-FACTS-ALWAYS-READ-ME.md](GIT-FACTS-ALWAYS-READ-ME.md) is the authority on
worktrees and is the file to read before your first commit.

## Current integration evidence

The [2026-09-08 consolidation audit](docs/audits/artist-os-consolidation-2026-09-08.md)
records the final integrated commits, fresh combined checks, and remote state.
Feature checks are useful scope-specific evidence, not proof of the entire app:

- Steering (`aa53a41ba`): input remains available during work; pending updates
  survive blocked hooks. [Steering record](docs/backlog/steer-feature.md).
- Website Agent startup (`48608a694`): repairs an already-seeded library while
  preserving customization and deletion tombstones.
- Branding (`72d7791f2`): persistent paired focuses, durable selection, stable
  active-turn context, and hidden-starter privacy.
  [Feature evidence](docs/audits/branding-task-mode-hardening-2026-09-08.md).
- Agent focus rollout: the approved Branding UI now covers 27 agents, with
  mode-aware launches, scheduling/editors, next-turn switching and bounded
  capability expansion. [Checks and live limits](docs/audits/agent-focus-rollout-2026-09-08.md).
- Campaign cleanup (`81a2673df`): confirmed deletion, verified retained files in
  Past Releases, and local runtime cleanup. Saved global memories survive;
  outside-service events/posts are not canceled.
  [Retention and checks](docs/audits/campaign-cleanup-2026-09-08.md).
- Signals UX (`fc3a793fa`, landing `e9ab74b06`): shared setup and report navigation.
- Messaging boundaries (landing `69dd15768`): delegated agents retain target
  capability/permission limits; internal jobs stay out of ordinary conversation lists.

The user subsequently authorized installation and launch: the new canonical packaged
app is running, and its Workers page visibly includes Website Agent. See the audit for
process/path/signature evidence. Browser fixtures and temporary filesystem tests still
do not prove live provider behavior or real campaign deletion.

## Historical verification — September 6, 2026

The table below is retained historical evidence from the earlier maintenance
pass. It does **not** describe current trunk, current CI, or today's dependency
advisories. New combined results belong in the consolidation audit.

| What | How it was checked | Result |
| --- | --- | --- |
| Test suite | `bun run test` | 8005 pass, 1 skip, 0 fail, across 686 files |
| Isolated tests | the loop in the root `test` script, one process each | all pass |
| Types | `bun run typecheck:all` | clean across all nine packages |
| Validation | `bun run validate:ci` | clean, including 6 locales at 1476 keys each |
| Build | `bun run build` | completes, assets validated |
| CI, Tests workflow | GitHub Actions, 6 shards on macOS and Linux | green |
| CI, Validate workflow | GitHub Actions | green |
| Image pipeline | `sharp` round trip, and the artwork suite | passes in ~187ms |
| Dependency advisories | `bun audit` | 30 vulnerable packages reduced to 9, no critical, remainder documented |
| Frontmatter engine swap | parsed every real file on this machine and in the repo with both engines | 603 user files and 224 repo files, all identical |
| WhatsApp signal library | export surface, protobuf round trip, ECDH agreement, signature verify, worker bundle build | all pass on the patched version |

The suite is order-independent under sharding. That took real work and is easy
to break again: mocking a whole package poisons that package's own tests, so
those files carry an `.isolated.ts` suffix and run one process at a time. The
traps are written up in GIT-FACTS §5.

## Earlier platform integration

Electron moved from 39 to 44.2.0, so the app now runs Node 24 and Chromium 152.
That brought a Node floor of 22.12, a change to how the Electron binary is
fetched, and a macOS 13 minimum, which is a product decision recorded in
[spec 46](docs/creator-command-center/46-electron-runtime-upgrade-spec.md).

Remote workspace connections now validate TLS certificates by default, in all
three places that make them. Self-signed servers need `CRAFT_INSECURE_TLS=1`.

The packaged app refuses to build without sharp's native binaries, because a
build shipped without them once and died at boot.

Dependency advisories were cleared where a version bump could do it. The
auto-updater was the one that mattered: it leaked authorization headers across
a cross-origin redirect.

Two more needed something other than a bump. The only critical advisory arrived
through the WhatsApp worker's signal library, pinned to an exact old protobuf by
a git reference that a normal override does not reach; overriding that library
to its published version cleared it, which is what the library's own next major
release does. The one remaining reachable issue was an old YAML parser that
`gray-matter` will not unpin, now bypassed by giving `gray-matter` an explicit
engine. That swap was checked against 603 of the artist's real frontmatter files
and 224 in this repo, all of which parse identically.

What remains is listed with reasons in GIT-FACTS §8.

## Remaining platform acceptance

Nothing below is known broken. It is simply unchecked, and should not be
described as working.

- **Windows and Linux packages.** Never built on Electron 44. The scripts and
  the sharp gate exist for both; nobody has run them.
- **A signed macOS build.** No signing identity available, so notifications
  cannot be confirmed. Notification failures now log a warning naming signing
  as the likely cause, which is a diagnostic, not a fix.
- **Packaged-app smoke testing.** A packaged build does not expose a remote
  debugging port, so this is manual and has not been done end to end.
- **macOS 12.** Dropped by Electron 44. Whether that is acceptable is a product
  call; Electron 43 keeps it and is a two-line change.

## Previously recorded maintenance issues — recheck before acting

- **Eight root `package.json` scripts point at deleted files**: `release`,
  `check-version`, `fresh-start`, `oss:sync`, `sync-secrets`,
  `typecheck:staged`, `lint:i18n:staged`, `electron:dev:menu`. The most
  consequential is `release` — there is no release automation in the tree.
  Detail in [docs/updates/regular-updates-check.md](docs/updates/regular-updates-check.md) §6.
- **`validate-server.yml` pins an older bun** than the other four workflows.
- **`bun audit` still reports js-yaml**, and will keep doing so. The vulnerable
  copy is installed because `gray-matter` requires it at module load; nothing
  routes through it any more. GIT-FACTS §8 explains the arrangement.

## Keeping it this way

[docs/updates/regular-updates-check.md](docs/updates/regular-updates-check.md)
is the maintenance guide: a quarterly pass, a map of what breaks what when you
change a version, and the upgrades that have already been tried and reverted
with the measurements that justified reverting them. Read it before bumping
anything, particularly `sharp` and `electron`.

Before you hand off, the suite should be green and your work should be on
`main`. A red suite means CI can no longer tell anyone about a new break, which
is the entire reason it exists.
