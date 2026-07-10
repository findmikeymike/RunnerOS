---
status: current
owner: agent
last_verified: 2026-07-10
source_of_truth: true
---

# Backlog

This folder contains only unfinished work, partial implementations, and release gates. Completed or superseded proposals belong in `docs/archive/<date>/`.

## Release Gates

- [External Integration Live Verification](./external-integration-live-verification.md) - real-account/API smoke queue for commerce, ads, Social Publisher, research, visual tools, Canvas, and Secrets. This is the main end-to-end proof list.
- [Google OAuth Production App](./google-oauth-production-app.md) - Runner-owned verified OAuth app so users can connect Gmail, Calendar, and Drive without creating a Google Cloud project.
- [Tool Licensing + Packaging Audit](./tool-licensing-packaging-audit.md) - commercial-license, binary, model, checksum, provenance, and clean-machine packaging gate.
- [Windows Version](./windows-version.md) - Windows binaries, packaged runtime behavior, browser automation, and cross-platform agent/tool QA.
- [Spotify Fix](./spotify-fix.md) - packaged Spotify Analyst reliability plus the decision to add a real playlist actuator or make Playlist Creator explicitly plan-only.

## Partially Shipped

- [Global Sources Finish](./global-sources-finish.md) - foundation and renderer V1 shipped; deeper CRUD, credential override UI, polish, audit, and smoke work remain.
- [Paid Ads Browser + CLI Operator](./paid-ads-browser-cli-operator.md) - core skill/source/CLI, parsers, audit engine, plans, packets, and receipts shipped; browser fixtures, user/setup docs, and live verification remain.
- [Auto-memory Sidecar](./auto-memory-sidecar.md) - implemented on `codex/memory-os-hardening`; Electron smoke, review-queue proof, and merge remain.

## Product Backlog

- [Connected Accounts + Credential Vault](./connected-accounts-credential-vault.md) - shared Settings control plane for OAuth/API credentials and browser sessions across Ads, Social, Gmail, commerce, and future tools.
- [Multi-World Artist Spaces](./multi-world-artist-spaces.md) - future multi-artist/client/side-project architecture after the single-world system is proven.
- [Future External Triggers](./future-external-triggers.md) - candidate automation triggers including email, Slack/Discord/Teams, MCP inbound, Shortcuts, browser extension, Git, calendar, RSS, database, cloud storage, and more.
- [Global Update Agent](./global-update-agent.md) - system-wide doctor/update auditor for agents, skills, sources, MCP servers, tools, packages, and unresolved live-verification gates.

## Archived On 2026-07-10

- [Workflow Outputs](../archive/2026-07-10/workflow-outputs.md) - superseded by shipped Outputs/Finals specs 10 and 11.
- [Social Accounts + Operations](../archive/2026-07-10/social-accounts-and-operations.md) - V1 shipped; remaining proof moved to live verification and Connected Accounts.
- [Paid Ads Execution Prep](../archive/2026-07-10/paid-ads-execution-prep.md) - preparation completed; remaining work stays in the Ads Operator backlog.

## Maintenance Rule

- Mark branch-only work and its merge status explicitly.
- Keep release proof separate from feature implementation.
- When most of a spec ships, archive the proposal and move only concrete remaining work into an active backlog item.
- Update this index whenever a backlog document is added, archived, or activated.
