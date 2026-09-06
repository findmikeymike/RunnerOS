---
status: current
owner: agent
last_verified: 2026-09-06
source_of_truth: true
---

# Regular Updates Check

The point of this file is that nobody should have to rediscover how this app
fits together every six months. It tells you what to check, in what order, what
breaks what, and which upgrades have already been tried and rejected.

Read [GIT-FACTS-ALWAYS-READ-ME.md](../../GIT-FACTS-ALWAYS-READ-ME.md) first for
where work lives and how it lands. This file is only about keeping the
dependencies current and the app reliable over time.

**Cadence.** Quarterly is enough for the routine pass. Do it sooner if a
security advisory lands on something in the shipping path, or if Electron cuts
a release that drops the version we are on out of its support window.

---

## 1. The ten-minute pass

Run these from the trunk worktree. None of them change anything.

```bash
bun audit
```

```bash
bun outdated
```

```bash
npx --yes is-my-node-vulnerable
```

Then read section 4 before you act on any of it. Roughly two thirds of what
`bun audit` reports is build tooling that never reaches a user, and several of
the remainder have already been investigated and deliberately left alone.

---

## 2. The coupling map — read this before changing a version

This is the part that costs people days. Each row is a thing that cannot be
updated on its own.

### Electron

Changing the Electron major touches six other places. Miss one and the failure
shows up at packaging time or, worse, at boot on a user's machine.

| Also update | Where | Why |
| --- | --- | --- |
| `electronVersion` | `apps/electron/electron-builder.common.yml` | electron-builder does not read the dependency; it will happily package against the wrong runtime |
| `engines.node` | root `package.json` | Electron's installer and electron-builder need a Node floor at least as high as the toolchain expects |
| `.nvmrc` | repo root | so a contributor's shell matches CI |
| `node-abi` | root `overrides`, if native rebuilds are ever re-enabled | `@electron/rebuild` ships an ABI table that lags new Electron majors |
| macOS minimum | `docs/creator-command-center/46-electron-runtime-upgrade-spec.md` | each Electron major raises it; this is a product decision, not a bump |
| `@types/node` | root `package.json` | should track the Node major that Electron actually ships |

Electron supports the latest three majors. At the time of writing that is 42,
43 and 44, and we are on 44. Falling off that list means no security patches,
so treat "44 is no longer in the supported three" as the real deadline rather
than picking a number of months.

Note that `bun install` no longer downloads the Electron binary. If a fresh
checkout has no Electron, that is expected — see GIT-FACTS §6.

### sharp and its native binaries

`sharp` is pinned exactly, in four places, and its native packages are pinned
alongside it in root `optionalDependencies`.

| Also update | Where |
| --- | --- |
| `sharp` | root, `apps/electron`, `packages/server-core`, `packages/session-tools-core` — all four, same exact version |
| `@img/sharp-*` | root `optionalDependencies`, must match the sharp version |
| `@img/sharp-libvips-*` | root `optionalDependencies`, matches the libvips version sharp expects, which is **not** the sharp version |

The packaged app excludes `node_modules` entirely, so these natives are copied
in through `extraResources`. `scripts/gate-sharp-natives.ts` refuses to package
without them, because a build shipped without them once and died at boot.

**Do not bump sharp past 0.34.5 without measuring SVG text rendering.** This has
been tried twice and reverted twice. The full reasoning is at the top of
`packages/shared/src/config/pango-backend.ts`, and GIT-FACTS §8 has the numbers.

### The rich-text editor

There are fourteen `@tiptap/*` packages and they must all move to the same
version together. The `prosemirror-*` entries in root `overrides` exist to hold
tiptap's peer dependencies at versions that agree with each other. If you bump
tiptap and the editor starts throwing about duplicate ProseMirror instances,
that is what those overrides are for.

### Bun

The CI pin appears in **five** workflow files. They have drifted before.

```bash
grep -rn 'bun-version' .github/workflows/
```

All of them should agree unless there is a written reason. At the time of
writing `validate-server.yml` is on 1.3.10 while the other four are on 1.3.13.

### React

`react` and `react-dom` must move together, and `packages/ui/package.json`
declares them as peer ranges, so that file needs the same treatment. We are on
18 while 19 is current. That is a deliberate lag, not an oversight — moving
majors here touches every renderer surface and wants its own spec.

### Transitive pins

Bun honours a **flat** `overrides` entry in the root `package.json`. It ignores
npm-style nested overrides and Yarn-style `resolutions` path keys — both were
tried on 2026-09-06 and silently did nothing while looking like they worked.
Always confirm with `bun audit` afterwards rather than trusting the entry.

An override also will not touch a nested copy whose parent pins it to an exact
version, or one that arrives through a git ref. Override the parent instead. In
either case check the installed tree rather than trusting the manifest:

```bash
find node_modules -type d -name '<package>'
```

