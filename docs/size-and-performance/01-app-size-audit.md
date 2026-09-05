---
status: current
owner: agent
last_verified: 2026-09-05
source_of_truth: true
---

# App Size Audit — Where The Gigabyte Goes

Measured 2026-09-05 against a real packaged artifact. No estimates: every
figure below came from `du` on the built `.app`, and §6 reproduces the
measurement so this doc can be re-checked rather than believed.

## 1. What was measured, and the caveat that matters

The artifact measured was:

    apps/electron/release/mac-arm64/Runner.app

That is the **Runner** variant. Artist OS is not measured separately because
`electron-builder.artist-os.yml` is `extends: ./electron-builder.common.yml`
and overrides only branding — `appId`, `productName`, icons, protocol scheme,
`directories.output: release-artist-os`. The `files:` and `extraResources:`
payload lists are shared, so the size characteristics are the same app.

**The artifact is stale.** It was built **2026-05-26**, roughly three and a half
months before this audit, and predates several entries now in the config (§4).
Everything below is therefore a *floor*, not a ceiling.

No DMG or ZIP exists in `release/` — only the unpacked `.app`. Compression will
cut the download substantially, but no compressed figure is quoted here because
none was measured.

## 2. Top-level breakdown

| Layer | Size | Note |
|---|---:|---|
| **Total `.app`** | **1033 MB** | |
| `Contents/Resources` | 772 MB | |
| └ `Resources/app` | 766 MB | the product payload |
| `Contents/Frameworks` | 255 MB | |
| └ `Electron Framework.framework` | 253 MB | the floor; every Electron app pays it |
| `Contents/_CodeSignature` | 6.2 MB | inflated by `asar: false` (file count) |
| `Resources/messaging-whatsapp-worker` | 5.6 MB | |

The Electron runtime is not the problem. The payload is **3× the runtime**.

### Inside `Resources/app`

| | Size | Share of app |
|---|---:|---:|
| `tools/` | 575 MB | 55.7% |
| `dist/` | 139 MB | 13.5% |
| `resources/` | 43 MB | 4.2% |
| `src/` | 8.9 MB | 0.9% |

`tools/` contains exactly one directory in this build: `hypermotion`.

## 3. The finding: hypermotion is 56% of the app

| | Size | Share |
|---|---:|---|
| `tools/hypermotion` total | **575 MB** | **55.7% of the whole app** |
| └ its `node_modules` | 574 MB | 99.96% of hypermotion |
| └ its **own code** | **0.2 MB** | 0.04% — `bin/` is 12 KB |
| **App with hypermotion removed** | **458 MB** | |

The Hypermotion **agent** costs nothing. It is a persona in
`packages/shared/src/agent-definitions/starter-templates.ts:599`
(`hypermotion-agent`, skills `hyperframes` + `spotify-canvas-video`). The
**tool's** own CLI is 12 KB. Every byte of the 575 MB is transitive
dependencies of a package that declares three:

```json
"dependencies": {
  "@remotion/cli": "4.0.484",
  "hyperframes": "0.6.47",
  "zod": "4.3.6"
}
```
— `tools/hypermotion/package.json`

### Where hypermotion's 575 MB goes

| Package | Size |
|---|---:|
| `onnxruntime-node` | 254 MB |
| `@rspack` | 41 MB |
| `@remotion` | 39 MB |
| `hyperframes` | 27 MB |
| `chromium-bidi` | 19 MB |
| `@img` (sharp) | 16 MB |
| `@google` | 14 MB |
| `puppeteer-core` | 13 MB |
| `esbuild` + `@esbuild` | 20 MB |
| `mediabunny` | 9.8 MB |
| `web-streams-polyfill` | 8.7 MB |

`onnxruntime-node` alone is **24.6% of the entire application**.

### 182 MB that cannot run

`onnxruntime-node` ships every platform's prebuilt binaries in one package, and
the mac build carries all of them:

```
bin/napi-v6/win32          127 MB   ← cannot execute on macOS
bin/napi-v6/linux           55 MB   ← cannot execute on macOS
bin/napi-v6/darwin/arm64    72 MB   ← the only one that runs
```

**182 MB — 17.6% of the app — is binaries for operating systems the user is not
running.** The same waste exists in the Windows and Linux builds, mirrored.

Two facts make this safe to strip:

