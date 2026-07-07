---
status: backlog
owner: agent
last_verified: 2026-07-07
source_of_truth: true
---

# Connected Accounts + Credential Vault

Build a shared Settings surface where users can connect external accounts once, grant scoped agent access, and revoke it later.

This should cover paid ads, social posting, email/outreach, commerce, and future browser-only tools without putting raw passwords into prompts.

## Why

Several agents need trusted external-account access:

- Ads Agent: Meta Ads, Google Ads, browser dashboard/export fallback.
- Social Publisher / Printing Press: Instagram, TikTok, X, YouTube posting and comments.
- Outreach Agent, Comms Agent, Record Doctor: Gmail draft/send.
- Shopify Agent: Shopify Admin.
- Print Agent: Printify / POD store actions.
- YouTube Research Agent: YouTube Data API key.
- Future browser-operated agents: any site with no clean API/OAuth route.

Today this is split across source credentials, OAuth flows, CLI profile/session folders, and manual login. The product needs one user-facing control plane.

## Existing Ground Truth

- Secure credential store already exists at `packages/shared/src/credentials`.
- Storage backend encrypts `~/.craft-agent/credentials.enc` with AES-256-GCM and uses Electron `safeStorage` / OS protection when available.
- Existing credential types include `source_oauth`, `source_bearer`, `source_apikey`, `source_basic`, `user_secret`, and `messaging_bearer`.
- OAuth bridge exists in Electron preload for connection flows.
- Printing Press Social already planned persistent browser profiles/sessions, OS keychain where possible, and no plaintext password storage.

## Product Shape

Settings -> Connected Accounts:

- Platform: Meta, Google Ads, Gmail, Instagram, TikTok, X, YouTube, Shopify, Printify, custom.
- Account identity: email/handle/business/customer/store.
- Auth type: OAuth, API key, bearer token, browser session, password fallback.
- Scope: read, draft, publish/send, manage/spend, admin.
- Owner scope: global, workspace, artist/client/world.
- Status: connected, expired, needs login, blocked, revoked.
- Controls: connect, test, refresh, revoke, require approval before external actions.

Default rule: OAuth/API/session first. Password fallback only when no clean connector exists.

## Security Rules

- Agents never receive raw passwords, 2FA codes, cookies, API keys, or tokens in prompts.
- Secrets are injected only by trusted runtime into API headers, CLI env, or browser login fields.
- Browser sessions live in per-account profiles, not project folders.
- Action logs, Outputs, Canvas, receipts, and approval packets must redact secrets.
- External actions default to approval-gated even when credentials exist.
- Support per-account revoke and full credential delete.

## Runtime Contract

Agent asks for a capability, not a secret:

```json
{
  "platform": "meta-ads",
  "accountId": "act_123",
  "capability": "read",
  "modePreference": "oauth-or-browser-session"
}
```

Runtime returns an executable route:

- API/OAuth source available.
- CLI wrapper with credential cache.
- Browser profile/session ready.
- Needs user login/reauth.
- Not allowed by current scope.

## Required Work

1. Inventory current credential read/write paths and source auth UI.
2. Design `ConnectedAccount` model on top of existing credential IDs.
3. Add credential/session types for browser profile/session references.
4. Build Settings -> Connected Accounts list/detail UI.
5. Add capability request API for agents/tools.
6. Wire Ads Agent to request Meta/Google Ads read/manage scopes.
7. Wire Printing Press Social profiles to shared account records.
8. Wire Gmail/Outreach agents to Gmail account records.
9. Add redaction tests for prompts, logs, Outputs, receipts, and approval packets.
10. Add revoke/expiry/reauth tests.

## Non-Goals For V1

- Do not make passwords the primary auth path.
- Do not allow agents to read raw stored secrets.
- Do not auto-post, send, spend, or mutate by default.
- Do not merge every platform connector into one generic fragile browser bot.

## Next Slice

Create an implementation map:

- existing credential APIs
- source credential UI
- OAuth handlers
- Printing Press profile/session store
- agent launch source injection
- approval/output redaction points
