# GIT FACTS — ALWAYS READ ME FIRST

Read this before your first commit, branch, or merge. It takes one minute and
prevents the failure that has already cost this project days: work that is
finished, correct, and sitting somewhere nobody can find.

---

## 1. The one fact that matters

**The real app lives here:**

```
/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os     branch: main
```

That folder is the compiled, updated, authoritative Artist OS. It holds the
`main` branch, the built `Artist OS.app`, and everything that ships. It matches
`origin/main` on GitHub.

If your work is not on `main`, it is not in the product yet. It does not matter
how good it is or how long it took.

**Verify, never assume:**

```bash
git branch --show-current      # which branch am I really on?
git worktree list              # where does [main] live right now?
```

Folder names have lied before. Until 2026-09-06 the folder called `main` had a
feature branch in it and the real `main` was parked somewhere else entirely.
That cost a full session of confusion. The commands above cannot lie.

---

## 2. This repo has many worktrees, one history

A worktree is another folder with a different branch checked out, sharing one
commit history. `git log` looks the same in all of them; only the working files
differ.

The repo also hosts **several unrelated products**: `launch-os`, `trade-god`,
`personal-ops`, `voice-hnic`. Those branches sit hundreds of commits from
Artist OS's trunk and that is correct. They are different software. Never try
to reconcile them.

| Path | Means |
|---|---|
| `.worktrees/main/artist-os` | **Trunk. The real app.** |
| `.worktrees/active/` | Other products, in progress |
| `.worktrees/archive/` | Finished or abandoned. Ignore. |
| `.claude/worktrees/` | Agent scratch trees, short-lived |

Name any new worktree after the work it does, not after where you wish it sat.

---

## 3. Rules you must follow

### Know where you are, every session
Run `git branch --show-current` before you touch anything. State it in your
first message to the user. One line: *"Working in `<folder>` on branch
`<branch>`."*

### Say how the work gets home, before you start
Before writing code, tell the user your landing plan in one sentence:
*"When this is done I'll merge `main` in, run the suite, then merge to `main`
and push."* If you cannot say how it lands, do not start.

### Tell the user when a branch is getting heavy
Check as you go:

```bash
git rev-list --count origin/main..HEAD    # commits ahead
git diff --stat origin/main..HEAD | tail -1
```

Tell the user it is time to land the work when **any** of these is true:

- **10 or more commits** ahead of `main`
- **50 or more files** changed
- **3 days** since the branch last reached `main`
- You are about to start something unrelated to what the branch is for

Say it plainly: *"This branch is 12 commits and 60 files ahead of main. It is
time to land it before it drifts further."* Do not wait to be asked. A branch
that drifts far enough becomes a merge nobody wants to do, and then it dies.

### Never let a branch fall behind
Catch up **before** you think you are finished, not after:

```bash
git fetch origin && git merge origin/main    # then run the suite
```

Conflicts are cheap on your branch and expensive on trunk. A branch that is
behind `main` is not a superset of `main`, so "it's all in here" is false.

### Push. Every day.
An unpushed branch exists on exactly one laptop.

```bash
git ls-remote --heads origin "$(git branch --show-current)"   # empty = never pushed
```

On 2026-09-06 this repo had 39 commits, six sessions of work, that existed
nowhere but one machine.

---

## 4. Landing work on main — the only approved path

Feature branches never merge into each other. Everything reaches users through
`main`:

```bash
# 1. commit your work
git status                                   # yours only — never `git add -A`

# 2. catch up from trunk, resolve conflicts HERE
git fetch origin && git merge origin/main

# 3. verify AFTER the merge — catching up is exactly when things break
PANGOCAIRO_BACKEND=fontconfig bun test \
  --path-ignore-patterns='**/release-artist-os/**' \
  --path-ignore-patterns='**/dist/**'

# 4. land it and push
git checkout main && git merge --ff-only <your-branch> && git push origin main
```

Step 2 is the one people skip. Do not skip step 2.

---

## 5. Traps that have already bitten. Do not rediscover these.

**A shared tree blocks merges.** Several agents work in the same folder. If
another agent has uncommitted edits to a file your incoming commits touch, git
refuses the merge. Check first:

```bash
git diff --name-only HEAD...origin/main | sort > /tmp/in.txt
git status --porcelain | awk '{print $2}' | sort > /tmp/dirty.txt
comm -12 /tmp/in.txt /tmp/dirty.txt      # any output = blocked
```

