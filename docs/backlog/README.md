---
status: current
owner: agent
last_verified: 2026-07-08
source_of_truth: true
---

# Backlog

Deferred work, future integrations, cleanup ideas, and feature candidates live here.

Keep backlog docs scoped and actionable. If a backlog item becomes active, move or copy the accepted spec into the matching feature folder.

## Backlog Items

- [Google OAuth Production App](./google-oauth-production-app.md) - submit and verify a Runner-owned Google OAuth app so users can connect Gmail/Calendar/Drive without creating their own Google Cloud project.
- [Connected Accounts + Credential Vault](./connected-accounts-credential-vault.md) - shared Settings surface for OAuth/API/browser-session credentials used by Ads, Social Publisher, Gmail/outreach, Shopify, Printify, and future browser-operated agents.
- [Multi-World Artist Spaces](./multi-world-artist-spaces.md) - future architecture for multiple artist/client/side-project worlds after the single-world HQ/campaign system is fully fleshed out.
- [Paid Ads Execution Prep](./paid-ads-execution-prep.md) - current code map, source/tooling map, test impact, build architecture, and external research for the paid ads operator.
- [Paid Ads Browser + CLI Operator](./paid-ads-browser-cli-operator.md) - hybrid browser/CDP plus CLI system so Ads Agent can inspect, draft, analyze, and approval-gate Meta/Google campaigns even when API approval is missing.
- [Tool Licensing + Packaging Audit](./tool-licensing-packaging-audit.md) - release gate for commercially safe tool licenses and packaged/auto-installed FFmpeg, Whisper, Python/runtime, model, browser, and CLI dependencies.
- [Windows Version](./windows-version.md) - PC readiness backlog for bundled binaries, local tool paths, browser automation, secrets, and cross-platform agent/tool QA.
- [Spotify Fix](./spotify-fix.md) - make Spotify Analyst reliable in packaged builds (self-contained snapshot script + materialized skill paths) and give the Playlist Creator a real Spotify write actuator or reposition it as plan-only.
