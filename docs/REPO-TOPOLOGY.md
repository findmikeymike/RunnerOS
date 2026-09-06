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

## Snapshot, 2026-09-06

| Worktree | Branch | Behind / ahead of trunk |
|---|---|---|
| `.worktrees/integration/artist-os-reviewed` | `main` | 0 / 0 — trunk |
| `.worktrees/main/artist-os` | `codex/artist-website-engine` | 8 / 16 |
| `.worktrees/active/artist-os-social-variants` | `codex/artist-os-social-variants-v2` | 83 / 0 |
| `.worktrees/active/artist-os-social-variants-hardening` | `codex/artist-os-social-variants-hardening` | 82 / 0 |
| `.worktrees/active/launch-os` | `launch-os/main` | 0 / 35 — different product |

The Artist OS branches showing "ahead 0" are fully merged; their worktrees are
finished and safe to leave alone.

`codex/artist-website-engine` holds 16 commits that exist on **one machine
only** — it has never been pushed. Until it is, a dead drive loses all of it.
