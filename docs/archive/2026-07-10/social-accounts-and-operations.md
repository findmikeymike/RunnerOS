---
status: archived
owner: product
last_verified: 2026-07-10
source_of_truth: false
---

> Archived 2026-07-10. Reason: Social Accounts Settings, profile/session management, account sets, guarded publishing, and delegated engagement shipped. Remaining live-account proof is tracked in `docs/backlog/external-integration-live-verification.md`; shared credential unification remains in `connected-accounts-credential-vault.md`.

# Social Accounts + Operations

Build a first-class Social Accounts system for RunnerOS so `@social-publisher` can operate multiple X, Instagram, TikTok, and YouTube accounts without the user retyping handles, login instructions, or approval rules every time.

This spec extends the existing Printing Press Social CLI and source. It is intentionally broader than "post this": it covers profiles, browser sessions, readiness, posts/uploads, comments/replies, DMs, inbox/comment triage, receipts, and the eventual Settings UI.

## Current Ground Truth

Already shipped or present in this branch:

- `@social-publisher` starter agent exists in `packages/shared/src/agent-definitions/starter-templates.ts`.
- `social-publishing` bundled skill exists in `packages/shared/src/skills/bundled/social-publishing/SKILL.md`.
- `printing-press-social` source exists in `sources/printing-press-social`.
- Root CLI exists at `tools/printing-press-social/src/social.mjs`.
- Platform CLIs exist under:
  - `tools/printing-press-social/x-cli`
  - `tools/printing-press-social/instagram-cli`
  - `tools/printing-press-social/tiktok-cli`
  - `tools/printing-press-social/youtube-cli`
- Existing profile commands:
  - `node src/social.mjs profile add <platform> --profile <name> --handle <handle> --account-url <url> --json`
  - `node src/social.mjs profile login <platform> --profile <name>`
  - `node src/social.mjs profile status <platform> --profile <name> --live --json`
  - `node src/social.mjs doctor --json`
  - `node src/social.mjs doctor --live --json`
- Current profile metadata includes `accountHandle`, `accountUrl`, `browserEngine`, `sessionRef`, and `confirmPolicy`.
- Browser session paths are platform/profile-specific via each platform CLI `sessionDir(profile)`.
- Dry-run JSON includes `browserPlan.accountVerification`.
- `social execute --action-file ... --expected-action-id ... --confirm yes --json` now returns a successful `runner-cdp` handoff.
- Current approval rule: chat approval plus matching `--expected-action-id` is final approval. Browser execution should submit when account and draft match; stop only on mismatch, ambiguity, unexpected platform choices, or upload/UI failure.

Related backlog:

- `docs/backlog/connected-accounts-credential-vault.md` covers the larger shared control plane for credentials, OAuth, API keys, browser sessions, and revocation across products.
- This spec is the social-specific slice and should eventually plug into that shared Connected Accounts model.

## Problem

Today the user can tell an agent a handle and the agent can create a local CLI profile. That is not enough for a polished product:

- Users may have many X, IG, TikTok, and YouTube accounts.
- They should not repeat handles/account URLs in every chat.
- They should not give passwords to agents.
- They should not have to log in every run.
- They need a UI to see which accounts are ready, expired, wrong, or unverified.
- Agents need a trusted profile catalog at launch.
- Posting is only one operation; replies, comments, DMs, and triage need the same identity/session/approval model.

Plain English goal: Runner should know "X / artist-main" and "Instagram / merch-store" as saved local account profiles. The user logs each account in once. After that the agent opens the right saved browser session, verifies the visible account, performs approved actions, and returns a receipt.

## Product Decision

Create `Settings -> Social Accounts`.

Do not hide this only inside a Source page. Users think of this as app/account setup, not developer source config.

The Printing Press Social source can still show technical docs, permissions, and CLI status. But account/profile management belongs in Settings because:

- it spans workspaces and agents;
- users expect logins/accounts in Settings;
- multiple agents may eventually use these sessions;
- it needs revoke, verify, default selection, and status controls;
- it should not require opening a blank chat with an agent.

## User Mental Model

### One profile per social account

Examples:

```yaml
- platform: x
  profile: artist-main
  handle: "@artist"
  account_url: "https://x.com/artist"

- platform: x
  profile: label
  handle: "@label"
  account_url: "https://x.com/label"

- platform: instagram
  profile: merch-store
  handle: "@merchstore"
  account_url: "https://instagram.com/merchstore"
```

