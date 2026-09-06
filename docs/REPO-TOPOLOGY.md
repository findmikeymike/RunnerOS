# Repo topology: which tree is real, and how work lands

Written 2026-09-06. If the branch names below have moved on, trust the
commands in "Check it yourself" over the snapshot at the bottom.

## The one thing that confuses everyone

**Folder names do not match the branches inside them.**

`.worktrees/main/artist-os` is *not* on `main`. It is a working branch that
happens to live in a folder called `main`. The actual `main` branch is checked
out somewhere else entirely.

That single mismatch is the source of most "wait, where is my work?" moments.
Never infer the branch from the path. Run `git branch --show-current`.

## The shape of it

This is **one git repository** with roughly two dozen worktrees. A worktree is
a second folder with a different branch checked out, sharing one commit
history. So `git log` looks the same everywhere; only the working files differ.

The repo also hosts **several different products**, not just Artist OS:
`launch-os`, `trade-god`, `personal-ops`, `voice-hnic`. Those branches are
hundreds of commits from Artist OS's trunk and that is expected — they are
different software, not stale Artist OS work. Do not try to reconcile them.

Worktrees are grouped by intent:

| Path | Means |
|---|---|
| `.worktrees/integration/` | Reviewed, merged, trusted |
| `.worktrees/main/` | Active development (despite the name) |
| `.worktrees/active/` | Other products, in progress |
| `.worktrees/archive/` | Finished or abandoned; ignore |
| `.claude/worktrees/` | Agent scratch trees, short-lived |

## Trunk

**`main` is the trunk for Artist OS.** It is the compiled, reviewed north
star, and it is checked out at:

```
.worktrees/integration/artist-os-reviewed
```

`main` and `origin/main` should be identical. If they are not, that is a real
problem worth stopping for.

## How work lands

Feature branches never merge into each other. Everything reaches users through
`main`, in four steps:

1. **Commit** on your working branch, in your own worktree.
2. **Catch up:** merge `origin/main` *into* your branch. Conflicts get resolved
   on your branch, where a mistake is cheap, rather than on trunk.
3. **Verify:** run the suite after the merge, not before. Catching up is
   exactly when things break.
4. **Merge to trunk** and push.

Step 2 is the one people skip. A branch that is 8 commits behind is not a
superset of main, so "everything is in here" is false until you catch up.

## Two traps that have already bitten

**A dirty tree blocks the catch-up merge.** Several agents work in the same
worktree at once. If another agent has uncommitted edits to a file that an
incoming commit also touches, git refuses the merge outright. Check before
starting:

```bash
git diff --name-only HEAD...origin/main | sort > /tmp/in.txt
git status --porcelain | awk '{print $2}' | sort > /tmp/dirty.txt
comm -12 /tmp/in.txt /tmp/dirty.txt   # any output = blocked
```

Resolve it by getting the other agent's work committed. Do not stash or
discard someone else's changes to unblock yourself.

**Committed code can import an uncommitted file.** When several agents share a
tree, one can commit a file that imports another agent's untracked module. It
builds fine locally and is broken for everyone else. If you touch a file you
did not create, confirm its imports are tracked:

```bash
git ls-files --error-unmatch <path>   # errors if untracked
```

## Check it yourself

```bash
# Which branch am I actually on?
git branch --show-current

# Every worktree, its branch, and how far it has drifted from trunk
git worktree list

# Am I behind trunk? (left = behind, right = ahead)
git rev-list --left-right --count origin/main...HEAD

# Has my branch ever been pushed?
git ls-remote --heads origin "$(git branch --show-current)"
```

That last one matters. A branch with no remote exists on exactly one laptop.

## Snapshot, 2026-09-06 (end of day)

| Worktree | Branch | Behind / ahead of trunk |
|---|---|---|
| `.worktrees/integration/artist-os-reviewed` | `main` | 0 / 0 — trunk |
| `.worktrees/main/artist-os` | `codex/artist-website-engine` | 0 / 0 — level with trunk |
| `.claude/worktrees/artist-os-onboarding-0f75bd` | `claude/artist-os-onboarding-0f75bd` | merged into trunk; branch itself now behind |
| `.worktrees/active/artist-os-social-variants` | `codex/artist-os-social-variants-v2` | fully merged |
| `.worktrees/active/artist-os-social-variants-hardening` | `codex/artist-os-social-variants-hardening` | fully merged |
| `/` (repo root) | `codex/agent-adds` | see below |
| `.worktrees/active/launch-os` | `launch-os/main` | different product |

Branches marked merged are finished; their worktrees are safe to leave alone.

**Trunk is 38 commits ahead of `origin/main` and none of it is pushed.** Until
it is, everything from 2026-09-04 onward exists on one machine only.

### What landed on 2026-09-06, in order

1. `codex/artist-website-engine` caught up from `origin/main` (8 commits, two
   spec-index conflicts) and was fast-forwarded onto trunk.
2. `claude/artist-os-onboarding-0f75bd` merged in (17 commits, one conflict:
   both branches had fixed the same resource-bundle test; theirs was kept).
   It surfaced one undeclared RPC channel, fixed as `141ef45f6`.
3. Trunk fast-forwarded again. Suite: 8075 pass, 9 fail, all nine
   pre-existing.

### `codex/agent-adds` is a mirage — do not merge it

It reads as 23 unmerged commits and produces 51 conflicts on a dry run, but
every feature line on it was checked against trunk **by content** and is
already there: all 17 Video Studio commits are byte-identical, the 53-file
runtime port is byte-identical, and monid, the lottie source, the webhook slug
fix and the settings presets all exist on trunk. Git counts them as unmerged
only because that history was rebased. Merging it would re-fight conflicts to
arrive at code trunk already has.

The one thing on it trunk lacks is `dc48b0611`'s TLS half: remote workspace
connections currently run with `tlsRejectUnauthorized: false` in three places
(`main/handlers/workspace.ts`, `preload/bootstrap.ts` twice). The fix flips
that to validate by default with a `CRAFT_INSECURE_TLS=1` escape hatch. It is
the right default but it breaks anyone using a self-signed remote server, so
it is a product decision, not a merge. Once decided, archive the branch.
