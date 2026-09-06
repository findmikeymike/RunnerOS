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

**A mock fallback must forward every argument to the captured real.** Bun's
`mock.module` re-points the package's *live bindings*, so the real
`writeGlobalAgent(input, { globalAgentsDir })` calls `loadGlobalAgent` through
your stub. Write `(slug, options) => mine ?? realLoadGlobalAgent(slug, options)`,
never `realLoadGlobalAgent(slug)`. Three fallbacks that dropped `options` made
50 unrelated storage tests read the wrong directory — only under sharded CI.

**A mock that stubs a whole package belongs in `*.isolated.ts`.** Spreading
the real module into the factory does not neutralise the stubs: for every
name the stub covers, the package's *own* tests in the same process now get
the stub. `memory.test.ts` did this and broke 21 memory-package tests once
sharding put them together. Partial mocks with a scoped fallback are fine in
`bun test`; wholesale replacement is not.

**Reproduce CI with `--shard=N/6`, not with a list of files.** Positional
arguments put `bun test` in *filter* mode, which loads modules differently and
hid the leak above in every pairwise check. Discovery runs (`bun test`,
`--shard`) are the truth. To find a polluter inside discovery mode, exclude
halves of the file set with repeated `--path-ignore-patterns=<exact path>`
flags while `-t` limits execution to the victim.

**`bun test <path>.isolated.ts` runs nothing.** A bare path is a name filter;
`.isolated.ts` matches no test pattern, so bun prints "filters did not match"
and exits 1. Prefix with `./` to make it a path. The root `test` script did
this wrong from the day the convention started, so no isolated test had ever
run anywhere; two had rotted.

**A worktree cannot prove its dependencies are complete.** Node and
TypeScript resolve modules by walking *up* parent directories, and every
worktree here sits under `/Users/michaelb.williams/RunnerOS`, whose own
`node_modules` belongs to a different branch. Anything missing from your
lockfile is silently borrowed from there. `@types/three` was never declared;
typecheck passed in every worktree and failed on CI for weeks. When CI cannot
find a module you can, look for it six directories up before anywhere else:

```bash
bun run tsc --noEmit --explainFiles | grep -E '\.\./\.\./\.\./\.\./\.\./\.\./node_modules'
```

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

**`bun run build` works from the repo root** (fixed 2026-09-06). Until then the
root script pointed at `scripts/build.ts`, deleted in January 2026, so the root
alias failed while `apps/electron`'s own build was fine — the docs said "build"
and meant two different things. The root alias now delegates to the app build.
It runs lint first, so
an arbitrary `shadow-[...]` class fails the build on purpose: name the shadow
as a token in `packages/ui/src/styles/index.css`, allow it in
`apps/electron/eslint.config.mjs`, and use the name. `build:validate` checks the
bundled asset directories exist after `build:copy`.

**Remote workspaces validate TLS certificates by default** (since 2026-09-06).
A self-signed remote server fails to connect with an error that says so. The
per-machine opt-out is `CRAFT_INSECURE_TLS=1`; the CLI has `--tls-ca` for a
custom CA instead. Do not flip the default back.

**Tests that mock a Node builtin (`os`, `fs`, `path`) or set env at module
level must be `*.isolated.ts`.** `mock.module` on a builtin is process-global
and permanent, and shard order decides who loads first. `bun test` does not
pick up `.isolated.ts`; the root `test` script and the CI `isolated` job run
each one in its own process.

**CI needs `CRAFT_BUNDLED_ASSETS_ROOT`** (set in the workflow and the root
`test` script). Tests that load config defaults sync them from
`apps/electron/resources`; without it they pass only on a machine where the
app has already run once.

**Electron 44 requires macOS 13.** That is a product decision recorded in
[docs/creator-command-center/46-electron-runtime-upgrade-spec.md](docs/creator-command-center/46-electron-runtime-upgrade-spec.md);
43 keeps Monterey and is a two-line change.

---

## 7. Current state — 2026-09-06

- Trunk is `main` in `.worktrees/main/artist-os`, pushed. Runtime: Electron 44.2.0
  (Node 24, Chromium 152) since 2026-09-06 — see §6. `git log -1 main` for the SHA;
  this file will not keep it current.
- The suite is **green: 8090 pass, 0 fail**. Keep it that way. If you make it
  red, fix it before you hand off — a red suite means CI can no longer tell
  anyone about a *new* break, which is the whole point of having it.
