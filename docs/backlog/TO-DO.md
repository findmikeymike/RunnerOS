---
status: current
owner: unassigned
last_verified: 2026-07-11
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

### Artist OS Distribution

- [ ] **Finish Artist OS Premium v1 release readiness.** Licensing, signed entitlements, the Premium test product, Cloudflare test service, real test-mode purchase/refund/revocation, three-seat enforcement, seat recovery, and desktop activation UI are implemented and verified on `codex/artist-os-licensing`. Next: finish app edits and desktop-shell smoke. Final gates are policies/customer URLs, production domain/secrets/deployment, release-authority verification, signed/notarized Mac packaging, clean-machine proof, and one production purchase-to-refund smoke. Source: [Artist OS V1 Release Readiness](./artist-os-v1-release-readiness.md). Detailed licensing evidence: [Artist OS Lemon Squeezy Licensing](../licensing/artist-os-lemon-squeezy-release-plan.md).

### Social Publishing Providers

- [ ] **Finish TryPost end to end.** Built-in MCP source, hardened agent contract, media-aware validation, migration, and tests are implemented. Remaining: real credentials, account discovery, media/draft/preview/schedule/publish smoke, provider receipt proof, failure recovery, and UI connection-state verification.
- [ ] **Finish Postiz end to end.** Required agent, official cloud MCP source, schema-first flow, approval boundaries, receipt contract, Artist Voice routing, and tests are implemented. Remaining: real credentials, integration/schema discovery, media/draft/schedule/publish smoke, provider receipt proof, self-hosted custom-source smoke, and UI connection-state verification.
- [ ] **Verify TryPost/Postiz provider choice.** HNIC receives both through the live capability catalog. Smoke routing when neither, one, or both providers are connected and ensure it asks once instead of guessing.
- [ ] **Harden Social Publisher.** Live-smoke posts, exact comment replies, bounded inbound comment/DM work, account mismatch, expired login, CAPTCHA/2FA, selector drift, private-data handling, and durable receipts. Track proof in [External Integration Live Verification](./external-integration-live-verification.md).

### Product Intelligence

- [ ] **Finish the State of Play V2 release gate.** Implemented: operational adapters for Outputs, Scheduled Work, workflows, automations, approvals, campaign deadlines, and release-critical asset gaps; source health and stale-evidence windows; durable ranked recommendations and lifecycle history; guarded launch/retry/defer actions; objective outcome evidence and usefulness feedback; exact semantic-intent duplicate suppression with legacy migration; same-server launch serialization; rendered control coverage; and explicit regeneration. Remaining: live Electron smoke, campaign-scoped source-health UI, additional domain-specific completion-criterion generators, and a distributed Team Mode lease. Source: [State of Play Opportunity Engine](../creator-command-center/14-state-of-play-opportunity-engine-spec.md).
- [ ] **Live-smoke weekly YouTube Intelligence.** Implemented: preloaded channels including `@its21master`, newest-unseen-upload filtering, persisted processed IDs, transcript caching/provider flow, required HQ report Output, categorized Shared Intel routing, weekly default Automation, toggle, and manual run. Remaining: real-key packaged smoke across all channels, transcript failure/retry proof, dashboard report verification, and measured token/cost evidence.
- [ ] **Live-smoke Spotify intelligence and playlist creation.** Implemented: authenticated browser-source Analyst, snapshots/deltas/anomaly handoff, evidence-backed playlist strategy, bounded cached track discovery, approval contract, playlist creation, account verification, and durable receipt shape. Remaining: real-account snapshot, discovery, create, dedupe, wrong-account, expired-login, and receipt proof. Track proof in [External Integration Live Verification](./external-integration-live-verification.md).
- [ ] **Standardize research cost budgets.** YouTube now limits ingestion to each channel's newest unseen upload, and Spotify discovery has bounded seeds/candidates/cache reuse. Remaining: one shared cap, cheap-model funnel, early-stop, cache, and concise-evidence contract across deep research, ads research, and other browser-heavy agents.

### Calendar And Scheduled Work

- [ ] **Finish Calendar/Scheduled Work release proof.** Implemented: separate HQ/Campaign calendars, progressive Event/Agent/Workflow composer, contextual day actions, individually selectable markers, typed work orders, backend-owned mutations, restart recovery, idempotency, ownership checks, chains, required Outputs, approval-gated social execution, hidden background Automations, HNIC scheduling, release-day markers, and same-server concurrency protection. Remaining: live HQ/Campaign/HNIC/Automation smoke, packaged restart proof, and distributed Team Mode coordination. Scheduled-job expansion remains deferred.

### System Awareness

- [ ] **Finish HNIC capability awareness.** Implemented: live built-in/user agent catalog routing, TryPost/Postiz visibility, and HNIC-only typed Calendar/Automation scheduling. Remaining: normalize readiness, required-source, approval, and output metadata for every agent; add drift tests; and smoke routing across unavailable/partially configured agents.
- [ ] **Finish Setup Concierge / Artist OS Guide awareness.** Implemented: provider-agent connection paths, encrypted source guidance, Keys cards, and current service-key docs. Remaining: one verified walkthrough covering all agents, browser accounts, workflows, Outputs, Calendar, Automations, Team Mode, Creative Lab, recovery, and dependency locations.
- [ ] **Automate capability-catalog freshness.** Derive HNIC and Setup guidance from agent/source metadata where practical, add drift tests, and avoid manually copying the roster into multiple prompts/docs.
- [ ] **Finish existing-install migration proof.** Implemented migration coverage for new provider agents/sources, Social Publisher guidance, Scheduled Work ownership, HNIC prompts, and semantic intent. Remaining: packaged upgrade smoke from a representative older install without overwriting user customizations.

