# Upstream Provenance

This directory is a **vendored copy**, not a submodule. Record any sync or local
change here so the next person does not have to reconstruct history by hand.

## Source

| | |
| --- | --- |
| Repository | https://github.com/actuallyepic/background-computer-use |
| License | MIT (Anupam Batra) — see `LICENSE` |
| Vendored commit | `dcf55a3feee557ebdcda4afa6241c82dc6abdd8c` ("Expose Swift runtime package surface", 2026-04-27) |
| Vendored on | 2026-05-02 (`066cf1e8a` in this repo) |

Verified 2026-09-01 by diffing this tree against upstream at that SHA.

## Why vendored rather than submoduled

Recorded in `066cf1e8a` and still current: the package is small (~1.3 MB of Swift
source), the relationship is one-way (we consume, we do not co-develop), and
submodules tax every clone with state-management ceremony that is not worth it
at this size.

## Local changes

Everything below is intentional. Preserve it across any future sync.

| File | Change | Why | Landed in |
| --- | --- | --- | --- |
| `Package.swift` | `swift-tools-version: 6.2` → `6.1` | Build on stock Xcode 16 | `066cf1e8a` |
| `Package.swift` | `6.1` → `6.0` | Further toolchain compatibility | `f96de7843` |
| `script/bootstrap_signing_identity.sh` | Toolchain version tweak (1 line) | Same reason | `066cf1e8a` |

Nothing else in this tree differs from upstream at the vendored SHA. In
particular `script/build_and_run.sh` is byte-identical to upstream — an earlier
review incorrectly recorded it as locally simplified.

## Upstream state (checked 2026-09-01)

The repository is **effectively dormant**: 246 stars, 0 open issues, single
author, last push 2026-05-05 — four months without activity.

Two commits exist after the vendored SHA. Neither has been taken:

| Commit | Summary | Decision |
| --- | --- | --- |
| `bc7f19a` | "Add installable computer use skill" — adds `SKILL.md`, an `openai.yaml` agent config, `package_release.sh`, and a Python request script (442 insertions) | **Skip.** Packaging for other people's agent setups. Artist OS integrates through its own MCP bridge, and this would introduce a Python dependency the codebase deliberately avoids. |
| `52116ac` | "Fix default runtime build path" — restructures release-build binary path resolution in `script/build_and_run.sh` | **Optional.** Genuinely applies, since our copy of that script is unmodified. Only affects the `BACKGROUND_COMPUTER_USE_RELEASE_BUILD=1` path, which Artist OS does not currently use. Take it if release builds are ever needed. |

## Risk

This package posts input events through undocumented `SkyLight.framework`
private APIs (`SLEventPostToPid`), which is what allows it to drive an app
**without stealing the user's cursor**. Apple ships no public equivalent, so the
private surface is unavoidable for this capability rather than a choice made
here.

The realistic failure is **silent**, not loud. macOS 14.5 introduced an
authorization check that turned equivalent SkyLight calls into no-ops for window
managers such as yabai — the calls still reported success while doing nothing.
With a dormant upstream there is no one to fix a comparable regression.

Artist OS mitigates this by treating this package as a **fallback** provider
rather than the only path. See
`docs/creator-command-center/32-computer-use-provider-strategy-spec.md`.

## Syncing

1. Diff this tree against the new upstream SHA.
2. Re-apply every row in **Local changes** above.
3. Update the vendored SHA, date, and upstream-state section here.
4. Rebuild and re-run the computer-use health check before trusting it.
