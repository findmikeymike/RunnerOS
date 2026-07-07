# Third-Party Binary Provenance

RunnerOS bundles `printify-pp-cli` from:

- Repository: https://github.com/mvanhorn/printing-press-library
- Source package: Printing Press Printify CLI
- Release/install command: `npx -y @mvanhorn/printing-press-library install printify --cli-only`
- Upstream version: `2026.6.2`
- License: Apache-2.0, copied in `LICENSE.printify-pp-cli.txt`
- Notice: copied in `NOTICE.printify-pp-cli.txt`

## Bundled Files

| RunnerOS path | Upstream asset | SHA256 |
| --- | --- | --- |
| `bin/darwin-arm64/printify-pp-cli` | `printify-pp-cli-darwin-arm64` | `4941bf17daa73250688896f89937bb18b5820a866bfc1594112f93ffa9a385b6` |

To verify locally:

```bash
shasum -a 256 tools/printify/bin/*/printify-pp-cli*
```