## NEXT

### Team Mode Integration

- [ ] **Reconcile and lock the Team Mode architecture.** Confirm the replacement decision between the older access spec and [Team Mode and Shared Storage](../creator-command-center/06-team-mode-shared-storage-architecture-spec.md).
- [ ] **Implement the first safe Team Mode slice.** Support Solo and Shared Folder modes, workspace migration/validation, private machine-local secrets, conflict-safe writes, runner-machine ownership, and recovery from interrupted sync.
- [ ] **Make team behavior visible across the app.** Show storage mode, sync health, runner machine, conflicts, teammate-safe paths, and read-only/degraded states in Settings and affected surfaces.
- [ ] **Test multi-machine behavior.** Exercise simultaneous context, calendar, outputs, community, and asset changes without silent loss or secret leakage.

### Creative Lab Integration

- [ ] **Define Creative Lab as a real product surface.** Inventory the current visual/video/audio agents and tools, decide what belongs in Creative Lab, and write the minimal source-of-truth contract before adding navigation.
- [ ] **Integrate creative briefs and assets.** Feed Artist HQ, campaign, brand, song, lyrics, Vault, and approved references into Creative Lab without forcing repeated setup.
- [ ] **Route work to the right creator.** The built-in Squad/Video Director path, Canvas storyboard Output, lyric-video tooling, image routing, and raw-video tools now exist. Remaining: connect Art Director, Branding, Content Genius, Hypermotion, Video Director, Lyric Video, image generation, and raw-video editing through one clear Creative Lab chooser.
- [ ] **Standardize creative outputs.** Every run should produce visible Outputs/Finals, source files, previews, provenance, approval state, and a clean path into Campaign/Vault/social publishing.
- [ ] **Add review and iteration state.** Preserve versions, feedback, selected direction, approval, and final promotion instead of losing creative decisions in chat.

### Paid Growth

- [ ] **Finish Paid Ads Operator.** Complete browser fixtures, account-state handling, export parsing, approval packets, receipts, selector recovery, and real Meta/Google/Spotify Ads dashboard verification. Source: [Paid Ads Browser + CLI Operator](./paid-ads-browser-cli-operator.md).
- [ ] **Unify ads strategy and execution handoff.** Ensure Ads Strategist, Ad Creative, and Ads Agent exchange one typed campaign brief and do not independently ask for the same goals, budget, territories, and assets.

### Connected Accounts

- [ ] **Unify connection status.** Managed TryPost/Postiz Keys cards now report real encrypted-source credential state and provider tool tests distinguish credential/configuration failures. Remaining: apply consistent connected, expired, wrong-account, missing-secret, blocked, and ready states to every external agent.
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

- [ ] **Sign and notarize public macOS installers.** This does not block local development or smoke testing. Before customer distribution, restore/import a valid `Developer ID Application` identity for team `6TWTVSA34P`, rebuild Artist OS arm64/x64 packages, pass strict signature verification, notarize, staple, and verify Gatekeeper on a clean Mac.
- [ ] **Finish the built-in agent truth audit.** Automated contracts now cover provider agents, YouTube Intelligence, Spotify Analyst/Playlist Creator, Squad Video Director, Social Publisher engagement, and Scheduled Work/HNIC. Remaining: real app launch and representative live task proof for every visible worker.
- [ ] **Add an integration health dashboard.** Summarize source readiness, stale sessions, missing binaries, pending approvals, recent failures, and unresolved live-verification gates without exposing secrets.
- [ ] **Complete Outputs/Finals adoption.** YouTube Intelligence requires an HQ report Output, Squad emits a Canvas-visible storyboard, scheduled agents can require Outputs, and Spotify playlist work has a receipt/output contract. Remaining: audit every meaningful agent and migrate any chat-only or obscure-file result.
- [ ] **Keep docs, handoff, README, and system map current.** Regenerate maps where generators exist and update feature status after each meaningful integration milestone.
- [ ] **Complete packaging and clean-machine proof.** Verify bundled tools, skills, migrations, permissions, platform binaries, and first-run behavior outside the development checkout.
- [ ] **Add recovery-first browser contracts.** Standardize bounded retries, screenshots/evidence, selector-drift errors, account re-verification, and safe resume behavior across browser-operated agents.
- [ ] **Add provider-neutral publishing contracts.** Normalize draft, preview, approve, schedule, publish, cancel, receipt, and idempotency semantics across Printing Press Social, TryPost, Postiz, and future providers.
- [ ] **Review default navigation and agent discoverability.** Keep powerful surfaces reachable without turning the sidebar or agent roster into an overwhelming catalog.

## Deferred

- Scheduled-job expansion is intentionally deferred for now. Preserve the existing Calendar/Automation work, but do not broaden recurring-job behavior until the user reopens that phase.
