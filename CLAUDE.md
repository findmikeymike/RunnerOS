# Artist OS — agent entry point

## Before you touch git, read this

**[GIT-FACTS-ALWAYS-READ-ME.md](GIT-FACTS-ALWAYS-READ-ME.md)** — required
reading before your first commit, branch, or merge. It is short. Read it.

It covers where the real app lives, how work gets onto `main`, when to tell the
user a branch is drifting, and the traps that have already cost this project
days.

## The short version

**The real app is `.worktrees/main/artist-os`, on branch `main`.** If your work
is not on `main`, it is not in the product.

Never assume from the folder name. Verify:

```bash
git branch --show-current
git worktree list
```

Every session, tell the user in one line where you are and how the work will
get home: *"Working in `<folder>` on `<branch>`; I'll merge main in, run the
suite, then land it on main."*

## Non-negotiables

- **Never `git add -A`** — other agents have uncommitted files in this tree.
  Stage your own paths by name. Never `git checkout .`.
- **Never bare `git stash` / `git stash pop`** — the stash is shared across all
  worktrees; you can swallow another agent's work. Use a WIP commit.
- **Never commit unless asked.**
- **Tell the user when a branch passes 10 commits, 50 files, or 3 days** since
  it last reached `main`. Do not wait to be asked.
- **Always pass the ignore flags to bun test**, or you will "fix" phantom
  failures from the packaged app:

```bash
PANGOCAIRO_BACKEND=fontconfig bun test \
  --path-ignore-patterns='**/release-artist-os/**' \
  --path-ignore-patterns='**/dist/**'
```

## Known-failing tests — not your regression

The suite is **8075 pass, 9 fail**. Those nine are pre-existing and documented
in GIT-FACTS. Do not claim green until they are actually fixed, and do not
report them as something you broke.

## Other docs

- [docs/REPO-TOPOLOGY.md](docs/REPO-TOPOLOGY.md) — worktree layout in depth
- [HANDOFF1.md](HANDOFF1.md) — codebase onboarding

GIT-FACTS wins if any of these disagree.