The user can then say:

- "Post this from X profile artist-main."
- "Reply from the label X."
- "Check comments on merch-store IG."

### Login once per account/profile

If the user has five X accounts, they eventually need five saved sessions. But they should log them in one at a time:

1. Settings -> Social Accounts.
2. Add `x / artist-main`.
3. Click `Open Login`.
4. User logs into X manually.
5. Click or auto-run `Verify`.
6. Repeat for the next account.

No password sharing. No bulk browser storm. No repeated login unless session expires or the wrong account is detected.

## V1 Scope

### In

- Settings UI for social profiles.
- Create/edit/delete profile metadata.
- One persistent browser session per platform/profile.
- Open login browser for one profile at a time.
- Verify session/account identity.
- Show readiness status.
- Expose profile catalog to `@social-publisher`.
- Support action types already represented in Printing Press Social:
  - post/upload
  - comment/reply
  - DM
- Keep every write action approval-gated.
- Let read/triage flows inspect/summarize with lower friction but still avoid sending without approval.
- Add receipts for external writes.

### Out

- No password storage.
- No raw cookies in prompts, logs, Outputs, Canvas, or receipts.
- No automatic sending/posting from inferred user intent without exact approval.
- No platform API dependency for V1.
- No scheduler/queue in the first settings slice, unless the existing CLI already supports the dry-run shape.
- No "one browser with all accounts" design. Sessions must be isolated by profile.
- No mass-login workflow that opens many browsers at once.

## Settings UI

Route proposal:

```text
Settings -> Social Accounts
```

Secondary entry points:

- `SourceInfoPage` for Printing Press Social can link to Settings -> Social Accounts.
- `@social-publisher` can deep-link there when a requested profile is missing or expired.

### List View

Each row:

- platform icon/name
- profile name
- handle
- account URL
- default workspace/client/artist/world, if any
- session status
- last verified time
- last used time
- allowed actions summary
- primary action button:
  - `Open Login` when not logged in
  - `Verify` when session exists but not recently verified
  - `Fix Login` when expired/wrong account
- overflow actions:
  - edit
  - set default
  - duplicate
  - delete profile
  - clear browser session
  - reveal local session path only behind an advanced toggle

### Detail/Edit Form

Required fields:

- `platform`: `x | instagram | tiktok | youtube`
- `profile`: stable slug, lowercase kebab-case preferred
- `handle`: expected visible handle/channel identity
- `accountUrl`: expected canonical URL

Optional fields:

- display name
- workspace/client/artist/world id
- default visibility
- default post type
- default browser engine, initially `runner-cdp`
- notes, non-secret only
- allowed operations:
  - read/triage
  - post/upload
  - comment/reply
  - DM
  - schedule later
- approval policy:
  - always require explicit approval for writes
  - future: allow trusted automation rules
- last known session path
- last verification evidence summary

### Status Values

Use explicit statuses, not vague "connected":

```ts
type SocialProfileStatus =
  | 'missing_profile'
  | 'login_needed'
  | 'session_exists_unverified'
  | 'verified'
  | 'wrong_account'
  | 'expired'
  | 'blocked_by_2fa'
  | 'blocked_by_captcha'
  | 'verification_failed'
  | 'unknown';
```

Status should include:

- `ok: boolean`
- `severity: info | warning | error`
- `message`
- `nextAction`
- `lastCheckedAt`
- `evidence`: redacted, non-secret, preferably screenshot path or UI text summary

## Data Model

### SocialAccountProfile

Canonical app-level model:

```ts
type SocialPlatform = 'x' | 'instagram' | 'tiktok' | 'youtube';

interface SocialAccountProfile {
  id: string;                 // stable app id, e.g. social_x_artist-main
  platform: SocialPlatform;
  profile: string;            // CLI profile slug, e.g. artist-main
  displayName?: string;
  handle?: string;
  accountUrl?: string;
  workspaceId?: string;
  artistId?: string;
  clientId?: string;
  worldId?: string;
  browserEngine: 'runner-cdp' | 'chrome-devtools' | 'stagehand' | 'cloakbrowser' | 'playwright';
  sessionRef: string;         // local session reference, not cookie contents
  sessionPath?: string;       // local path for diagnostics, do not expose by default
  confirmPolicy: 'require-confirm';
  allowedOperations: SocialOperation[];
  defaultVisibility?: 'public' | 'private' | 'unlisted';
  defaultPostType?: 'post' | 'reel' | 'short' | 'video';
  status: SocialProfileStatus;
  lastVerifiedAt?: string;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

### SocialOperation

```ts
type SocialOperation =
  | 'read_profile'
  | 'read_notifications'
  | 'read_comments'
  | 'read_dms'
  | 'post'
  | 'comment'
  | 'reply'
  | 'dm'
  | 'upload'
  | 'schedule';
