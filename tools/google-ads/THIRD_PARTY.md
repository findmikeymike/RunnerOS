# Third-Party Binary Provenance

RunnerOS bundles `google-ads-pp-cli` from:

- Repository: https://github.com/mvanhorn/printing-press-library
- Source package: `library/marketing/google-ads`
- Source commit: `5daef9851a46c4b53bd8fbdf87a7f87f13a58d5e`
- Upstream release tag checked: `google-ads-current`
- Upstream release URL: https://github.com/mvanhorn/printing-press-library/releases/tag/google-ads-current
- Upstream generator version: `3.10.0`
- RunnerOS build version: `2026.6.25-runneros-v24`
- Google Ads API target: `v24`
- License: Apache-2.0, copied in `LICENSE.google-ads-pp-cli.txt`
- Notice: copied in `NOTICE.google-ads-pp-cli.txt`

## Bundled Files

| RunnerOS path | Build target | SHA256 |
| --- | --- | --- |
| `bin/darwin-arm64/google-ads-pp-cli` | `darwin/arm64` | `9113fb9d72d4d77eb9214c6cfd5a622fbe693caea3a84b15e82965b7b6bc26a9` |
| `bin/darwin-x64/google-ads-pp-cli` | `darwin/amd64` | `0cb29c1c2179f842fdcb320b8ae1a5ff99e9b4ee6f6ca209e158263c4a6d772a` |
| `bin/linux-x64/google-ads-pp-cli` | `linux/amd64` | `ea057ae4058bbf6929d0f00d21d4c56a06563a4dc3abeff9411c8ea7f65639a6` |
| `bin/win32-x64/google-ads-pp-cli.exe` | `windows/amd64` | `a34d38adffc3df51e4a401f95e7d6a165d0f0d8f9a564411d3496982469abee3` |

The upstream release checked on 2026-06-25 still targeted Google Ads API v22. RunnerOS rebuilt the CLI from source with generated REST paths patched to v24 so account discovery, GAQL reporting, and mutate operations call the current major API version. This does not add brand-new v24-only commands that are absent from the upstream generated command surface.

RunnerOS does not currently bundle linux-arm64 or windows-arm64 Google Ads variants.

To verify locally:

```bash
shasum -a 256 tools/google-ads/bin/*/google-ads-pp-cli*
```