1. **It is never loaded on those paths.** `onnxruntime-node` powers image
   segmentation (background masking) inside `hyperframes/dist/cli.js`, and it is
   reached through a single lazy `import()`, not a top-level require. The
   wrong-platform copies are not touched on any code path.
2. **The precedent is five lines away.** `electron-builder.common.yml` already
   platform-filters `vendor/ripgrep` at lines 260–261, then immediately copies
   hypermotion with no filter at all:

```yaml
    - from: ../../tools/hypermotion/node_modules
      to: app/tools/hypermotion/node_modules
      filter:
        - "**/*"
```
— `apps/electron/electron-builder.common.yml:267` (mac) and `:370` (win)

`filter: ["**/*"]` is what copies the other platforms' binaries.

## 4. The measured number is understated

The 2026-05-26 artifact does **not** contain entries that are in the current
config's `files:` / `extraResources:` lists:

| Missing from artifact | Size | Source |
|---|---:|---|
| `tools/google-ads` | 85 MB | in `files:`, present in tree |
| `tools/printify` | 18 MB | in `files:`, present in tree |
| `@anthropic-ai/claude-agent-sdk` | 64 MB | `extraResources` |
| `vendor/bun` | — | not in tree; downloaded by build script |
| `vendor/codex` | — | not in tree; downloaded by build script |
| `vendor/copilot` | — | not in tree; copied from `node_modules` by build script |

A build off current config is realistically **~1.3–1.4 GB installed**. The three
`vendor/` binaries are unmeasured because they are fetched at build time and
absent from a clean checkout — that part of the projection is an estimate and is
flagged as such.

## 5. Options, with honest trade-offs

Ordered by effort, not by size.

**1. Filter wrong-platform ONNX binaries — 182 MB, no behavior change.**
Add `!node_modules/onnxruntime-node/bin/napi-v6/win32/**` and `.../linux/**` to
the mac block, and the mirrored exclusions to the Windows and Linux blocks.
Mirrors the existing ripgrep filter. Takes the app to ~851 MB. Do this
regardless of what is decided below.

**2. Fetch the ML runtime on first use — a further 72 MB.**
`onnxruntime-node` is a **hard** dependency of `hyperframes`, not an optional
one, so it cannot simply be dropped. But it is already lazy-imported and only
segmentation needs it, so a first-use download is viable. Costs: a download
path, a progress surface, and an offline story for an artist with no connection.

**3. Ship hypermotion as an optional add-on — the full 575 MB.**
Biggest win by far, and the most product surface to design. Today every install
pays a 575 MB tax so that motion graphics work instantly for the subset of
artists who use them.

Option 1 is packaging hygiene. **Options 2 and 3 are product decisions, not
packaging tweaks**, and should be decided as such rather than slipped into a
build change.

## 6. Reproducing this

Nothing here needs to be taken on trust. From the repo root:

```bash
APP=apps/electron/release/mac-arm64/Runner.app

du -sh "$APP"                                   # total
du -sh "$APP"/Contents/*                        # runtime vs payload
du -sh "$APP"/Contents/Resources/app/*          # payload breakdown
du -sh "$APP"/Contents/Resources/app/tools/*    # per-tool
du -sh "$APP"/Contents/Resources/app/tools/hypermotion/node_modules/* | sort -rh | head
du -sh "$APP"/Contents/Resources/app/tools/hypermotion/node_modules/onnxruntime-node/bin/napi-v*/*
stat -f "%Sm" "$APP"                            # build date — check for staleness
```

If `release/` is empty, build first with `bun run electron:build`. Confirm the
build date before quoting any figure from this document: an artifact more than a
few weeks old will understate the current size, exactly as the one audited here
did.

## 7. Open questions

1. **Is a size gate wanted in CI?** `tools/` grew ~100 MB in a quarter with
   nothing to notice. A packaged-size assertion on the release job is cheap.
2. **Does the `asar: false` click-delay claim still hold?** It is commented as a
   deliberate launch-speed trade in `electron-builder.common.yml`, but the
   measurement behind it is not recorded anywhere and Electron has moved since.
3. **What is the real total disk footprint?** The `.app` is one part. If the
   omnirouter sidecar is ~1.8 GB installed, an artist is at **3+ GB** before
   storing a single render — and this app generates video. Neither omnirouter nor
   the Zero CLI appears anywhere in this tree, so both are genuinely separate
   installs and outside the numbers above; someone should measure them and record
   the combined figure here.
