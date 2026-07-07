# Printify Source Guide

Use this source for Printify print-on-demand catalog research, artwork uploads, product manifests, placement proofing, personalization audits, order checks, fulfillment risk, and approval-gated writes.

## Setup

1. Save `PRINTIFY_API_TOKEN` in RunnerOS Settings -> Secrets.
2. Run `node bin/printify.mjs doctor --agent` before account work.
3. Apple Silicon Mac builds bundle `printify-pp-cli`. Other platforms can install it with `npx -y @mvanhorn/printing-press-library install printify --cli-only` or set `PRINTIFY_PP_CLI`.

## Read-Only Commands

```bash
node bin/printify.mjs doctor --agent
node bin/printify.mjs shops-json --agent --select id,title
node bin/printify.mjs catalog retrieves-list-of-blueprints-in-the --agent --select id,title
node bin/printify.mjs uploads-json --agent --select id,file_name
```

## Proofing Commands

```bash
node bin/printify.mjs placement-matrix --product-file product.json --uploads-file uploads.json --agent
node bin/printify.mjs product-drift --product-file current-product.json --manifest intended-manifest.json --agent
node bin/printify.mjs fulfillment-risk --orders-file orders.json --products-file products.json --agent
```

## Write Rules

- Never upload artwork, create/update/publish/delete products, submit orders, manage shops, or manage webhooks without explicit user approval in the current conversation.
- Use `--dry-run` before asking for approval when the upstream command supports it.
- Use `--confirm-runner` only after approval.
- Use `--select` to keep large Printify responses tight.
- Do not print access tokens, private customer data, or raw order exports unless required.
