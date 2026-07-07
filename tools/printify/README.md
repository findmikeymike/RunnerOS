# RunnerOS Printify Tool

RunnerOS wrapper for the Printing Press `printify-pp-cli`.

```bash
node bin/printify.mjs doctor --agent
node bin/printify.mjs shops-json --agent --select id,title
node bin/printify.mjs catalog retrieves-list-of-blueprints-in-the --agent --select id,title
node bin/printify.mjs uploads an-image --body-json '{"file_name":"front.png","contents":"data:image/png;base64,..."}' --agent --dry-run
node bin/printify.mjs shops products-json create-anew-product <shopId> --title Sample --blueprint-id 384 --print-provider-id 1 --variants '[]' --print-areas '[]' --agent
```

Auth comes from RunnerOS Secrets or environment:

- `PRINTIFY_API_TOKEN`

Write-like commands are blocked unless `--dry-run` or `--confirm-runner` is present. `--confirm-runner` is stripped before calling `printify-pp-cli`.

Install the upstream CLI when missing:

```bash
npx -y @mvanhorn/printing-press-library install printify --cli-only
```

That installer places `printify-pp-cli` in `~/.local/bin` by default. The RunnerOS wrapper checks that path directly, so it does not require the app process PATH to include it. You can also run:

```bash
npm run install:cli
```

RunnerOS currently bundles `bin/darwin-arm64/printify-pp-cli` for Apple Silicon Mac builds. Other platforms should install the CLI or set `PRINTIFY_PP_CLI` until their binaries are bundled.