```

Default allowed operations for V1:

- read operations: enabled after login
- write operations: enabled but approval-gated
- destructive operations: not enabled in V1

### Storage Placement

V1 should avoid inventing a second profile store if possible.

Recommended bridge:

- Use existing Printing Press Social CLI profile stores as execution source of truth for platform CLIs.
- Add a Runner-facing Social Accounts index that mirrors/augments those profiles for UI and launch context.
- Keep secrets/session data out of the index.

Possible files:

```text
~/.config/printing-press-clis/<platform>/profiles.json   # existing CLI profile store
~/.config/printing-press-clis/<platform>/sessions/<id>/   # existing browser session data
~/.craft-agent/social-accounts.json                       # Runner index/cache if needed
```

Preferred long-term:

- unify under Connected Accounts in encrypted/app-managed storage where appropriate;
- store browser session references, not cookies;
- keep browser profile directories local and isolated.

## CLI/API Contract Needed For UI

Current CLI commands are close but UI needs a stable JSON surface.

Required commands:

```bash
node src/social.mjs profile list --json
node src/social.mjs profile add <platform> --profile <name> --handle <handle> --account-url <url> --json
node src/social.mjs profile update <platform> --profile <name> --handle <handle> --account-url <url> --json
node src/social.mjs profile delete <platform> --profile <name> --json
node src/social.mjs profile login <platform> --profile <name> --json
node src/social.mjs profile status <platform> --profile <name> --live --json
node src/social.mjs doctor --json
node src/social.mjs doctor --live --json
```

If any of these are missing or inconsistent, implement them before the Settings UI depends on them.

Profile command output should be stable:

```json
{
  "ok": true,
  "status": "succeeded",
  "command": "profile.status",
  "platform": "x",
  "profile": "artist-main",
  "accountHandle": "@artist",
  "accountUrl": "https://x.com/artist",
  "sessionPath": "...",
  "localSessionExists": true,
  "live": {
    "checked": true,
    "loggedIn": true,
    "visibleIdentity": "@artist",
    "matchesExpected": true
  },
  "next": []
}
```

## Login Flow

### UI Flow

1. User clicks `Open Login` for one profile.
2. Runner launches a browser session bound to that platform/profile.
3. User logs in manually.
4. Runner never asks for password or 2FA code.
5. User clicks `Verify`, or Runner auto-verifies after browser settles if safe.
6. Status becomes `verified` only if visible identity matches `handle` or `accountUrl`.

### Agent Flow

If the user asks to post from a missing/expired profile:

1. Agent says the profile needs setup.
2. Agent opens the Social Accounts Settings route or asks permission to run profile setup.
3. If profile exists but login is needed, agent opens the login browser.
4. User logs in.
5. Agent verifies account.
6. Agent resumes dry-run/execution.

## Agent Launch Context

When `@social-publisher` starts, inject a compact profile catalog:

```json
{
  "socialProfiles": [
    {
      "platform": "x",
      "profile": "artist-main",
      "handle": "@artist",
      "accountUrl": "https://x.com/artist",
      "status": "verified",
      "allowedOperations": ["read_profile", "post", "comment", "reply", "dm"],
      "isDefault": true,
      "lastVerifiedAt": "2026-07-07T00:00:00.000Z"
    }
  ],
  "defaults": {
    "x": "artist-main",
    "instagram": "merch-store"
  }
}
```

Do not inject:

- cookies
- raw session paths unless needed
- passwords
- tokens
- full browser profile contents

## User Command Resolution

The agent should resolve phrases like:

- "post this from artist-main"
- "use the label X"
- "reply from merch IG"
- "DM from my YouTube account"

Resolution order:

1. explicit platform + profile slug
2. explicit platform + handle
3. workspace/client/artist default for platform
4. only verified profile for platform
5. ask a clarifying question if multiple candidates remain

Never guess between multiple verified accounts when the action is external/write-capable.

## Action Types

### Read/Triage Actions

Examples:

- list recent notifications
- inspect comments on a post
- summarize unread DMs
- identify messages worth replying to
- classify comments by sentiment/urgency

Rules:

- Can run with lower friction once profile is verified.
- Must not reveal sensitive private-message content into broad workspace memory or docs.
- Must label private content in receipts/outputs.
- Must not send/reply/delete/block without approval.

### Write Actions

Examples:

- publish post
- upload video/Short/Reel/TikTok
- reply/comment
- send DM
- schedule post

Required approval packet:

```json
{
  "platform": "x",
  "profile": "artist-main",
  "operation": "post",
  "target": null,
  "copy": "new drop tonight",
  "media": [],
  "visibility": "public",
  "actionId": "act_...",
  "idempotencyKey": "..."
}
```

Approval must name the exact platform/profile/action and final payload. After approval:

- run `social execute --expected-action-id ... --confirm yes --json`;
- use returned `browserPlan`;
- verify visible account and draft;
- submit without asking again if everything matches;
- stop on mismatch/ambiguity/unexpected UI risk.

## Browser Execution Playbook Contract

Each platform/action playbook must specify:

- start URL or navigation route
- account verification points
- compose/upload target
- draft verification method
- media upload method
- target verification for comment/reply/DM
- irreversible submit control
- success evidence
- known failure states
- stop conditions

Generic stop conditions:

- visible account does not match expected handle/account URL;
- target post/recipient/channel differs from approval;
- copy/media differs from dry-run result;
- platform presents unexpected monetization/commercial/disclosure/rights choice;
- upload fails or media appears corrupted;
- login, 2FA, CAPTCHA, suspension, age gate, or security check appears;
- browser state is ambiguous after repeated attempts;
- UI asks to switch accounts;
- final action would affect a business/billing/paid promotion setting not named in approval.

Generic receipt:

```text
Status: posted | sent | replied | commented | drafted | blocked | needs-user
Platform:
Profile:
Operation:
Target:
Copy:
Media:
Visibility:
Approved action id:
Account verification evidence:
Observed result:
URL or screenshot:
Timestamp:
```

## UI Implementation Plan

### Phase 1: CLI Profile Completeness

Goal: make profile commands complete enough for UI.

Tasks:

- Audit all platform CLIs for consistent `profile add/list/status/login/delete/update`.
- Add missing `profile update/delete` if absent.
- Normalize JSON outputs.
- Ensure status includes `sessionPath`, `localSessionExists`, `accountHandle`, `accountUrl`, `live.checked`, `live.loggedIn`, and `live.matchesExpected`.
- Add tests per platform and root dispatcher.
- Ensure `doctor --live --json` aggregates all profiles without leaking secrets.

Acceptance:

- UI can list, add, edit, delete, login, and verify every platform using JSON commands.

### Phase 2: Backend Bridge

Goal: expose a typed app API over the CLI.

Tasks:

- Add a shared social accounts service in `packages/shared` or server-core/electron boundary.
- Use existing `getPrintingPressSocialPath()` style resolution from `packages/shared/src/sources/builtin-sources.ts`.
- Run CLI commands via backend, not renderer shell.
- Validate platform/profile inputs.
- Return typed result/errors.
- Add audit logging without secrets.

Acceptance:

- Renderer can call `listSocialProfiles`, `saveSocialProfile`, `deleteSocialProfile`, `openSocialLogin`, `verifySocialProfile`.

### Phase 3: Settings UI

Goal: create Settings -> Social Accounts.

Tasks:

- Add settings subpage route and menu item.
- Build list/detail UI.
- Add add/edit dialog.
- Add status badges.
- Add one-profile-at-a-time login action.
- Add verify action.
- Add set-default action.
- Add delete/clear session confirmations.
- Add empty state explaining login-once model.

Acceptance:

- User can create two X profiles and one IG profile, log each in separately, verify, and see readiness.

### Phase 4: Agent Context Injection

Goal: make `@social-publisher` know the profile catalog automatically.

Tasks:

- Load social profile summary during agent/session launch when the agent has `printing-press-social` source or `social-publishing` skill.
- Inject compact catalog into system/source context.
- Keep catalog non-secret.
- Include stale/expired status.
- Teach agent resolution rules.
- Add tests for prompt/context contents.

Acceptance:

- User can say "post this from artist-main" in a fresh chat and agent can resolve the profile without being told handle/account URL again.

### Phase 5: X Browser Rehearsal

Goal: prove the end-to-end browser execution model with simplest platform first.

Tasks:

- Use X text-only post dry-run.
- Use a test/sandbox/throwaway account where possible.
- Confirm profile setup and `doctor --live`.
- Run dry-run.
- Save result JSON.
- Run `social execute`.
- Use browser_tool to open session, verify account, draft text, submit only if approved and safe.
- Capture receipt.

Acceptance:

- Agent performs the flow without a redundant second approval after chat approval.
- Agent stops correctly on wrong-account test.

### Phase 6: Expand Operations

Order:

1. X text post
2. X media post
3. X reply/comment
4. X DM
5. Instagram post/Reel
6. Instagram comment
7. Instagram DM
8. TikTok upload
9. TikTok comment/DM
10. YouTube Short/video upload
11. YouTube comment

Each step needs:

- dry-run test
- account verification test
- browser playbook
- receipt shape
- wrong-account stop case
- upload failure stop case when media is involved

## Safety and Privacy Rules

- Never store passwords.
- Never ask the user to paste passwords or 2FA codes into chat.
- Never place cookies/session files in project folders, git, docs, Outputs, or Canvas.
- Never expose private DM contents to global memory.
- Receipts may include summarized private-message context only when necessary.
- All write actions need explicit approval of exact details.
- Prior chat approval is sufficient for final browser submit only when:
  - action id matches;
  - visible account matches;
  - draft/payload matches;
  - target matches;
  - no unexpected platform choices appear.
- If anything differs, stop and ask.

## Test Plan

### Unit/CLI

- profile add/update/delete/list/status for every platform
- invalid profile slug rejected
- missing handle/account URL prevents live execute handoff
- session path is stable per platform/profile
- doctor aggregates profile statuses
- JSON output schemas stable

### Backend

- service maps UI calls to CLI commands
- command arguments are not shell-injected
- quoted paths/profile names handled safely
- errors are typed and user-readable
- no secrets in logs

### Renderer

- list empty state
- add/edit validation
- delete confirmation
- login button disabled while another login is active
- verify status transitions
- defaults per platform
- wrong-account warning state

### Agent Context

- profile catalog injected for Social Publisher
- profile catalog omitted or minimized for unrelated agents
- multiple profiles force clarification
- default profile used only when unambiguous

### Browser Smoke

- login-needed path
- verified account path
- wrong-account path
- expired-session path
- approved post path
- missing approval path
- comment/reply target mismatch path
- DM recipient mismatch path

## Open Questions

- Should Social Accounts be global by default with workspace defaults, or workspace-owned by default?
  - Recommendation: global account records, workspace defaults/aliases.
- Should browser sessions eventually live under `~/.craft-agent/browser-sessions/social/...` instead of `~/.config/printing-press-clis/...`?
  - Recommendation: leave existing CLI paths for V1; migrate only with a clear compatibility plan.
- Should read/triage actions require approval?
  - Recommendation: no for owned logged-in accounts, but private content must stay scoped and sending always requires approval.
- Should an agent be allowed to maintain a DM/comment queue and propose replies?
  - Recommendation: yes, but proposal-only until the user approves exact sends.
- Should defaults be per workspace, artist, client, or all three?
  - Recommendation: support workspace default first; add artist/client/world mapping as optional metadata.

## Takeover Checklist

For the next agent:

1. Start in this worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/progress/creator-command-center/.worktrees/post-agents`.
2. Read:
   - this file
   - `docs/backlog/connected-accounts-credential-vault.md`
   - `sources/printing-press-social/guide.md`
   - `tools/printing-press-social/README.md`
   - `tools/printing-press-social/src/social.mjs`
   - one platform CLI, preferably `tools/printing-press-social/x-cli/src/cli.mjs`
3. Verify current tests:
   - `cd tools/printing-press-social && npm test`
   - `bun test packages/shared/src/sources/__tests__/storage.test.ts packages/shared/tests/permissions-craft-agent-sync.test.ts`
4. First implementation slice should be Phase 1: normalize profile JSON commands.
5. Do not start with the full Settings UI until CLI profile commands are stable enough for UI consumption.
6. Do not store passwords or raw cookies.
7. Preserve the approval rule: no redundant browser approval when prior chat approval and action id match; stop only on mismatch/ambiguity/unexpected risk.