- CI (`.github/workflows/test.yml`) runs on every push and PR, macOS and Linux,
  six shards each.
- Remote workspace TLS validation is **landed**, not open — all three call
  sites validate by default. See §6 for the `CRAFT_INSECURE_TLS=1` opt-out.
- Dependency advisories and what has been accepted: §8.

---

## 8. Dependency advisories — what is fixed, and what is knowingly not

Run `bun audit`. It reported 30 vulnerable packages on 2026-09-06; a pass that
day took it to 10. Do not "fix" the remaining ten without reading this first,
because most of them have already been looked at and rejected for a reason.

**What the packaged app actually exposes.** `apps/electron/electron-builder.common.yml`
excludes everything under `node_modules` and ships only bundled output plus a
short `extraResources` allowlist. So an advisory on a build-time package —
eslint, electron-builder, vite, `@types/*` — cannot reach a user. Check which
side of that line a finding falls on before treating it as urgent.

**How to fix a transitive pin.** Bun honours a flat `overrides` entry in the
root `package.json` and that cleared two thirds of these. It does **not** honour
npm-style nested overrides (`"parent": { "child": "x" }`) or Yarn-style
`resolutions` path keys (`"parent/child": "x"`) — both were tried, both were
silently ignored, and the vulnerable copy stayed on disk. Verify with
`bun audit` rather than assuming the entry did anything. Only override inside
the same major; forcing a consumer across a major is how you turn an advisory
into an outage.

### Accepted, with reasons

| What | Why it stays |
| --- | --- |
| `protobufjs` 6.8.8 (critical), `music-metadata`, `file-type`, `uuid` | All reached only through `@whiskeysockets/baileys` → the WhatsApp worker. The only upstream fix is baileys 7, which is a release candidate. Revisit when 7.0.0 ships stable. |
| `js-yaml` 3.14.2 (high) | `gray-matter` pins `^3.13.1` and 4.0.3 is its latest, so there is no upstream fix. A flat override would drag our own `js-yaml` 4 usage back to the v3 API. Fixing it properly means passing `gray-matter` a custom engine backed by our own js-yaml, in the four files that call `matter()`. |
| `nanoid` 3.3.3 (excalidraw) | The advisory needs a non-integer or negative size argument; excalidraw calls `nanoid()` with none. An override would also drag a sibling package down a major. |
| `brace-expansion`, `@xmldom/xmldom` | Build-time only. v1, v2 and v4 copies coexist, so no single override can satisfy them. |
| `extract-zip` | No fixed version has been published. |
| `sharp` 0.34.5 (high, libvips CVEs) | **Do not bump this.** See below. |

### The sharp trap, measured twice

`sharp` 0.34.5 carries four inherited libvips CVEs, and upgrading to 0.35.4
looks like an obvious win. It is not, and this has now been measured
independently on two occasions.

The reasoning is written out in full at the top of
`packages/shared/src/config/pango-backend.ts` — read it before you touch the
pin. Short version: on macOS, rendering SVG `<text>` through libvips is
pathologically slow unless Pango uses its fontconfig backend, and libvips 8.18
(which ships inside sharp 0.35) regresses that backend badly. Confirmed on
2026-09-06 by bumping to 0.35.4 and running the suite: `artwork_compose` went
from **187ms to a 10-second timeout**, and calling the handler directly took
**16.4 seconds for a single cover**. That is the Art Director agent stalling on
every render in the shipped app.

Reverted. If you try again, the thing to measure is
`packages/session-tools-core/src/handlers/artwork-compose.test.ts` in a **fresh
process** — the cost is paid per process, and a warm fontconfig cache will lie
to you. A microbenchmark that renders in a loop will report 70ms and tell you
nothing.

Note also that `@img/sharp-*` and `@img/sharp-libvips-*` are pinned explicitly
in root `optionalDependencies` for packaging. They must move in lockstep with
`sharp` or the packaged app dies at boot, which is what
`scripts/gate-sharp-natives.ts` exists to catch.

---

Deeper detail on worktree layout lives in
[docs/REPO-TOPOLOGY.md](docs/REPO-TOPOLOGY.md). Onboarding lives in
[HANDOFF1.md](HANDOFF1.md). **This file wins if they disagree.**
