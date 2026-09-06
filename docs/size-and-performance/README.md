---
status: current
owner: agent
last_verified: 2026-09-05
source_of_truth: true
---

# Size And Performance Work

Measured findings about how large Artist OS actually ships, where the weight
sits, and what can be removed without changing behavior.

Every number here was measured on a real packaged artifact, not estimated.
Section 6 of the audit gives the exact commands so a future reader can
re-measure instead of trusting a stale figure.

## Docs

- [01 App Size Audit](./01-app-size-audit.md) — full breakdown, the hypermotion
  finding, and three remediation options with honest trade-offs

## Headline

| | |
|---|---:|
| Packaged `.app` (mac-arm64) | **1033 MB** |
| `tools/hypermotion` | **575 MB — 55.7% of the app** |
| …of which hypermotion's own code | **0.2 MB** |
| Wrong-platform binaries shipped to macOS | **182 MB — 17.6% of the app** |
| App with hypermotion removed | **458 MB** |
| Realistic size off *current* config | **~1.3–1.4 GB** (measured build is stale) |

One dependency tree — reached through a tool whose own CLI is 12 KB — is the
difference between a normal Electron app and a heavy one.

## The one free win

182 MB of the mac build is Windows and Linux binaries from `onnxruntime-node`
that cannot execute on the machine they shipped to. They are behind a lazy
`import()` that never runs on those paths. The fix is a platform filter that
already exists five lines away in the same file for `vendor/ripgrep`.

No behavior change. Same waste exists on every platform's build.

## Adjacent findings worth knowing

Both affect anyone doing build or packaging work:

- **`asar: false`** is deliberate (`electron-builder.common.yml`), commented as
  avoiding "decompression overhead and click delays". Defensible for launch
  speed, but it means no packing, tens of thousands of loose files, and slower
  signing and notarization. Worth re-measuring the click-delay claim against
  current Electron before treating it as settled.
- **There is no size gate in CI.** `tools/` grew roughly 100 MB in one quarter
  with nothing to notice. A packaged-size check on the release job is the
  cheapest way to stop the trend from continuing silently.

## Related work

- Canvas security and reliability fixes: commits `ca0850b6e`, `b8de2f632`.
  Not size work, but they touch the same packaged surface.
