---
status: active
owner: agent
last_verified: 2026-09-06
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
pushed to `origin/main`. One trunk, no rival copies.

The root checkout at `/Users/michaelb.williams/RunnerOS` is on an old branch and
has untracked files belonging to other agents. Do not build or land from there.
[GIT-FACTS-ALWAYS-READ-ME.md](GIT-FACTS-ALWAYS-READ-ME.md) is the authority on
worktrees and is the file to read before your first commit.

## Verified, with the check that proves it

Every line here was run on the current trunk. Numbers are what the tooling
printed, not estimates.

| What | How it was checked | Result |
| --- | --- | --- |
| Test suite | `bun run test` | 7991 pass, 1 skip, 0 fail, across 685 files |
| Isolated tests | the loop in the root `test` script, one process each | all pass |
| Types | `bun run typecheck:all` | clean across all nine packages |
| Validation | `bun run validate:ci` | clean, including 6 locales at 1476 keys each |
| Build | `bun run build` | completes, assets validated |
| CI, Tests workflow | GitHub Actions, 6 shards on macOS and Linux | green |
| CI, Validate workflow | GitHub Actions | green |
| Image pipeline | `sharp` round trip, and the artwork suite | passes in ~187ms |
| Dependency advisories | `bun audit` | 30 vulnerable packages reduced to 10, the rest documented |

The suite is order-independent under sharding. That took real work and is easy
to break again: mocking a whole package poisons that package's own tests, so
those files carry an `.isolated.ts` suffix and run one process at a time. The
traps are written up in GIT-FACTS §5.

## What landed recently

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
a cross-origin redirect. What remains is listed with reasons in GIT-FACTS §8.

## Not verified, and honest about it

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

## Known broken

- **Eight root `package.json` scripts point at deleted files**: `release`,
  `check-version`, `fresh-start`, `oss:sync`, `sync-secrets`,
  `typecheck:staged`, `lint:i18n:staged`, `electron:dev:menu`. The most
  consequential is `release` — there is no release automation in the tree.
  Detail in [docs/updates/regular-updates-check.md](docs/updates/regular-updates-check.md) §6.
- **One reachable high-severity advisory has no clean dependency fix.**
  `gray-matter` pins an old YAML parser, and that parser reads agent memory
  files. The fix is a code change, not a bump.
- **The WhatsApp worker carries the only critical advisory** in the tree,
  through an old protobuf inside its signal library. The upstream fix was still
  a release candidate when this was written.
- **`validate-server.yml` pins an older bun** than the other four workflows.

## Keeping it this way

[docs/updates/regular-updates-check.md](docs/updates/regular-updates-check.md)
is the maintenance guide: a quarterly pass, a map of what breaks what when you
change a version, and the upgrades that have already been tried and reverted
with the measurements that justified reverting them. Read it before bumping
anything, particularly `sharp` and `electron`.

Before you hand off, the suite should be green and your work should be on
`main`. A red suite means CI can no longer tell anyone about a new break, which
is the entire reason it exists.
