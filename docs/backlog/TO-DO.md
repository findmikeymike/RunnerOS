---
status: current
owner: unassigned
last_verified: 2026-07-10
source_of_truth: true
---

# TO DO

Living, amendable queue for important RunnerOS work that does not yet have a completed implementation and verification trail.

## How To Maintain This

- Add new work as a checkbox with a short outcome, not a vague idea.
- Link a detailed spec when one exists; do not duplicate full specs here.
- Mark each item `NOW`, `NEXT`, `LATER`, or `BLOCKED`.
- An item is complete only after implementation, migration/packaging coverage, tests, and the relevant live or UI smoke.
- Move completed items to a dated archive during backlog cleanup.

## NOW

### Social Publishing Providers

- [ ] **Finish TryPost end to end.** Built-in MCP source, hardened agent contract, media-aware validation, migration, and tests are implemented. Remaining: real credentials, account discovery, media/draft/preview/schedule/publish smoke, provider receipt proof, failure recovery, and UI connection-state verification.
- [ ] **Finish Postiz end to end.** Required agent, official cloud MCP source, schema-first flow, approval boundaries, receipt contract, Artist Voice routing, and tests are implemented. Remaining: real credentials, integration/schema discovery, media/draft/schedule/publish smoke, provider receipt proof, self-hosted custom-source smoke, and UI connection-state verification.
- [ ] **Verify TryPost/Postiz provider choice.** HNIC receives both through the live capability catalog. Smoke routing when neither, one, or both providers are connected and ensure it asks once instead of guessing.
- [ ] **Harden Social Publisher.** Live-smoke posts, exact comment replies, bounded inbound comment/DM work, account mismatch, expired login, CAPTCHA/2FA, selector drift, private-data handling, and durable receipts. Track proof in [External Integration Live Verification](./external-integration-live-verification.md).

### Product Intelligence

- [ ] **Update State of Play.** Review the implemented V1 against current agents, workflows, outputs, campaign context, shared intel, calendar, and social/commerce capabilities. Add useful route history, explicit refresh, stale-input visibility, and clearer reasons when a recommended route cannot launch. Source: [HQ State of Play](../creator-command-center/09-hq-state-of-play-proactive-routing.md).
- [ ] **Make State of Play output-aware.** Prefer unfinished approved work, recent outputs, failed runs, campaign deadlines, and missing release-critical assets instead of relying mainly on context presence.
- [ ] **Add cost budgets to research-heavy agents.** Standardize caps, cache reuse, early-stop rules, cheap-model funnels, and concise evidence packets for YouTube Intelligence, Spotify discovery, deep research, ads research, and similar browser jobs.

### System Awareness

- [ ] **Refresh HNIC awareness.** Ensure HNIC sees every active built-in and user agent, its real capabilities, required sources, approval boundaries, output types, and current readiness. It must route to shipped behavior, not stale prompt prose.
- [ ] **Refresh Setup Concierge / Artist OS Guide awareness.** Cover all current agents, sources, browser accounts, API keys, workflows, outputs, Calendar, Automations, Team Mode, Creative Lab, failure recovery, and where users connect each dependency.
- [ ] **Automate capability-catalog freshness.** Derive HNIC and Setup guidance from agent/source metadata where practical, add drift tests, and avoid manually copying the roster into multiple prompts/docs.
- [ ] **Verify existing-install migrations.** New built-in skills, sources, and prompt guidance must reach existing installs without overwriting user customizations.

## NEXT

### Team Mode Integration

- [ ] **Reconcile and lock the Team Mode architecture.** Confirm the replacement decision between the older access spec and [Team Mode and Shared Storage](../creator-command-center/06-team-mode-shared-storage-architecture-spec.md).
- [ ] **Implement the first safe Team Mode slice.** Support Solo and Shared Folder modes, workspace migration/validation, private machine-local secrets, conflict-safe writes, runner-machine ownership, and recovery from interrupted sync.
- [ ] **Make team behavior visible across the app.** Show storage mode, sync health, runner machine, conflicts, teammate-safe paths, and read-only/degraded states in Settings and affected surfaces.
- [ ] **Test multi-machine behavior.** Exercise simultaneous context, calendar, outputs, community, and asset changes without silent loss or secret leakage.

### Creative Lab Integration

