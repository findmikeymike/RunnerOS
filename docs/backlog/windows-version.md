---
status: backlog
owner: agent
last_verified: 2026-07-07
source_of_truth: false
---

# Windows Version

Backlog for making RunnerOS agents, tools, and packaged desktop builds work cleanly on Windows/PC.

## Goal

Users on Windows should be able to install the app, add credentials in Settings, and run core agents without manual CLI/path repair.

## Compatibility Matrix Needed

Create and maintain a tool/runtime matrix:

| Tool / source | mac arm | mac intel | windows x64 | windows arm | linux x64 | needs token | needs browser | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Shopify | likely OK | likely OK | likely OK | likely OK | likely OK | `SHOPIFY_SHOP`, `SHOPIFY_ACCESS_TOKEN` | no | pure Node wrapper; needs real-store smoke |
| Printify | bundled | missing | missing | missing | missing | `PRINTIFY_API_TOKEN` | no | bundle/install non-Mac binaries |
| Google Ads | bundled | bundled | bundled | missing | bundled | Google Ads creds/cache | no | windows arm missing |
| YouTube Research | bundled | bundled | bundled | bundled | bundled | YouTube API key/cache | no | verify packaged PC path |
| Ads browser operator | needs QA | needs QA | needs QA | needs QA | needs QA | platform accounts | yes | browser/CDP path detection needed |
| Printing Press Social | needs QA | needs QA | needs QA | needs QA | needs QA | platform creds | browser/CLI | currently dirty work in progress |

## First Priorities

1. Bundle Printify Windows x64 binary at `tools/printify/bin/win32-x64/printify-pp-cli.exe`.
2. Bundle Printify Windows arm64 binary if upstream provides it.
3. Bundle Printify Linux x64/arm64 if app distribution supports Linux.
4. Add provenance rows and SHA256 values to `tools/printify/THIRD_PARTY.md`.
5. Build a Windows packaged app smoke: launch app, open Settings, verify Printify source status, run `doctor`.
6. Add a simple runtime compatibility report in Settings or diagnostics so missing platform binaries are obvious.

## Agent / Tool Rules For Windows

- Do not rely on shell-specific PATH behavior.
- Prefer bundled binaries or explicit `*_CLI` env vars.
- Use Node path APIs, not slash-joined command strings.
- Every write-capable commerce/social/ads command must remain approval-gated.
- Every source card must distinguish:
  - credentials missing
  - binary missing
  - binary present but failed validation
  - credentials saved but untested

## Open Questions

- Do we want first-run installers for optional binaries, or fully bundled app binaries?
- Which Windows architectures matter for launch: x64 only, or x64 + arm64?
- Should source status run lightweight binary validation or only static executable checks?
- Should the app expose a one-click "install missing tool" button for Printing Press tools?