Only override inside the same major. Forcing a consumer across a major boundary
is how an advisory becomes an outage.

---

## 3. Where we stood on 2026-09-06

Recorded so a future reader can see the size of the gap rather than guessing.
These will be stale; the point is the shape, not the numbers.

| Package | Ours | Upstream then | Note |
| --- | --- | --- | --- |
| electron | 44.2.0 | 44.2.0 | current; 45 in alpha |
| electron-builder | 26.8.1 | 26.15.3 | patch drift only |
| electron-updater | 6.8.9 | 6.8.9 | current |
| react / react-dom | 18.3.1 | 19.2.8 | one major behind, deliberate |
| typescript | 5.x | 7.0.2 | two majors behind |
| vite | 6.4.3 | 8.2.2 | two majors behind |
| tailwindcss | 4.1.18 | 4.3.3 | minor drift |
| sharp | 0.34.5 | 0.35.4 | **held on purpose**, see §2 |
| bun (CI pin) | 1.3.13 | 1.4.2 | four workflows; a fifth on 1.3.10 |
| @anthropic-ai/claude-agent-sdk | 0.3.220 | 0.3.263 | |
| @modelcontextprotocol/sdk | 1.29.0 | 1.30.0 | |
| @sentry/electron | 7.7.0 | 7.18.0 | |
| three | 0.184 | 0.185.1 | `@types/three` must match |
| zod | 4.x | 4.5.4 | |

Node floor is 22.12, `.nvmrc` says 24, and Electron 44 ships Node 24. Root
declares `@types/node` 25, which is ahead of the runtime we actually ship.

---

## 4. Upgrades already tried and rejected

Do not spend a day rediscovering these. Each one is written up properly in
[GIT-FACTS §8](../../GIT-FACTS-ALWAYS-READ-ME.md).

- **sharp 0.35.x** — reverted twice. Artwork composition went from 187ms to a
  10-second timeout; a single album cover took 16.4 seconds through the real
  handler. Measure in a fresh process if you try again; a warm font cache will
  tell you everything is fine when it is not.
- **`nanoid`, `uuid`, `brace-expansion`, `@xmldom/xmldom`, `extract-zip`,
  `music-metadata`, `file-type`** — either build-time only, or not reachable
  with the arguments the advisory needs, or no fixed version has been published,
  or pinned across a major by the WhatsApp library in a way no override crosses
  safely.

Two that were fixed the same day, and are worth knowing about because neither
was a version bump:

- **The critical protobuf** came in through `libsignal`, pulled from a GitHub
  ref pinning an exact version that a flat override does not touch. Overriding
  `libsignal` to the published `^6.0.0` fixed it, which is what the WhatsApp
  library's own next major does.
- **`gray-matter`'s YAML parser** is now bypassed by handing `gray-matter` an
  explicit engine backed by our own js-yaml 4. `bun audit` still lists js-yaml
  because the old copy is installed; it is no longer executed.

---

## 5. Verifying any update

Nothing counts until all four of these pass. The last one is the baseline, so
compare the number rather than just looking for the word "pass".

```bash
bun run typecheck:all
```

```bash
bun run validate:ci
```

```bash
bun run build
```

```bash
bun run test
```

The suite baseline is **8005 pass, 1 skip, 0 fail** across 686 files, plus the
isolated files the `test` script runs one process at a time. If your change
moves the pass count, find out why before landing.

For anything touching image handling, run the artwork test on its own and watch
the clock, because a timing regression there will not fail loudly:

```bash
bun test ./packages/session-tools-core/src/handlers/artwork-compose.test.ts
```

It should finish in about 200ms. Seconds means something is wrong.

For anything touching packaging, the gate is the thing to trust:

```bash
bun run scripts/gate-sharp-natives.ts gate
```

---

## 6. Known gaps, not yet addressed

Recorded honestly rather than left to be found by surprise.

- **Eight root `package.json` scripts point at files that no longer exist**:
  `release`, `check-version`, `fresh-start`, `oss:sync`, `sync-secrets`,
  `typecheck:staged`, `lint:i18n:staged`, `electron:dev:menu`. All were tracked
  once and deleted. `bun run release` fails, which means there is no release
  automation in the tree at all. Either restore them or remove the entries; a
  script that lies is worse than a missing one.
- **Windows and Linux packages have never been built** on Electron 44.
- **No signed macOS build**, so native notifications cannot be verified. A
  packaged app also does not expose a remote debugging port, so packaged
  smoke testing is manual.
- **`validate-server.yml` pins an older bun** than the other four workflows.

---

## 7. When you finish a pass

Update the table in §3, move anything you fixed out of §4, and change
`last_verified` at the top. If you rejected an upgrade, write down the
measurement that made you reject it — a rejection without a number is
indistinguishable from laziness to whoever reads this next.