- [ ] **Define Creative Lab as a real product surface.** Inventory the current visual/video/audio agents and tools, decide what belongs in Creative Lab, and write the minimal source-of-truth contract before adding navigation.
- [ ] **Integrate creative briefs and assets.** Feed Artist HQ, campaign, brand, song, lyrics, Vault, and approved references into Creative Lab without forcing repeated setup.
- [ ] **Route work to the right creator.** Connect Art Director, Branding, Content Genius, Hypermotion, Video Director, Lyric Video, image generation, raw-video editing, and future creative tools through one clear chooser.
- [ ] **Standardize creative outputs.** Every run should produce visible Outputs/Finals, source files, previews, provenance, approval state, and a clean path into Campaign/Vault/social publishing.
- [ ] **Add review and iteration state.** Preserve versions, feedback, selected direction, approval, and final promotion instead of losing creative decisions in chat.

### Paid Growth

- [ ] **Finish Paid Ads Operator.** Complete browser fixtures, account-state handling, export parsing, approval packets, receipts, selector recovery, and real Meta/Google/Spotify Ads dashboard verification. Source: [Paid Ads Browser + CLI Operator](./paid-ads-browser-cli-operator.md).
- [ ] **Unify ads strategy and execution handoff.** Ensure Ads Strategist, Ad Creative, and Ads Agent exchange one typed campaign brief and do not independently ask for the same goals, budget, territories, and assets.

### Connected Accounts

- [ ] **Unify connection status.** Give every external agent a consistent connected, expired, wrong-account, missing-secret, blocked, and ready state in Settings.
- [ ] **Make reconnect paths actionable.** One clear reconnect/setup action should replace agent-specific credential guesswork. Source: [Connected Accounts + Credential Vault](./connected-accounts-credential-vault.md).
- [ ] **Keep secrets private and machine-local.** Verify exports, Team Mode, logs, outputs, context, and receipts never leak tokens, cookies, passwords, or private message bodies.

### Windows Workability Vetting

- [ ] **Prove RunnerOS is workable on Windows.** Build and install on a clean supported Windows machine, launch without developer tooling, create/open a workspace, restart safely, and verify updates/uninstall behavior. Source: [Windows Version](./windows-version.md).
- [ ] **Vet bundled runtimes and paths.** Verify Bun/Node helpers, FFmpeg, transcription, creative tools, subprocesses, file URLs, long paths, spaces, drive letters, path separators, executable permissions, and temp/cache locations.
- [ ] **Vet browser-operated integrations.** Confirm browser sessions, CDP handoffs, login persistence, account verification, downloads/uploads, CAPTCHA/2FA recovery, and guarded receipts on Windows.
- [ ] **Run representative Windows workflows.** Smoke HNIC, Setup Concierge, Artist HQ, Campaigns, Calendar, Automations, Outputs/Finals, Vault, Spotify, Social Publisher, YouTube Intelligence, Paid Ads, and at least one visual/video render.
- [ ] **Verify Windows security and credentials.** Confirm secret storage, logs, crash reports, Team Mode exclusions, antivirus/SmartScreen behavior, installer signing, and that no cookies or tokens enter synced workspaces.
- [ ] **Publish a Windows compatibility report.** Clearly mark working, degraded, blocked, and unsupported features; do not call Windows supported until the clean-machine matrix passes.

## LATER

### Reliability And Product Truth

- [ ] **Run a built-in agent truth audit.** For every visible worker, verify launch, required tools/sources, one representative task, output placement, approval behavior, and honest empty/error states.
- [ ] **Add an integration health dashboard.** Summarize source readiness, stale sessions, missing binaries, pending approvals, recent failures, and unresolved live-verification gates without exposing secrets.
- [ ] **Complete Outputs/Finals adoption.** Agents that create meaningful work must publish it to the correct HQ or campaign surface instead of leaving the result only in chat or an obscure file.
- [ ] **Keep docs, handoff, README, and system map current.** Regenerate maps where generators exist and update feature status after each meaningful integration milestone.
- [ ] **Complete packaging and clean-machine proof.** Verify bundled tools, skills, migrations, permissions, platform binaries, and first-run behavior outside the development checkout.
- [ ] **Add recovery-first browser contracts.** Standardize bounded retries, screenshots/evidence, selector-drift errors, account re-verification, and safe resume behavior across browser-operated agents.
- [ ] **Add provider-neutral publishing contracts.** Normalize draft, preview, approve, schedule, publish, cancel, receipt, and idempotency semantics across Printing Press Social, TryPost, Postiz, and future providers.
- [ ] **Review default navigation and agent discoverability.** Keep powerful surfaces reachable without turning the sidebar or agent roster into an overwhelming catalog.

## Deferred

- Scheduled-job expansion is intentionally deferred for now. Preserve the existing Calendar/Automation work, but do not broaden recurring-job behavior until the user reopens that phase.