Get the other agent's work committed. **Never stash or discard someone else's
changes** to unblock yourself. The stash stack is shared across every worktree,
so a bare `git stash pop` can swallow another agent's work. Use a temporary WIP
commit instead.

**Committed code can import an uncommitted file.** One agent commits a file
that imports another agent's untracked module. Builds locally, broken for
everyone else. If you touch a file you did not create:

```bash
git ls-files --error-unmatch <path>      # errors if untracked
```

**Bun test arguments are substring filters, not paths.** `bun test tools/squad`
also matches the copies inside the packaged `Artist OS.app`, which are stale
and will report failures that are not real. This wasted an entire debugging
session. Always pass:

```bash
--path-ignore-patterns='**/release-artist-os/**' --path-ignore-patterns='**/dist/**'
```

**Never `git add -A`.** Other agents have uncommitted files in this tree right
now. Stage your own paths, explicitly, by name. Never `git checkout .`.

**A branch that looks unmerged may already be merged.** `codex/agent-adds`
reads as 23 unmerged commits and 51 conflicts, but every line of it is already
on trunk byte-for-byte; the history was rebased, so git cannot tell. Before
merging anything that looks stale, check by **content**:

```bash
git log --cherry-pick --right-only --no-merges --oneline HEAD...<branch>
```

Empty output means trunk already has it. Archive the branch instead of merging.

---

## 6. Runtime and tooling facts (Electron 44, since 2026-09-06)

**Node ≥ 22.12 is required for anything that touches Electron or packaging.**
Electron's installer, electron-builder 26.15 and Playwright all refuse older
Node. The system default here is 18 and there are 22.x and 24.x under nvm.
Put one first on PATH before packaging, or run the tool under `bun`:

```bash
export PATH="$HOME/.nvm/versions/node/v24.8.0/bin:$PATH"
```

**`bun install` no longer downloads the Electron runtime.** Since Electron 42
the binary is fetched on the first `electron` invocation, so
`node_modules/electron/dist` is absent after a fresh install. Fetch it
deliberately with `cd node_modules/electron && bun install.js` (bun, not node).

**Packaging paths are not the same thing.**

| Script | Signs? | Use it for |
|---|---|---|
| `bun run electron:dist:artist-os` | no | verification builds |
| `bun run electron:dist:artist-os:mac` | yes — needs `VOICECORE_MOONSHINE_SIGN_IDENTITY` | releases |
| `apps/electron/scripts/build-dmg.sh` | optional | the older Runner DMG path |

All three now refuse to package if sharp's native binaries are missing for the
target arch (`scripts/gate-sharp-natives.ts`). That gate exists because a
package without them shipped on 2026-09-05 and died at boot.

**`bun run build` (and so `bun run start`) is broken on `main` for two
pre-existing reasons unrelated to Electron:** six design-rule lint errors, and
`build:validate` referencing a script that does not exist. Packaging does not
run either step, which is how nobody noticed. Until they are fixed, build for a
dev launch with the individual steps (`build:main`, `build:preload`,
`build:preload-toolbar`, `build:interceptor`, `build:renderer`, `build:copy`).

**Electron 44 requires macOS 13.** That is a product decision recorded in
[docs/creator-command-center/46-electron-runtime-upgrade-spec.md](docs/creator-command-center/46-electron-runtime-upgrade-spec.md);
43 keeps Monterey and is a two-line change.

---

## 7. Current state — 2026-09-06

- Trunk is `main` at `23b403e9c`, in `.worktrees/main/artist-os`, pushed.
- The suite is **green: 8090 pass, 0 fail**. Keep it that way. If you make it
  red, fix it before you hand off — a red suite means CI can no longer tell
  anyone about a *new* break, which is the whole point of having it.
- CI (`.github/workflows/test.yml`) runs on every push and PR, macOS and Linux,
  six shards each.
- One open decision: remote workspace connections currently skip TLS
  certificate validation in three places. The fix exists on `codex/agent-adds`
  but changes behaviour for self-signed remote servers. Product call, not a
  merge.

Deeper detail on worktree layout lives in
[docs/REPO-TOPOLOGY.md](docs/REPO-TOPOLOGY.md). Onboarding lives in
[HANDOFF1.md](HANDOFF1.md). **This file wins if they disagree.**
